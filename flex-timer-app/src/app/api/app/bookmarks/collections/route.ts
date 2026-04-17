import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
  countActiveSharedBookmarksForUser,
  isActiveSharedCollectionBookmark,
  upsertActiveSharedCollectionBookmark,
  deleteSharedCollectionBookmark,
} from '@/lib/bookmarks'
import { getCollectionById, getUserDocument } from '@/lib/firestore'
import { resolveSharedMirrorReadContextForViewer } from '@/lib/shared-resource-access'
import { UNLIMITED } from '@/lib/subscription-limits-constants'
import { getSubscriptionLimits } from '@/lib/subscription-limits'

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

  const readCtx = await resolveSharedMirrorReadContextForViewer(
    uid,
    ownerUserId,
    'collection',
    remoteCollectionId,
    groupId,
  )
  if (!readCtx) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const limits = await getSubscriptionLimits(uid)
    if (limits.maxBookmarks < UNLIMITED) {
      const already = await isActiveSharedCollectionBookmark(uid, ownerUserId, remoteCollectionId)
      if (!already) {
        const n = await countActiveSharedBookmarksForUser(uid)
        if (n >= limits.maxBookmarks) {
          return NextResponse.json(
            {
              error: `Your plan allows up to ${limits.maxBookmarks} bookmarks. Remove one or upgrade to add more.`,
              code: 'SUBSCRIPTION_LIMIT_BOOKMARKS',
            },
            { status: 403 },
          )
        }
      }
    }

    const c = await getCollectionById(ownerUserId, remoteCollectionId)
    if (!c || c.deletedAt) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }
    const userDoc = await getUserDocument(uid)
    const firstName = typeof userDoc?.firstName === 'string' ? userDoc.firstName.trim() : ''
    const lastName = typeof userDoc?.lastName === 'string' ? userDoc.lastName.trim() : ''
    const subscriberFullName = `${firstName} ${lastName}`.trim() || null
    const subscriberHandle =
      typeof userDoc?.handleKey === 'string' && userDoc.handleKey.trim() !== ''
        ? userDoc.handleKey.trim().toLowerCase()
        : typeof userDoc?.handle === 'string' && userDoc.handle.trim() !== ''
          ? userDoc.handle.trim().replace(/^@/, '').toLowerCase()
          : null
    const collectionNameSnapshot = c.workoutCollectionName?.trim() || null
    const collectionDescriptionSnapshot = c.workoutCollectionDescription?.trim() || null
    const collectionWorkoutCountSnapshot = (c.workoutIds ?? []).filter(
      (id) => typeof id === 'string' && id.trim() !== '',
    ).length
    const { subscriptionDocumentId } = await upsertActiveSharedCollectionBookmark({
      viewerUid: uid,
      ownerUserId,
      remoteCollectionId,
      collectionNameSnapshot,
      collectionDescriptionSnapshot,
      collectionWorkoutCountSnapshot,
      subscriberFullName,
      subscriberHandle,
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
