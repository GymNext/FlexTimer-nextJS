import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
  clearPlanDeletedAt,
  deletePlan,
  getPlanById,
  setPlanDeletedAt,
  updatePlanMetadata,
} from '@/lib/firestore'

type RouteParams = Promise<{ planId: string }>

function parseTrainingIntentPatch(raw: unknown): 0 | 1 | undefined {
  if (raw === 0 || raw === '0') return 0
  if (raw === 1 || raw === '1') return 1
  return undefined
}

/**
 * GET /api/app/plans/[planId]
 * Returns a single workout plan belonging to the signed-in user.
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

  try {
    const plan = await getPlanById(uid, planId)
    if (!plan || plan.deletedAt) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }
    return NextResponse.json(plan)
  } catch (err) {
    console.error('[app plan GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch plan' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/app/plans/[planId]
 * Soft-deletes or recovers a plan. Body: { recover: true } to recover.
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
  const { planId } = await params
  if (!planId) {
    return NextResponse.json({ error: 'planId required' }, { status: 400 })
  }

  let body: {
    recover?: boolean
    workoutPlanName?: string
    workoutPlanDescription?: string | null
    privacy?: number
    handle?: string | null
    trainingIntent?: unknown
    showInSchedule?: unknown
  }
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }

  try {
    const plan = await getPlanById(uid, planId)
    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    const trainingIntentNext = parseTrainingIntentPatch(body.trainingIntent)
    if (
      'trainingIntent' in body &&
      trainingIntentNext !== 0 &&
      trainingIntentNext !== 1
    ) {
      return NextResponse.json(
        { error: 'trainingIntent must be 0 or 1' },
        { status: 400 }
      )
    }

    const hasNameUpdate = typeof body.workoutPlanName === 'string'
    const hasSharingUpdate = typeof body.privacy === 'number' || 'handle' in body
    const hasTrainingIntentUpdate = trainingIntentNext === 0 || trainingIntentNext === 1
    const hasShowInScheduleUpdate = typeof body.showInSchedule === 'boolean'
    // Update plan metadata/sharing when provided.
    if (hasNameUpdate || hasSharingUpdate || hasTrainingIntentUpdate || hasShowInScheduleUpdate) {
      const patch: {
        name?: string
        description?: string | null
        privacy?: number
        handle?: string | null
        trainingIntent?: 0 | 1
        showInSchedule?: boolean
      } = {}
      if (hasNameUpdate) {
        const name = body.workoutPlanName!.trim()
        if (!name) {
          return NextResponse.json({ error: 'Plan name is required' }, { status: 400 })
        }
        patch.name = name
        patch.description = body.workoutPlanDescription
      }
      if (hasTrainingIntentUpdate) {
        if (plan.isPersonal) {
          return NextResponse.json(
            { error: 'Personal plans cannot set training intent' },
            { status: 400 }
          )
        }
        const currentResolved =
          plan.trainingIntent === 1 ? 1 : plan.trainingIntent === 0 ? 0 : null
        if (currentResolved === null) {
          patch.trainingIntent = trainingIntentNext
        } else if (trainingIntentNext !== currentResolved) {
          return NextResponse.json(
            {
              error:
                'Training type (private vs group training) cannot be changed after the plan is created.',
            },
            { status: 400 }
          )
        }
      }
      if (typeof body.privacy === 'number') {
        if (![1, 2, 3].includes(body.privacy)) {
          return NextResponse.json({ error: 'Invalid privacy value' }, { status: 400 })
        }
        if (plan.isPersonal && body.privacy !== 1) {
          return NextResponse.json(
            { error: 'Personal plans cannot be shared' },
            { status: 400 }
          )
        }
        patch.privacy = body.privacy
      }
      if ('handle' in body) {
        if (plan.isPersonal && typeof body.handle === 'string' && body.handle.trim()) {
          return NextResponse.json(
            { error: 'Personal plans cannot be shared' },
            { status: 400 }
          )
        }
        patch.handle = typeof body.handle === 'string' ? body.handle : null
      }
      if (hasShowInScheduleUpdate) {
        patch.showInSchedule = body.showInSchedule as boolean
      }
      await updatePlanMetadata(uid, planId, patch)
      const updated = await getPlanById(uid, planId)
      return NextResponse.json(updated)
    }

    if (body.recover === true) {
      if (!plan.deletedAt) {
        return NextResponse.json({ error: 'Plan is not deleted' }, { status: 400 })
      }
      await clearPlanDeletedAt(uid, planId)
      return NextResponse.json({ ok: true })
    }

    if (plan.deletedAt) {
      return NextResponse.json({ error: 'Plan is already deleted' }, { status: 400 })
    }
    if (planId === 'personal') {
      return NextResponse.json(
        { error: 'The personal plan cannot be deleted' },
        { status: 403 }
      )
    }
    await setPlanDeletedAt(uid, planId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[app plan PATCH]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update plan' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/app/plans/[planId]
 * Permanently deletes a soft-deleted workout plan and its plan days.
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
  const { planId } = await params
  if (!planId) {
    return NextResponse.json({ error: 'planId required' }, { status: 400 })
  }

  try {
    const plan = await getPlanById(uid, planId)
    if (!plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }
    if (planId === 'personal') {
      return NextResponse.json(
        { error: 'The personal plan cannot be deleted' },
        { status: 403 }
      )
    }
    if (!plan.deletedAt) {
      return NextResponse.json(
        { error: 'Plan must be soft-deleted before permanent deletion' },
        { status: 400 }
      )
    }
    await deletePlan(uid, planId)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error('[app plan DELETE]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete plan' },
      { status: 500 }
    )
  }
}

