import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
  addWorkoutToCollection,
  cloneWorkoutToUserLibrary,
  getCollectionById,
  getWorkoutById,
  getWorkoutsByIds,
  updateWorkoutMetadata,
} from '@/lib/firestore'
import { getSubscriptionLimits } from '@/lib/subscription-limits'

/**
 * POST /api/app/workouts/duplicate
 * Deep-copy a workout that already belongs to the signed-in user into the same library,
 * rename it to `Copy of (original name)`, and append it to each listed collection.
 * Body: { sourceWorkoutId: string, collectionIds: string[] }
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

  const sourceWorkoutId =
    typeof body.sourceWorkoutId === 'string' ? body.sourceWorkoutId.trim() : ''
  const rawIds = body.collectionIds
  const collectionIds = Array.isArray(rawIds)
    ? [
        ...new Set(
          rawIds.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
        ),
      ]
    : []

  if (!sourceWorkoutId) {
    return NextResponse.json({ error: 'sourceWorkoutId required' }, { status: 400 })
  }
  if (collectionIds.length === 0) {
    return NextResponse.json({ error: 'collectionIds required (non-empty array)' }, { status: 400 })
  }

  try {
    const source = await getWorkoutById(uid, sourceWorkoutId)
    if (!source || source.deletedAt) {
      return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
    }

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

    const newId = await cloneWorkoutToUserLibrary(uid, sourceWorkoutId, uid)
    const baseName = (source.workoutName ?? '').trim() || source.workoutId
    const copyName = `Copy of (${baseName})`
    await updateWorkoutMetadata(uid, newId, { workoutName: copyName })

    for (const cid of collectionIds) {
      await addWorkoutToCollection(uid, cid, newId)
    }

    const created = await getWorkoutById(uid, newId)
    if (!created) {
      return NextResponse.json({ error: 'Failed to load duplicated workout' }, { status: 500 })
    }
    return NextResponse.json(created)
  } catch (err) {
    console.error('[app workouts duplicate POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to duplicate workout' },
      { status: 500 }
    )
  }
}
