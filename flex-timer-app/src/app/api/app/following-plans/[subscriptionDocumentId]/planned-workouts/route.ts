import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
  createPlannedWorkout,
  getActiveWorkoutPlanSubscriptionById,
  getPlanById,
  getPlannedWorkouts,
} from '@/lib/firestore'
import {
  calendarYmdTodayInTimeZone,
  isValidIanaTimeZone,
} from '@/lib/planned-workout-day-timestamp'
import { resolvePlanFollowAccessForSubscriber } from '@/lib/plan-share'
import { listViewerHubGroupIdsForSharedMirrorReads } from '@/lib/shared-resource-access'
import { getSubscriptionLimits } from '@/lib/subscription-limits'

type RouteParams = Promise<{ subscriptionDocumentId: string }>

export async function GET(
  request: NextRequest,
  { params }: { params: RouteParams }
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { subscriptionDocumentId } = await params
  if (!subscriptionDocumentId) {
    return NextResponse.json({ error: 'subscriptionDocumentId required' }, { status: 400 })
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
    const subscription = await getActiveWorkoutPlanSubscriptionById(uid, subscriptionDocumentId)
    if (!subscription) {
      return NextResponse.json({ error: 'Plan subscription not found' }, { status: 404 })
    }

    const ownerPlan = await getPlanById(subscription.ownerUserId, subscription.remotePlanId)
    if (!ownerPlan || ownerPlan.deletedAt) {
      return NextResponse.json({ plannedWorkouts: [] })
    }

    const hubGroupIds = await listViewerHubGroupIdsForSharedMirrorReads(uid)
    const access = await resolvePlanFollowAccessForSubscriber(
      uid,
      subscription.ownerUserId,
      subscription.remotePlanId,
      { hubGroupIds },
    )

    const planDayTzRaw = searchParams.get('planDayTimeZone')
    const planDayTimeZoneId =
      typeof planDayTzRaw === 'string' && planDayTzRaw.trim() && isValidIanaTimeZone(planDayTzRaw.trim())
        ? planDayTzRaw.trim()
        : null
    const tzForToday = planDayTimeZoneId ?? 'UTC'
    const todayYmd = calendarYmdTodayInTimeZone(tzForToday)

    let queryFrom = fromDate
    let queryTo = toDate
    if (access.shareHideFutureWorkouts) {
      const safeTo = toDate < todayYmd ? toDate : todayYmd
      if (fromDate > safeTo) {
        return NextResponse.json({ plannedWorkouts: [] })
      }
      queryTo = safeTo
    }

    const plannedWorkouts = await getPlannedWorkouts(
      subscription.ownerUserId,
      subscription.remotePlanId,
      queryFrom,
      queryTo,
      { planDayTimeZoneId },
    )
    return NextResponse.json({ plannedWorkouts })
  } catch (err) {
    console.error('[app following-plans planned-workouts GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load planned workouts' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/app/following-plans/[subscriptionDocumentId]/planned-workouts
 * Create a planned workout on the coach's calendar when the connection share allows editing.
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
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { subscriptionDocumentId } = await params
  if (!subscriptionDocumentId) {
    return NextResponse.json({ error: 'subscriptionDocumentId required' }, { status: 400 })
  }

  try {
    const subscription = await getActiveWorkoutPlanSubscriptionById(uid, subscriptionDocumentId)
    if (!subscription) {
      return NextResponse.json({ error: 'Plan subscription not found' }, { status: 404 })
    }

    const hubGroupIds = await listViewerHubGroupIdsForSharedMirrorReads(uid)
    const access = await resolvePlanFollowAccessForSubscriber(
      uid,
      subscription.ownerUserId,
      subscription.remotePlanId,
      { hubGroupIds },
    )
    if (!access.shareAllowEditing) {
      return NextResponse.json({ error: 'You do not have permission to modify this plan' }, { status: 403 })
    }

    const ownerPlan = await getPlanById(subscription.ownerUserId, subscription.remotePlanId)
    if (!ownerPlan || ownerPlan.deletedAt) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const day = typeof body.day === 'string' ? body.day.slice(0, 10) : undefined
    const ordinal = typeof body.ordinal === 'number' ? body.ordinal : undefined
    const sourceWorkoutId =
      typeof body.sourceWorkoutId === 'string' && body.sourceWorkoutId !== ''
        ? body.sourceWorkoutId
        : null
    const clientToday =
      typeof body.clientToday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.clientToday)
        ? body.clientToday
        : null
    const workout =
      body.workout != null && typeof body.workout === 'object'
        ? (body.workout as Record<string, unknown>)
        : undefined
    const planDayTzBody =
      typeof body.planDayTimeZone === 'string' &&
      body.planDayTimeZone.trim() &&
      isValidIanaTimeZone(body.planDayTimeZone.trim())
        ? body.planDayTimeZone.trim()
        : null

    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return NextResponse.json({ error: 'day required (YYYY-MM-DD)' }, { status: 400 })
    }
    const isMultiSegment =
      workout?.type === 'MultiSegmentWorkout' && Array.isArray(workout.segments)
    if (!workout) {
      return NextResponse.json({ error: 'workout required' }, { status: 400 })
    }
    if (!isMultiSegment && typeof workout.timerMode !== 'number') {
      return NextResponse.json({ error: 'workout.timerMode required (number)' }, { status: 400 })
    }

    const today = clientToday ?? new Date().toISOString().slice(0, 10)
    if (day > today) {
      const limits = await getSubscriptionLimits(uid)
      if (limits.tier !== 'pro') {
        return NextResponse.json(
          { error: 'Upgrade to Pro to plan for future dates.' },
          { status: 403 }
        )
      }
    }

    const plannedWorkout = await createPlannedWorkout(subscription.ownerUserId, subscription.remotePlanId, {
      day,
      ordinal: ordinal ?? 0,
      workout,
      sourceWorkoutId: sourceWorkoutId ?? undefined,
      planDayTimeZoneId: planDayTzBody,
    })
    return NextResponse.json(plannedWorkout)
  } catch (err) {
    console.error('[app following-plans planned-workouts POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create planned workout' },
      { status: 500 }
    )
  }
}
