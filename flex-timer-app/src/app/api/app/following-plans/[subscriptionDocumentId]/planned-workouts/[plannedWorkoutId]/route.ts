import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
  deletePlannedWorkout,
  getActiveWorkoutPlanSubscriptionById,
  getPlannedWorkout,
  updatePlannedWorkoutDayAndOrdinal,
  updatePlannedWorkoutWorkout,
  updatePlannedWorkoutWorkoutMetadata,
} from '@/lib/firestore'
import { isValidIanaTimeZone } from '@/lib/planned-workout-day-timestamp'
import { resolvePlanFollowAccessForSubscriber } from '@/lib/plan-share'

type RouteParams = Promise<{ subscriptionDocumentId: string; plannedWorkoutId: string }>

async function requireActiveSubscriptionEditor(
  subscriberUid: string,
  subscriptionDocumentId: string
): Promise<
  | { ok: true; ownerUserId: string; remotePlanId: string }
  | { ok: false; status: number; error: string }
> {
  const subscription = await getActiveWorkoutPlanSubscriptionById(subscriberUid, subscriptionDocumentId)
  if (!subscription) {
    return { ok: false, status: 404, error: 'Plan subscription not found' }
  }
  const access = await resolvePlanFollowAccessForSubscriber(
    subscriberUid,
    subscription.ownerUserId,
    subscription.remotePlanId,
    {
      followSource: subscription.followSource ?? null,
      followContextGroupId: subscription.followContextGroupId ?? null,
    }
  )
  if (!access.shareAllowEditing) {
    return { ok: false, status: 403, error: 'You do not have permission to modify this plan' }
  }
  return { ok: true, ownerUserId: subscription.ownerUserId, remotePlanId: subscription.remotePlanId }
}

/**
 * PATCH /api/app/following-plans/[subscriptionDocumentId]/planned-workouts/[plannedWorkoutId]
 * Same semantics as PATCH on owned plans, but writes the coach's planned workouts when the connection share allows editing.
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
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { subscriptionDocumentId, plannedWorkoutId } = await params
  if (!subscriptionDocumentId || !plannedWorkoutId) {
    return NextResponse.json({ error: 'subscriptionDocumentId and plannedWorkoutId required' }, { status: 400 })
  }

  let body: {
    day?: unknown
    ordinal?: unknown
    planId?: unknown
    workoutName?: unknown
    workoutDescription?: unknown
    workoutDetails?: unknown
    workout?: unknown
    planDayTimeZone?: unknown
  }
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }

  const gate = await requireActiveSubscriptionEditor(uid, subscriptionDocumentId)
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }
  const { ownerUserId, remotePlanId } = gate

  try {
    const plannedWorkout = await getPlannedWorkout(ownerUserId, plannedWorkoutId)
    if (!plannedWorkout || plannedWorkout.planId !== remotePlanId) {
      return NextResponse.json({ error: 'Planned workout not found' }, { status: 404 })
    }

    const workoutDetails =
      body.workoutDetails === null || typeof body.workoutDetails === 'string'
        ? (body.workoutDetails as string | null)
        : undefined

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
      await updatePlannedWorkoutWorkout(ownerUserId, plannedWorkoutId, merged)
      if (workoutDetails !== undefined) {
        await updatePlannedWorkoutWorkoutMetadata(ownerUserId, plannedWorkoutId, { workoutDetails })
      }
      const updated = await getPlannedWorkout(ownerUserId, plannedWorkoutId)
      return NextResponse.json(updated ?? plannedWorkout)
    }

    const day =
      typeof body.day === 'string'
        ? (body.day as string).slice(0, 10)
        : undefined
    const planDayTzBody =
      typeof body.planDayTimeZone === 'string' &&
      String(body.planDayTimeZone).trim() &&
      isValidIanaTimeZone(String(body.planDayTimeZone).trim())
        ? String(body.planDayTimeZone).trim()
        : null
    const ordinal =
      typeof body.ordinal === 'number'
        ? (body.ordinal as number)
        : undefined
    const bodyPlanId =
      typeof body.planId === 'string' && body.planId.trim() !== ''
        ? body.planId.trim()
        : undefined
    if (bodyPlanId !== undefined && bodyPlanId !== remotePlanId) {
      return NextResponse.json({ error: 'Cannot move workouts to another plan' }, { status: 400 })
    }

    const workoutName =
      body.workoutName === null || typeof body.workoutName === 'string'
        ? (body.workoutName as string | null)
        : undefined
    const workoutDescription =
      body.workoutDescription === null || typeof body.workoutDescription === 'string'
        ? (body.workoutDescription as string | null)
        : undefined

    if (workoutName !== undefined || workoutDescription !== undefined || workoutDetails !== undefined) {
      await updatePlannedWorkoutWorkoutMetadata(ownerUserId, plannedWorkoutId, {
        workoutName,
        workoutDescription,
        workoutDetails,
      })
      const updated = await getPlannedWorkout(ownerUserId, plannedWorkoutId)
      return NextResponse.json(updated ?? plannedWorkout)
    }

    if (
      day === undefined &&
      ordinal === undefined &&
      workoutName === undefined &&
      workoutDescription === undefined &&
      workoutDetails === undefined
    ) {
      return NextResponse.json(
        { error: 'Provide day, ordinal, or workout name/description/details' },
        { status: 400 }
      )
    }
    if (day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return NextResponse.json({ error: 'day must be YYYY-MM-DD' }, { status: 400 })
    }

    await updatePlannedWorkoutDayAndOrdinal(ownerUserId, plannedWorkoutId, {
      day,
      ordinal,
      planDayTimeZoneId: planDayTzBody,
    })
    const updated = await getPlannedWorkout(ownerUserId, plannedWorkoutId)
    return NextResponse.json(updated ?? plannedWorkout)
  } catch (err) {
    console.error('[app following-plans planned-workout PATCH]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update planned workout' },
      { status: 500 }
    )
  }
}

export async function DELETE(
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
  const { subscriptionDocumentId, plannedWorkoutId } = await params
  if (!subscriptionDocumentId || !plannedWorkoutId) {
    return NextResponse.json({ error: 'subscriptionDocumentId and plannedWorkoutId required' }, { status: 400 })
  }

  const gate = await requireActiveSubscriptionEditor(uid, subscriptionDocumentId)
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }
  const { ownerUserId, remotePlanId } = gate

  try {
    const plannedWorkout = await getPlannedWorkout(ownerUserId, plannedWorkoutId)
    if (!plannedWorkout || plannedWorkout.planId !== remotePlanId) {
      return NextResponse.json({ error: 'Planned workout not found' }, { status: 404 })
    }
    await deletePlannedWorkout(ownerUserId, plannedWorkoutId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[app following-plans planned-workout DELETE]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete planned workout' },
      { status: 500 }
    )
  }
}
