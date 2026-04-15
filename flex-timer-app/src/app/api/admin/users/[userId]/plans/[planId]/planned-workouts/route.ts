import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { getPlannedWorkouts, createPlannedWorkout } from '@/lib/firestore'
import { isValidIanaTimeZone } from '@/lib/planned-workout-day-timestamp'

/**
 * GET /api/admin/users/[userId]/plans/[planId]/planned-workouts?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns planned workouts for the plan in the given date range (e.g. week).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; planId: string }> }
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

  const { userId, planId } = await params
  if (!userId || !planId) {
    return NextResponse.json({ error: 'userId and planId required' }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const fromDate = searchParams.get('from')
  const toDate = searchParams.get('to')
  if (!fromDate || !toDate) {
    return NextResponse.json(
      { error: 'Query params from and to (YYYY-MM-DD) required' },
      { status: 400 }
    )
  }

  try {
    const planDayTzRaw = searchParams.get('planDayTimeZone')
    const planDayTimeZoneId =
      typeof planDayTzRaw === 'string' && planDayTzRaw.trim() && isValidIanaTimeZone(planDayTzRaw.trim())
        ? planDayTzRaw.trim()
        : null
    const plannedWorkouts = await getPlannedWorkouts(userId, planId, fromDate, toDate, {
      planDayTimeZoneId,
    })
    return NextResponse.json({ plannedWorkouts })
  } catch (err) {
    console.error('[admin planned-workouts]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch planned workouts' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/admin/users/[userId]/plans/[planId]/planned-workouts
 * Create a planned workout. Body: { day: string (YYYY-MM-DD), ordinal?: number, workout: object }.
 * workout must include timerMode (number) and mode-specific schedule (workoutSchedule JSON string, direction, etc.).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; planId: string }> }
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

  const { userId, planId } = await params
  if (!userId || !planId) {
    return NextResponse.json({ error: 'userId and planId required' }, { status: 400 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const day = typeof body.day === 'string' ? body.day.slice(0, 10) : undefined
    const ordinal = typeof body.ordinal === 'number' ? body.ordinal : undefined
    const workout = body.workout != null && typeof body.workout === 'object' ? (body.workout as Record<string, unknown>) : undefined
    const planDayTzBody =
      typeof body.planDayTimeZone === 'string' &&
      body.planDayTimeZone.trim() &&
      isValidIanaTimeZone(body.planDayTimeZone.trim())
        ? body.planDayTimeZone.trim()
        : null

    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return NextResponse.json({ error: 'day required (YYYY-MM-DD)' }, { status: 400 })
    }
    if (!workout || typeof workout.timerMode !== 'number') {
      return NextResponse.json({ error: 'workout.timerMode required (number)' }, { status: 400 })
    }

    const plannedWorkout = await createPlannedWorkout(userId, planId, {
      day,
      ordinal: ordinal ?? 0,
      workout,
      planDayTimeZoneId: planDayTzBody,
    })
    return NextResponse.json(plannedWorkout)
  } catch (err) {
    console.error('[admin planned-workouts POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create planned workout' },
      { status: 500 }
    )
  }
}
