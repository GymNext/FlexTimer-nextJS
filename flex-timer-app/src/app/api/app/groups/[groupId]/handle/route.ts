import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { changeOwnedGroupHandle } from '@/lib/update-owned-group'

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

/**
 * PATCH /api/app/groups/[groupId]/handle
 * Owner-only: change hub handle (and handle index) only.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { groupId } = await context.params
  const gid = typeof groupId === 'string' ? groupId.trim() : ''
  if (!gid) return bad('Invalid hub id')

  let body: { handle?: unknown }
  try {
    body = (await request.json()) as { handle?: unknown }
  } catch {
    return bad('Invalid JSON')
  }

  const handle = typeof body.handle === 'string' ? body.handle.trim() : ''
  if (!handle) return bad('Handle is required')

  try {
    await changeOwnedGroupHandle({
      ownerUserId: uid,
      groupId: gid,
      handleInput: handle,
    })
    return NextResponse.json({ ok: true, groupId: gid })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update handle'
    if (msg.includes('already taken')) {
      return NextResponse.json({ error: msg }, { status: 409 })
    }
    if (msg.includes('do not own')) {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    if (
      msg.includes('Invalid') ||
      msg.includes('required') ||
      msg.includes('not found') ||
      msg.includes('not available') ||
      msg.includes('Sub hubs')
    ) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    console.error('[app groups handle PATCH]', err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
