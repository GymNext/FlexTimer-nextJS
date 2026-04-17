import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
  checkInstantLinkRateLimit,
  InstantLinkError,
  redeemInstantGroupJoin,
} from '@/lib/instant-links'

function clientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() ?? 'unknown'
}

/**
 * POST /api/instant-links/group-join
 * Body: { groupId: string, code: string } — Bearer = caller (iOS instant hub join).
 */
export async function POST(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  let body: { groupId?: unknown; code?: unknown }
  try {
    body = (await request.json()) as { groupId?: unknown; code?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const groupId = typeof body.groupId === 'string' ? body.groupId.trim() : ''
  const code = typeof body.code === 'string' ? body.code : ''
  if (!groupId || !code.trim()) {
    return NextResponse.json({ error: 'groupId and code are required' }, { status: 400 })
  }

  try {
    checkInstantLinkRateLimit(`group-join:${authResult.uid}:${clientIp(request)}`)
    await redeemInstantGroupJoin(authResult.uid, groupId, code)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof InstantLinkError) {
      console.warn('[instant-links group-join]', err.message, { status: err.status, uid: authResult.uid })
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[instant-links group-join]', err)
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
