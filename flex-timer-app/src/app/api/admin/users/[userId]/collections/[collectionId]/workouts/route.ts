import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { addWorkoutToCollection, createWorkout, getCollectionById } from '@/lib/firestore'

/**
 * POST /api/admin/users/[userId]/collections/[collectionId]/workouts
 * Create a new workout and add it to this collection. Body: { workout: { timerMode: number, workoutSchedule: string, direction?: boolean } }.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; collectionId: string }> }
) {
  const authResult = await requireAdminAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  if (!adminAuth) {
    return NextResponse.json(
      { error: 'Firebase Admin not configured' },
      { status: 503 }
    )
  }

  const { userId, collectionId } = await params
  if (!userId || !collectionId) {
    return NextResponse.json({ error: 'userId and collectionId required' }, { status: 400 })
  }

  try {
    const collection = await getCollectionById(userId, collectionId)
    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }
    if (collection.deletedAt) {
      return NextResponse.json({ error: 'Collection is deleted' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const workout = body.workout != null && typeof body.workout === 'object' ? body.workout as Record<string, unknown> : undefined
    if (!workout || typeof workout.timerMode !== 'number' || typeof workout.workoutSchedule !== 'string') {
      return NextResponse.json(
        { error: 'workout.timerMode (number) and workout.workoutSchedule (string) required' },
        { status: 400 }
      )
    }

    const created = await createWorkout(userId, {
      timerMode: workout.timerMode as number,
      workoutSchedule: workout.workoutSchedule as string,
      direction: workout.direction === true,
    })
    await addWorkoutToCollection(userId, collectionId, created.id)
    return NextResponse.json(created)
  } catch (err) {
    console.error('[admin collection workouts POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create workout' },
      { status: 500 }
    )
  }
}
