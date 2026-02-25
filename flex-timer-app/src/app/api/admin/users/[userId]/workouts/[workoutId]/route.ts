import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { clearWorkoutDeletedAt, deleteWorkout, getWorkoutById, setWorkoutDeletedAt } from '@/lib/firestore'

/**
 * GET /api/admin/users/[userId]/workouts/[workoutId]
 * Returns a single workout document.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; workoutId: string }> }
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

  const { userId, workoutId } = await params
  if (!userId || !workoutId) {
    return NextResponse.json({ error: 'userId and workoutId required' }, { status: 400 })
  }

  try {
    const workout = await getWorkoutById(userId, workoutId)
    if (!workout) {
      return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
    }
    return NextResponse.json(workout)
  } catch (err) {
    console.error('[admin workout]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch workout' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/admin/users/[userId]/workouts/[workoutId]
 * Soft-deletes the workout (sets deletedAt) or recovers (clears deletedAt). Body: { recover: true } to recover.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; workoutId: string }> }
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

  const { userId, workoutId } = await params
  if (!userId || !workoutId) {
    return NextResponse.json({ error: 'userId and workoutId required' }, { status: 400 })
  }

  try {
    const workout = await getWorkoutById(userId, workoutId)
    if (!workout) {
      return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
    }
    const body = await request.json().catch(() => ({}))
    if (body.recover === true) {
      if (!workout.deletedAt) {
        return NextResponse.json({ error: 'Workout is not deleted' }, { status: 400 })
      }
      await clearWorkoutDeletedAt(userId, workoutId)
      return NextResponse.json({ ok: true })
    }
    if (workout.deletedAt) {
      return NextResponse.json({ error: 'Workout is already deleted' }, { status: 400 })
    }
    await setWorkoutDeletedAt(userId, workoutId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin workout patch]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update workout' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/admin/users/[userId]/workouts/[workoutId]
 * Permanently deletes the workout document. Only allowed when workout is soft-deleted (deletedAt set).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string; workoutId: string }> }
) {
  const authResult = await requireAdminAuth(_request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  if (!adminAuth) {
    return NextResponse.json(
      { error: 'Firebase Admin not configured' },
      { status: 503 }
    )
  }

  const { userId, workoutId } = await params
  if (!userId || !workoutId) {
    return NextResponse.json({ error: 'userId and workoutId required' }, { status: 400 })
  }

  try {
    const workout = await getWorkoutById(userId, workoutId)
    if (!workout) {
      return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
    }
    if (!workout.deletedAt) {
      return NextResponse.json(
        { error: 'Workout must be soft-deleted before permanent deletion' },
        { status: 400 }
      )
    }
    await deleteWorkout(userId, workoutId)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[admin workout delete]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete workout' },
      { status: 500 }
    )
  }
}
