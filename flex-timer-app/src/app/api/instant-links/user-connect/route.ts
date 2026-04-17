import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
  checkInstantLinkRateLimit,
  InstantLinkError,
  redeemInstantUserConnect,
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
 * POST /api/instant-links/user-connect
 * Body: { targetUserId: string, code: string } — Bearer = caller (iOS instant connect).
 */
export async function POST(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  let body: { targetUserId?: unknown; code?: unknown }
  try {
    body = (await request.json()) as { targetUserId?: unknown; code?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : ''
  const code = typeof body.code === 'string' ? body.code : ''
  if (!targetUserId || !code.trim()) {
    return NextResponse.json({ error: 'targetUserId and code are required' }, { status: 400 })
  }

  try {
    checkInstantLinkRateLimit(`user-connect:${authResult.uid}:${clientIp(request)}`)
    await redeemInstantUserConnect(authResult.uid, targetUserId, code)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof InstantLinkError) {
      console.warn('[instant-links user-connect]', err.message, { status: err.status, uid: authResult.uid })
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[instant-links user-connect]', err)
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
