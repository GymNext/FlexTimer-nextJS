import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
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
 * Mutating a followed coach plan from the subscriber account is not supported.
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

  const { subscriptionDocumentId } = await params
  if (!subscriptionDocumentId) {
    return NextResponse.json({ error: 'subscriptionDocumentId required' }, { status: 400 })
  }

  return NextResponse.json(
    { error: 'You cannot add or edit scheduled workouts on a plan you follow.' },
    { status: 403 }
  )
}
