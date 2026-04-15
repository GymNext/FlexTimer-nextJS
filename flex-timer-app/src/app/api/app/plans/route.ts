import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
  createWorkoutPlan,
  getUserWorkoutPlans,
  ownedPlanOrdinalSection,
  updatePlanOrdinals,
  updatePlanOrdinalsForSection,
  type OwnedPlanOrdinalSection,
} from '@/lib/firestore'
import { getSubscriptionLimits } from '@/lib/subscription-limits'

function parseTrainingIntentInput(raw: unknown): 0 | 1 | undefined {
  if (raw === 0 || raw === '0') return 0
  if (raw === 1 || raw === '1') return 1
  return undefined
}

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
 * Body: { name, description?, isPersonal?, trainingIntent?: 0 | 1 | "0" | "1" } (numeric only; 0 = private training, 1 = group training; non-personal defaults to 0)
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

  let body: {
    name?: string
    description?: string
    isPersonal?: boolean
    trainingIntent?: unknown
  }
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
  const isPersonal = body.isPersonal === true
  const trainingIntentParsed = parseTrainingIntentInput(body.trainingIntent)
  if (!isPersonal && body.trainingIntent != null && trainingIntentParsed === undefined) {
    return NextResponse.json(
      { error: 'trainingIntent must be 0 or 1 for non-personal plans' },
      { status: 400 }
    )
  }

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
      isPersonal,
      ...(!isPersonal ? { trainingIntent: trainingIntentParsed ?? 0 } : {}),
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
 * Reorder plans.
 * - Body `{ planSection, planIds }`: set ordinals within one bucket (personal | privateTraining | groupTraining).
 * - Body `{ planIds }` only: legacy global reorder — must include every active plan id exactly once.
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

  let body: { planIds?: unknown; planSection?: unknown }
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

  const sectionRaw = body.planSection
  const planSection: OwnedPlanOrdinalSection | null =
    sectionRaw === 'personal' || sectionRaw === 'privateTraining' || sectionRaw === 'groupTraining'
      ? sectionRaw
      : null

  try {
    const allPlans = await getUserWorkoutPlans(uid)
    const active = allPlans.filter((p) => !p.deletedAt)
    const activePlanIds = new Set(active.map((p) => p.id))
    const validIds = planIds.filter((id) => activePlanIds.has(id))
    if (validIds.length !== planIds.length) {
      return NextResponse.json(
        { error: 'All planIds must belong to the user and not be deleted' },
        { status: 400 }
      )
    }

    if (planSection) {
      for (const id of validIds) {
        const p = active.find((x) => x.id === id)
        if (!p || ownedPlanOrdinalSection(p) !== planSection) {
          return NextResponse.json(
            { error: 'Each planId must belong to the given planSection' },
            { status: 400 }
          )
        }
      }
      const inSection = active.filter((p) => ownedPlanOrdinalSection(p) === planSection)
      if (validIds.length !== inSection.length) {
        return NextResponse.json(
          { error: 'planIds must list every plan in this section exactly once' },
          { status: 400 }
        )
      }
      await updatePlanOrdinalsForSection(uid, planSection, validIds)
    } else {
      if (validIds.length !== active.length) {
        return NextResponse.json(
          { error: 'planIds must include every active plan when planSection is omitted' },
          { status: 400 }
        )
      }
      await updatePlanOrdinals(uid, validIds)
    }

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

