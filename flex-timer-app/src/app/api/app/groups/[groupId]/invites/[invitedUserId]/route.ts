import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { cancelOutgoingInvite, getOwnedGroupOrNull } from '@/lib/group-invite'

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

/**
 * DELETE /api/app/groups/[groupId]/invites/[invitedUserId]
 * Owner-only: cancel a pending invite you sent.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ groupId: string; invitedUserId: string }> },
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { groupId, invitedUserId } = await context.params
  const gid = typeof groupId === 'string' ? groupId.trim() : ''
  const iid = typeof invitedUserId === 'string' ? invitedUserId.trim() : ''
  if (!gid || !iid) return bad('Invalid request')

  const owned = await getOwnedGroupOrNull(uid, gid)
  if (!owned) return NextResponse.json({ error: 'Hub not found' }, { status: 404 })

  try {
    await cancelOutgoingInvite({
      groupId: gid,
      invitedUserId: iid,
      cancelledByUserId: uid,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to cancel invite'
    if (msg.includes('not found')) return NextResponse.json({ error: msg }, { status: 404 })
    if (msg.includes('only cancel invites you sent')) return NextResponse.json({ error: msg }, { status: 403 })
    if (msg.includes('no longer pending')) return bad(msg)
    console.error('[app groups invites DELETE]', err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
