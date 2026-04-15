import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { deleteGroupFeedItemForActor } from '@/lib/feed-item-delete'

type RouteParams = Promise<{ groupId: string; feedItemId: string }>

/**
 * DELETE /api/app/feed/group/[groupId]/[feedItemId]
 * Removes a hub feed row the signed-in user authored, or a `createGroup` row when the user owns the hub.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: RouteParams }
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { groupId, feedItemId } = await context.params
  const gid = typeof groupId === 'string' ? groupId.trim() : ''
  const fid = typeof feedItemId === 'string' ? feedItemId.trim() : ''
  if (!gid || !fid) {
    return NextResponse.json({ error: 'groupId and feedItemId required' }, { status: 400 })
  }

  try {
    await deleteGroupFeedItemForActor(uid, gid, fid)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const status = typeof (err as Error & { status?: number }).status === 'number'
      ? (err as Error & { status?: number }).status!
      : 500
    console.error('[app feed group DELETE]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to hide activity from group feed' },
      { status }
    )
  }
}
