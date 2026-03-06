import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { createWorkoutPlan, getUserWorkoutPlans, updatePlanOrdinals } from '@/lib/firestore'
import { getSubscriptionLimits } from '@/lib/subscription-limits'

/**
 * GET /api/app/plans
 * Returns all workout plans for the signed-in user (excluding soft-deleted).
 */
export async function GET(request: NextRequest) {
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

  try {
    const allPlans = await getUserWorkoutPlans(uid)
    const workoutPlans = allPlans.filter((p) => !p.deletedAt)
    return NextResponse.json({ workoutPlans })
  } catch (err) {
    console.error('[app plans GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load plans' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/app/plans
 * Create a new workout plan for the signed-in user.
 * Body: { name: string, description?: string }
 */
export async function POST(request: NextRequest) {
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

  let body: { name?: string; description?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name : ''
  if (!name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const description = typeof body.description === 'string' ? body.description : null

  try {
    const [allPlans, limits] = await Promise.all([
      getUserWorkoutPlans(uid),
      getSubscriptionLimits(uid),
    ])
    const plansCount = allPlans.filter((p) => !p.deletedAt).length
    if (plansCount >= limits.maxPlans) {
      return NextResponse.json(
        {
          error:
            limits.maxPlans === 1
              ? 'Your plan allows 1 plan. Upgrade to add more.'
              : `Your plan allows up to ${limits.maxPlans} plans. Upgrade to add more.`,
          code: 'SUBSCRIPTION_LIMIT_PLANS',
        },
        { status: 403 }
      )
    }

    const plan = await createWorkoutPlan(uid, {
      name: name.trim(),
      description,
      isPersonal: false,
    })
    return NextResponse.json(plan, { status: 201 })
  } catch (err) {
    console.error('[app plans POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create plan' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/app/plans
 * Reorder plans. Body: { planIds: string[] } (plan IDs in desired order).
 */
export async function PATCH(request: NextRequest) {
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

  let body: { planIds?: unknown }
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const planIdsRaw = body.planIds
  if (!Array.isArray(planIdsRaw) || planIdsRaw.length === 0) {
    return NextResponse.json(
      { error: 'planIds (array of plan IDs) required' },
      { status: 400 }
    )
  }
  const planIds = planIdsRaw.filter((id): id is string => typeof id === 'string' && id.trim() !== '')

  try {
    const allPlans = await getUserWorkoutPlans(uid)
    const activePlanIds = new Set(allPlans.filter((p) => !p.deletedAt).map((p) => p.id))
    const validIds = planIds.filter((id) => activePlanIds.has(id))
    if (validIds.length !== planIds.length) {
      return NextResponse.json(
        { error: 'All planIds must belong to the user and not be deleted' },
        { status: 400 }
      )
    }
    await updatePlanOrdinals(uid, validIds)
    const updated = await getUserWorkoutPlans(uid)
    const workoutPlans = updated.filter((p) => !p.deletedAt)
    return NextResponse.json({ workoutPlans })
  } catch (err) {
    console.error('[app plans PATCH]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to reorder plans' },
      { status: 500 }
    )
  }
}

