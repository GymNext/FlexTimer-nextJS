import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
  getActiveWorkoutPlanSubscriptionById,
  getPlanById,
  getPlannedWorkouts,
} from '@/lib/firestore'

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

    // Followed plans are read-only and allow viewing past days, but not future.
    const today = new Date().toISOString().slice(0, 10)
    const safeTo = toDate < today ? toDate : today
    if (fromDate > safeTo) {
      return NextResponse.json({ plannedWorkouts: [] })
    }
    const plannedWorkouts = await getPlannedWorkouts(
      subscription.ownerUserId,
      subscription.remotePlanId,
      fromDate,
      safeTo
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
