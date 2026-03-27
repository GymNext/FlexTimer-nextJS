import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
  getPlanById,
  getWorkoutPlanSubscriptionsForPlan,
  mutateWorkoutPlanSubscriptionForPlan,
  type WorkoutPlanSubscriptionStatus,
} from '@/lib/firestore'

type RouteParams = Promise<{ planId: string }>

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
  const { planId } = await params
  if (!planId) {
    return NextResponse.json({ error: 'planId required' }, { status: 400 })
  }
  const statusRaw = request.nextUrl.searchParams.get('status') ?? 'active'
  const status: WorkoutPlanSubscriptionStatus =
    statusRaw === 'pending' || statusRaw === 'blocked' ? statusRaw : 'active'
  const pageSizeRaw = parseInt(request.nextUrl.searchParams.get('pageSize') ?? '25', 10)
  const pageSize = Number.isFinite(pageSizeRaw) ? pageSizeRaw : 25
  const cursor = request.nextUrl.searchParams.get('cursor')
  const query = request.nextUrl.searchParams.get('query')

  try {
    const plan = await getPlanById(uid, planId)
    if (!plan || plan.deletedAt) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }
    if (plan.isPersonal) {
      return NextResponse.json({ error: 'Personal plans do not have followers' }, { status: 400 })
    }
    const result = await getWorkoutPlanSubscriptionsForPlan(uid, planId, status, {
      pageSize,
      cursor,
      query,
    })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[app plan followers GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load followers' },
      { status: 500 }
    )
  }
}

export async function PATCH(
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
  const { planId } = await params
  if (!planId) {
    return NextResponse.json({ error: 'planId required' }, { status: 400 })
  }

  let body: {
    subscriberUserId?: string
    subscriptionDocumentId?: string
    action?: 'approve' | 'reject' | 'revoke' | 'block' | 'unblock'
  }
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }
  const subscriberUserId = typeof body.subscriberUserId === 'string' ? body.subscriberUserId : ''
  const subscriptionDocumentId = typeof body.subscriptionDocumentId === 'string' ? body.subscriptionDocumentId : ''
  const action = body.action
  if (!subscriberUserId || !subscriptionDocumentId || !action) {
    return NextResponse.json(
      { error: 'subscriberUserId, subscriptionDocumentId, and action are required' },
      { status: 400 }
    )
  }
  if (!['approve', 'reject', 'revoke', 'block', 'unblock'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  try {
    const plan = await getPlanById(uid, planId)
    if (!plan || plan.deletedAt) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }
    if (plan.isPersonal) {
      return NextResponse.json({ error: 'Personal plans do not have followers' }, { status: 400 })
    }
    await mutateWorkoutPlanSubscriptionForPlan(
      uid,
      planId,
      subscriberUserId,
      subscriptionDocumentId,
      action
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[app plan followers PATCH]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update follower' },
      { status: 500 }
    )
  }
}
