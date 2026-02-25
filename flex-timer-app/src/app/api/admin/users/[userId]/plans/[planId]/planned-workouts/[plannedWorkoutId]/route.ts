import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { getPlannedWorkout, deletePlannedWorkout } from '@/lib/firestore'

/**
 * GET /api/admin/users/[userId]/plans/[planId]/planned-workouts/[plannedWorkoutId]
 * Returns a single planned workout by id.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string; planId: string; plannedWorkoutId: string }> }
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

  const { userId, planId, plannedWorkoutId } = await params
  if (!userId || !planId || !plannedWorkoutId) {
    return NextResponse.json(
      { error: 'userId, planId and plannedWorkoutId required' },
      { status: 400 }
    )
  }

  try {
    const plannedWorkout = await getPlannedWorkout(userId, plannedWorkoutId)
    if (!plannedWorkout) {
      return NextResponse.json({ error: 'Planned workout not found' }, { status: 404 })
    }
    if (plannedWorkout.planId !== planId) {
      return NextResponse.json({ error: 'Planned workout does not belong to this plan' }, { status: 404 })
    }
    return NextResponse.json(plannedWorkout)
  } catch (err) {
    console.error('[admin planned-workout]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch planned workout' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/admin/users/[userId]/plans/[planId]/planned-workouts/[plannedWorkoutId]
 * Permanently removes the planned workout from the calendar.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string; planId: string; plannedWorkoutId: string }> }
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

  const { userId, planId, plannedWorkoutId } = await params
  if (!userId || !planId || !plannedWorkoutId) {
    return NextResponse.json(
      { error: 'userId, planId and plannedWorkoutId required' },
      { status: 400 }
    )
  }

  try {
    const plannedWorkout = await getPlannedWorkout(userId, plannedWorkoutId)
    if (!plannedWorkout) {
      return NextResponse.json({ error: 'Planned workout not found' }, { status: 404 })
    }
    if (plannedWorkout.planId !== planId) {
      return NextResponse.json({ error: 'Planned workout does not belong to this plan' }, { status: 404 })
    }
    await deletePlannedWorkout(userId, plannedWorkoutId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin planned-workout DELETE]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete planned workout' },
      { status: 500 }
    )
  }
}
