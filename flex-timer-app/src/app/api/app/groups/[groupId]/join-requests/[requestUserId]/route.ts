import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { JoinRequestActionError, rejectJoinRequestAsOwner } from '@/lib/group-join-requests'

type RouteParams = Promise<{ groupId: string; requestUserId: string }>

/**
 * DELETE /api/app/groups/[groupId]/join-requests/[requestUserId]
 * Hub owner declines a pending join request.
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: RouteParams },
) {
  const authResult = await requireUserAuth(_request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { groupId, requestUserId } = await context.params
  const gid = typeof groupId === 'string' ? groupId.trim() : ''
  const rid = typeof requestUserId === 'string' ? requestUserId.trim() : ''
  if (!gid || !rid) {
    return NextResponse.json({ error: 'Invalid hub or user id' }, { status: 400 })
  }

  try {
    await rejectJoinRequestAsOwner(uid, gid, rid)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof JoinRequestActionError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[app groups join-requests DELETE]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to decline request' },
      { status: 500 },
    )
  }
}
