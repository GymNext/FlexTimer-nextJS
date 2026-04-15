import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { cloneSharedCollectionToUserLibrary, getUserWorkoutCollections } from '@/lib/firestore'
import { getSubscriptionLimits } from '@/lib/subscription-limits'
import { viewerCanAccessSharedLibraryItem } from '@/lib/shared-resource-access'

/**
 * POST /api/app/collections/duplicate-from-share
 * Body: { ownerUserId, sourceCollectionId, groupId?: string }
 * Clones the owner's collection and all copyable workouts into the signed-in user's library as one new collection.
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
  const sourceCollectionId = typeof body.sourceCollectionId === 'string' ? body.sourceCollectionId.trim() : ''
  const groupId =
    typeof body.groupId === 'string' && body.groupId.trim() !== '' ? body.groupId.trim() : null

  if (!ownerUserId || !sourceCollectionId) {
    return NextResponse.json(
      { error: 'ownerUserId and sourceCollectionId required' },
      { status: 400 }
    )
  }

  const allowed = await viewerCanAccessSharedLibraryItem(
    uid,
    ownerUserId,
    'collection',
    sourceCollectionId,
    groupId
  )
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const [allCollections, limits] = await Promise.all([
      getUserWorkoutCollections(uid),
      getSubscriptionLimits(uid),
    ])
    const collectionsExcludingFavorites = allCollections.filter((c) => !c.deletedAt && c.id !== 'favorite')
    if (collectionsExcludingFavorites.length >= limits.maxCollections) {
      return NextResponse.json(
        {
          error:
            limits.maxCollections === 1
              ? 'Your plan allows 1 collection. Upgrade to add more.'
              : `Your plan allows up to ${limits.maxCollections} collections. Upgrade to add more.`,
          code: 'SUBSCRIPTION_LIMIT_COLLECTIONS',
        },
        { status: 403 }
      )
    }

    const result = await cloneSharedCollectionToUserLibrary(ownerUserId, sourceCollectionId, uid)
    return NextResponse.json({
      ok: true,
      collectionId: result.newCollectionId,
      clonedWorkoutCount: result.clonedWorkoutCount,
      skippedWorkoutCount: result.skippedWorkoutCount,
    })
  } catch (err) {
    console.error('[app collections duplicate-from-share POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to duplicate collection' },
      { status: 500 }
    )
  }
}
