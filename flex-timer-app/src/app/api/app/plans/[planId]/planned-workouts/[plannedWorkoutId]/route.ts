import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
  deletePlannedWorkout,
  getPlannedWorkout,
  updatePlannedWorkoutDayAndOrdinal,
  updatePlannedWorkoutWorkout,
  updatePlannedWorkoutWorkoutMetadata,
} from '@/lib/firestore'

type RouteParams = Promise<{ planId: string; plannedWorkoutId: string }>

/**
 * GET /api/app/plans/[planId]/planned-workouts/[plannedWorkoutId]
 * Returns a single planned workout for the signed-in user.
 */
export async function GET(
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
  const { planId, plannedWorkoutId } = await params
  if (!planId || !plannedWorkoutId) {
    return NextResponse.json(
      { error: 'planId and plannedWorkoutId required' },
      { status: 400 }
    )
  }

  try {
    const plannedWorkout = await getPlannedWorkout(uid, plannedWorkoutId)
    if (!plannedWorkout || plannedWorkout.planId !== planId) {
      return NextResponse.json({ error: 'Planned workout not found' }, { status: 404 })
    }
    return NextResponse.json(plannedWorkout)
  } catch (err) {
    console.error('[app planned-workout GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch planned workout' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/app/plans/[planId]/planned-workouts/[plannedWorkoutId]
 * Move / reorder a planned workout: body { day?: string (YYYY-MM-DD), ordinal?: number }.
 */
export async function PATCH(
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
  const { planId, plannedWorkoutId } = await params
  if (!planId || !plannedWorkoutId) {
    return NextResponse.json(
      { error: 'planId and plannedWorkoutId required' },
      { status: 400 }
    )
  }

  let body: { day?: unknown; ordinal?: unknown; workoutName?: unknown; workoutDescription?: unknown; workout?: unknown }
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }

  try {
    const plannedWorkout = await getPlannedWorkout(uid, plannedWorkoutId)
    if (!plannedWorkout || plannedWorkout.planId !== planId) {
      return NextResponse.json({ error: 'Planned workout not found' }, { status: 404 })
    }

    const workoutPayload =
      body.workout != null && typeof body.workout === 'object'
        ? (body.workout as Record<string, unknown>)
        : undefined
    if (workoutPayload && typeof workoutPayload.timerMode === 'number') {
      const existing = (plannedWorkout.workout ?? {}) as Record<string, unknown>
      const merged = {
        ...existing,
        ...workoutPayload,
        workoutName: existing.workoutName ?? workoutPayload.workoutName,
        workoutDescription: existing.workoutDescription ?? workoutPayload.workoutDescription,
      }
      await updatePlannedWorkoutWorkout(uid, plannedWorkoutId, merged)
      const updated = await getPlannedWorkout(uid, plannedWorkoutId)
      return NextResponse.json(updated ?? plannedWorkout)
    }

    const day =
      typeof body.day === 'string'
        ? (body.day as string).slice(0, 10)
        : undefined
    const ordinal =
      typeof body.ordinal === 'number'
        ? (body.ordinal as number)
        : undefined
    const workoutName =
      body.workoutName === null || typeof body.workoutName === 'string'
        ? (body.workoutName as string | null)
        : undefined
    const workoutDescription =
      body.workoutDescription === null || typeof body.workoutDescription === 'string'
        ? (body.workoutDescription as string | null)
        : undefined

    if (workoutName !== undefined || workoutDescription !== undefined) {
      await updatePlannedWorkoutWorkoutMetadata(uid, plannedWorkoutId, {
        workoutName,
        workoutDescription,
      })
      const updated = await getPlannedWorkout(uid, plannedWorkoutId)
      return NextResponse.json(updated ?? plannedWorkout)
    }

    if (day === undefined && ordinal === undefined) {
      return NextResponse.json(
        { error: 'Provide day, ordinal, or workout name/description' },
        { status: 400 }
      )
    }
    if (day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return NextResponse.json(
        { error: 'day must be YYYY-MM-DD' },
        { status: 400 }
      )
    }

    await updatePlannedWorkoutDayAndOrdinal(uid, plannedWorkoutId, {
      day,
      ordinal,
    })
    const updated = await getPlannedWorkout(uid, plannedWorkoutId)
    return NextResponse.json(updated ?? plannedWorkout)
  } catch (err) {
    console.error('[app planned-workout PATCH]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update planned workout' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/app/plans/[planId]/planned-workouts/[plannedWorkoutId]
 * Permanently removes a planned workout from the calendar.
 */
export async function DELETE(
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
  const { planId, plannedWorkoutId } = await params
  if (!planId || !plannedWorkoutId) {
    return NextResponse.json(
      { error: 'planId and plannedWorkoutId required' },
      { status: 400 }
    )
  }

  try {
    const plannedWorkout = await getPlannedWorkout(uid, plannedWorkoutId)
    if (!plannedWorkout || plannedWorkout.planId !== planId) {
      return NextResponse.json({ error: 'Planned workout not found' }, { status: 404 })
    }
    await deletePlannedWorkout(uid, plannedWorkoutId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[app planned-workout DELETE]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete planned workout' },
      { status: 500 }
    )
  }
}

