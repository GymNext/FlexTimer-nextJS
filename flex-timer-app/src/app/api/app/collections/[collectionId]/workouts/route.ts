import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { addWorkoutToCollection, createWorkout, createMultiSegmentWorkout, getCollectionById, getWorkoutsByIds } from '@/lib/firestore'
import { getSubscriptionLimits } from '@/lib/subscription-limits'

type RouteParams = Promise<{ collectionId: string }>

/**
 * POST /api/app/collections/[collectionId]/workouts
 * Create a new workout for the signed-in user and add it to this collection.
 * Body: { workout: { timerMode: number, workoutSchedule: string, direction?: boolean } }.
 * Enforces subscription limit when adding to favorites (collection id === 'favorite').
 */
export async function POST(
  request: NextRequest,
  { params }: { params: RouteParams }
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  if (!adminAuth) {
    return NextResponse.json(
      { error: 'Firebase Admin not configured' },
      { status: 503 }
    )
  }

  const { uid } = authResult
  const { collectionId } = await params
  if (!collectionId) {
    return NextResponse.json({ error: 'collectionId required' }, { status: 400 })
  }

  try {
    const collection = await getCollectionById(uid, collectionId)
    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }
    if (collection.deletedAt) {
      return NextResponse.json({ error: 'Collection is deleted' }, { status: 400 })
    }

    if (collectionId === 'favorite') {
      const limits = await getSubscriptionLimits(uid)
      const favoriteWorkouts = await getWorkoutsByIds(uid, collection.workoutIds ?? [])
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

    const body = await request.json().catch(() => ({}))
    const workout =
      body.workout != null && typeof body.workout === 'object'
        ? (body.workout as Record<string, unknown>)
        : undefined
    if (!workout) {
      return NextResponse.json(
        { error: 'workout object required' },
        { status: 400 }
      )
    }

    if (workout.type === 'MultiSegmentWorkout') {
      const created = await createMultiSegmentWorkout(uid)
      await addWorkoutToCollection(uid, collectionId, created.id)
      return NextResponse.json(created)
    }

    if (typeof workout.timerMode !== 'number' || typeof workout.workoutSchedule !== 'string') {
      return NextResponse.json(
        { error: 'workout.timerMode (number) and workout.workoutSchedule (string) required' },
        { status: 400 }
      )
    }

    const restDirection =
      typeof workout.restDirection === 'number' ? workout.restDirection : 0
    const created = await createWorkout(uid, {
      timerMode: workout.timerMode as number,
      workoutSchedule: workout.workoutSchedule as string,
      direction: workout.direction === true,
      restDirection,
    })
    await addWorkoutToCollection(uid, collectionId, created.id)
    return NextResponse.json(created)
  } catch (err) {
    console.error('[app collection workouts POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create workout' },
      { status: 500 }
    )
  }
}

