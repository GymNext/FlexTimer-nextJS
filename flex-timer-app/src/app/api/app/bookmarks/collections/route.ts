import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { deleteSharedCollectionBookmark, upsertActiveSharedCollectionBookmark } from '@/lib/bookmarks'
import { getCollectionById } from '@/lib/firestore'
import { viewerCanAccessSharedLibraryItem } from '@/lib/shared-resource-access'

/**
 * POST /api/app/bookmarks/collections
 * Body: { ownerUserId, remoteCollectionId, groupId?: string }
 * Saves an active `workoutCollectionSubscriptions` row when the viewer can already read that shared collection.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  let body: Record<string, unknown>
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }

  const ownerUserId = typeof body.ownerUserId === 'string' ? body.ownerUserId.trim() : ''
  const remoteCollectionId = typeof body.remoteCollectionId === 'string' ? body.remoteCollectionId.trim() : ''
  const groupId =
    typeof body.groupId === 'string' && body.groupId.trim() !== '' ? body.groupId.trim() : null

  if (!ownerUserId || !remoteCollectionId) {
    return NextResponse.json(
      { error: 'ownerUserId and remoteCollectionId required' },
      { status: 400 },
    )
  }
  if (ownerUserId === uid) {
    return NextResponse.json({ error: 'Cannot bookmark your own collection' }, { status: 400 })
  }

  const allowed = await viewerCanAccessSharedLibraryItem(
    uid,
    ownerUserId,
    'collection',
    remoteCollectionId,
    groupId,
  )
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const c = await getCollectionById(ownerUserId, remoteCollectionId)
    if (!c || c.deletedAt) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }
    const collectionNameSnapshot = c.workoutCollectionName?.trim() || null
    const collectionDescriptionSnapshot = c.workoutCollectionDescription?.trim() || null
    const collectionWorkoutCountSnapshot = (c.workoutIds ?? []).filter(
      (id) => typeof id === 'string' && id.trim() !== '',
    ).length
    const { subscriptionDocumentId } = await upsertActiveSharedCollectionBookmark({
      viewerUid: uid,
      ownerUserId,
      remoteCollectionId,
      mirrorGroupId: groupId,
      collectionNameSnapshot,
      collectionDescriptionSnapshot,
      collectionWorkoutCountSnapshot,
    })
    return NextResponse.json({ subscriptionDocumentId })
  } catch (err) {
    console.error('[app bookmarks/collections POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save bookmark' },
      { status: 500 },
    )
  }
}

/**
 * DELETE /api/app/bookmarks/collections
 * Body: { ownerUserId, remoteCollectionId }
 * Removes the viewer's `workoutCollectionSubscriptions` row (composite doc id).
 */
export async function DELETE(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  let body: Record<string, unknown>
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }

  const ownerUserId = typeof body.ownerUserId === 'string' ? body.ownerUserId.trim() : ''
  const remoteCollectionId = typeof body.remoteCollectionId === 'string' ? body.remoteCollectionId.trim() : ''

  if (!ownerUserId || !remoteCollectionId) {
    return NextResponse.json(
      { error: 'ownerUserId and remoteCollectionId required' },
      { status: 400 },
    )
  }

  try {
    await deleteSharedCollectionBookmark(uid, ownerUserId, remoteCollectionId)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to remove bookmark'
    if (msg === 'Forbidden') {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    console.error('[app bookmarks/collections DELETE]', err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
