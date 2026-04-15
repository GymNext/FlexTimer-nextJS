import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
  addWorkoutToCollection,
  cloneWorkoutToUserLibrary,
  getCollectionById,
  getWorkoutsByIds,
} from '@/lib/firestore'
import { getSubscriptionLimits } from '@/lib/subscription-limits'
import { viewerCanAccessSharedLibraryItem } from '@/lib/shared-resource-access'

/**
 * POST /api/app/workouts/duplicate-from-share
 * Body: { ownerUserId, sourceWorkoutId, groupId?: string, collectionIds: string[] }
 * Clones the owner's workout into the signed-in user's library and appends it to each collection.
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
  const sourceWorkoutId = typeof body.sourceWorkoutId === 'string' ? body.sourceWorkoutId.trim() : ''
  const groupId =
    typeof body.groupId === 'string' && body.groupId.trim() !== '' ? body.groupId.trim() : null
  const rawIds = body.collectionIds
  const collectionIds = Array.isArray(rawIds)
    ? [...new Set(rawIds.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()))]
    : []

  if (!ownerUserId || !sourceWorkoutId) {
    return NextResponse.json({ error: 'ownerUserId and sourceWorkoutId required' }, { status: 400 })
  }
  if (collectionIds.length === 0) {
    return NextResponse.json({ error: 'collectionIds required (non-empty array)' }, { status: 400 })
  }

  const allowed = await viewerCanAccessSharedLibraryItem(
    uid,
    ownerUserId,
    'workout',
    sourceWorkoutId,
    groupId
  )
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    for (const cid of collectionIds) {
      const coll = await getCollectionById(uid, cid)
      if (!coll || coll.deletedAt) {
        return NextResponse.json({ error: `Collection not found: ${cid}` }, { status: 404 })
      }
    }

    if (collectionIds.includes('favorite')) {
      const limits = await getSubscriptionLimits(uid)
      const fav = await getCollectionById(uid, 'favorite')
      if (fav) {
        const favoriteWorkouts = await getWorkoutsByIds(uid, fav.workoutIds ?? [])
        const currentCount = favoriteWorkouts.filter((w) => !w.deletedAt).length
        if (currentCount >= limits.maxFavorites) {
          return NextResponse.json(
            {
              error: `Your plan allows up to ${limits.maxFavorites} favorites. Upgrade to add more.`,
              code: 'SUBSCRIPTION_LIMIT_FAVORITES',
            },
            { status: 403 }
          )
        }
      }
    }

    const newWorkoutId = await cloneWorkoutToUserLibrary(ownerUserId, sourceWorkoutId, uid)
    for (const cid of collectionIds) {
      await addWorkoutToCollection(uid, cid, newWorkoutId)
    }

    return NextResponse.json({ ok: true, workoutId: newWorkoutId })
  } catch (err) {
    console.error('[app workouts duplicate-from-share POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to duplicate workout' },
      { status: 500 }
    )
  }
}
