import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { deletePersonalFeedItemForUser } from '@/lib/feed-item-delete'

type RouteParams = Promise<{ feedItemId: string }>

/**
 * DELETE /api/app/feed/personal/[feedItemId]
 * Removes a row from the signed-in user’s personal activity feed (`users/{uid}/feed/*`).
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
  const { feedItemId } = await context.params
  const fid = typeof feedItemId === 'string' ? feedItemId.trim() : ''
  if (!fid) {
    return NextResponse.json({ error: 'feedItemId required' }, { status: 400 })
  }

  try {
    await deletePersonalFeedItemForUser(uid, fid)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const status = typeof (err as Error & { status?: number }).status === 'number'
      ? (err as Error & { status?: number }).status!
      : 500
    console.error('[app feed personal DELETE]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to hide activity' },
      { status }
    )
  }
}
