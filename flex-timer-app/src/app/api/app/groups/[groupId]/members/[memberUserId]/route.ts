import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { removeGroupMemberAsOwner } from '@/lib/group-invite'

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

/**
 * DELETE /api/app/groups/[groupId]/members/[memberUserId]
 * Owner-only: remove a member from the hub (boot).
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ groupId: string; memberUserId: string }> },
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { groupId, memberUserId } = await context.params
  const gid = typeof groupId === 'string' ? groupId.trim() : ''
  const mid = typeof memberUserId === 'string' ? memberUserId.trim() : ''
  if (!gid || !mid) return bad('Invalid request')

  try {
    await removeGroupMemberAsOwner({
      ownerUserId: uid,
      groupId: gid,
      memberUserId: mid,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to remove member'
    if (msg === 'Hub not found') return NextResponse.json({ error: msg }, { status: 404 })
    if (
      msg === 'Cannot remove the hub owner' ||
      msg === 'Cannot remove another owner' ||
      msg.includes('not a member')
    ) {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    if (msg === 'Invalid request') return bad(msg)
    if (msg.includes('not active')) return bad(msg)
    console.error('[app groups members DELETE]', err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
