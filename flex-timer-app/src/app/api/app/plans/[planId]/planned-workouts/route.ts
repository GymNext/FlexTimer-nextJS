import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { createPlannedWorkout, getPlannedWorkouts } from '@/lib/firestore'
import { getSubscriptionLimits } from '@/lib/subscription-limits'

type RouteParams = Promise<{ planId: string }>

/**
 * GET /api/app/plans/[planId]/planned-workouts?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns planned workouts for the signed-in user's plan in the given date range.
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
  const { planId } = await params
  if (!planId) {
    return NextResponse.json({ error: 'planId required' }, { status: 400 })
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
    const plannedWorkouts = await getPlannedWorkouts(uid, planId, fromDate, toDate)
    return NextResponse.json({ plannedWorkouts })
  } catch (err) {
    console.error('[app planned-workouts GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch planned workouts' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/app/plans/[planId]/planned-workouts
 * Create a planned workout for the signed-in user's plan.
 * Body: { day: string (YYYY-MM-DD), ordinal?: number, workout: object }.
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
  const { planId } = await params
  if (!planId) {
    return NextResponse.json({ error: 'planId required' }, { status: 400 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const day = typeof body.day === 'string' ? body.day.slice(0, 10) : undefined
    const ordinal = typeof body.ordinal === 'number' ? body.ordinal : undefined
    const sourceWorkoutId =
      typeof body.sourceWorkoutId === 'string' && body.sourceWorkoutId !== ''
        ? body.sourceWorkoutId
        : null
    const workout =
      body.workout != null && typeof body.workout === 'object'
        ? (body.workout as Record<string, unknown>)
        : undefined

    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return NextResponse.json({ error: 'day required (YYYY-MM-DD)' }, { status: 400 })
    }
    if (!workout || typeof workout.timerMode !== 'number') {
      return NextResponse.json({ error: 'workout.timerMode required (number)' }, { status: 400 })
    }

    const today = new Date().toISOString().slice(0, 10)
    if (day < today) {
      return NextResponse.json(
        { error: 'Cannot add workouts to past dates.' },
        { status: 403 }
      )
    }
    if (day > today) {
      const limits = await getSubscriptionLimits(uid)
      if (limits.tier !== 'pro') {
        return NextResponse.json(
          { error: 'Upgrade to Pro to plan for future dates.' },
          { status: 403 }
        )
      }
    }

    const plannedWorkout = await createPlannedWorkout(uid, planId, {
      day,
      ordinal: ordinal ?? 0,
      workout,
      sourceWorkoutId: sourceWorkoutId ?? undefined,
    })
    return NextResponse.json(plannedWorkout)
  } catch (err) {
    console.error('[app planned-workouts POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create planned workout' },
      { status: 500 }
    )
  }
}

