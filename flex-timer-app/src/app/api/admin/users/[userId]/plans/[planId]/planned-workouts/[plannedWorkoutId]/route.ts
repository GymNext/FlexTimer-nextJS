import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { getPlannedWorkout, deletePlannedWorkout, updatePlannedWorkoutDayAndOrdinal } from '@/lib/firestore'

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
 * PATCH /api/admin/users/[userId]/plans/[planId]/planned-workouts/[plannedWorkoutId]
 * Move: body { day?: string (YYYY-MM-DD), ordinal?: number }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; planId: string; plannedWorkoutId: string }> }
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

    const body = await request.json().catch(() => ({}))
    const day = typeof body.day === 'string' ? body.day.slice(0, 10) : undefined
    const ordinal = typeof body.ordinal === 'number' ? body.ordinal : undefined
    if (day === undefined && ordinal === undefined) {
      return NextResponse.json({ error: 'Provide day and/or ordinal' }, { status: 400 })
    }
    if (day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return NextResponse.json({ error: 'day must be YYYY-MM-DD' }, { status: 400 })
    }

    await updatePlannedWorkoutDayAndOrdinal(userId, plannedWorkoutId, { day, ordinal })
    const updated = await getPlannedWorkout(userId, plannedWorkoutId)
    return NextResponse.json(updated ?? plannedWorkout)
  } catch (err) {
    console.error('[admin planned-workout PATCH]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update planned workout' },
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
