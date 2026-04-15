import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import {
  getActiveWorkoutPlanSubscriptionsForUser,
  getPlanById,
  getUserDocument,
  updateWorkoutPlanSubscriptionOrdinals,
} from '@/lib/firestore'
import { viewerCanAccessSharedLibraryItem } from '@/lib/shared-resource-access'
import type { WorkoutPlan } from '@/types/user'
import { FieldValue } from 'firebase-admin/firestore'
import { resolvePlanFollowAccessForSubscriber } from '@/lib/plan-share'

function remotePlanKindFromLivePlan(plan: WorkoutPlan | null | undefined): {
  remotePlanIsPersonal?: boolean
  remotePlanTrainingIntent?: 0 | 1
} {
  if (!plan || plan.deletedAt) return {}
  if (plan.isPersonal) return { remotePlanIsPersonal: true }
  return {
    remotePlanIsPersonal: false,
    remotePlanTrainingIntent: plan.trainingIntent === 1 ? 1 : 0,
  }
}

async function persistPlanFollow(
  uid: string,
  ownerUserId: string,
  remotePlanId: string,
  plan: WorkoutPlan,
  status: 'active' | 'pending',
  remotePlanHandle: string | null
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const subscriptionDocumentId = `${ownerUserId}_${remotePlanId}`

  const userDoc = await getUserDocument(uid)
  const firstName = typeof userDoc?.firstName === 'string' ? userDoc.firstName.trim() : ''
  const lastName = typeof userDoc?.lastName === 'string' ? userDoc.lastName.trim() : ''
  const subscriberFullName = `${firstName} ${lastName}`.trim() || null
  const subscriberHandle =
    typeof userDoc?.handleKey === 'string' && userDoc.handleKey.trim() !== ''
      ? userDoc.handleKey.trim().toLowerCase()
      : typeof userDoc?.handle === 'string' && userDoc.handle.trim() !== ''
        ? userDoc.handle.trim().replace(/^@/, '').toLowerCase()
        : null

  const ref = adminDb
    .collection('users')
    .doc(uid)
    .collection('workoutPlanSubscriptions')
    .doc(subscriptionDocumentId)

  const desc = plan.workoutPlanDescription?.trim() || null
  await ref.set(
    {
      subscriberUserId: uid,
      ownerUserId,
      remotePlanId,
      status,
      remotePlanName: plan.workoutPlanName || null,
      remotePlanHandle: plan.handle ?? remotePlanHandle ?? null,
      ...(desc ? { planDescriptionSnapshot: desc } : { planDescriptionSnapshot: FieldValue.delete() }),
      ordinal: Date.now(),
      subscriberFullName,
      subscriberHandle,
      subscriberPublicHandle: FieldValue.delete(),
      shareAllowEditing: false,
      shareHideFutureWorkouts: false,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )
}

/** Matches iOS `followWorkoutPlanFromGroupShare`: always active, `followSource: groupFeed`, optional snapshots. */
async function persistGroupFeedPlanFollow(
  uid: string,
  ownerUserId: string,
  remotePlanId: string,
  opts: {
    displayName: string | null
    description: string | null
    remotePlanHandle: string | null
    followContextGroupId?: string | null
  }
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const subscriptionDocumentId = `${ownerUserId}_${remotePlanId}`
  const owner = ownerUserId.trim()
  const pid = remotePlanId.trim()
  const gid = opts.followContextGroupId?.trim() ?? ''

  const userDoc = await getUserDocument(uid)
  const firstName = typeof userDoc?.firstName === 'string' ? userDoc.firstName.trim() : ''
  const lastName = typeof userDoc?.lastName === 'string' ? userDoc.lastName.trim() : ''
  const subscriberFullName = `${firstName} ${lastName}`.trim() || null
  const subscriberHandle =
    typeof userDoc?.handleKey === 'string' && userDoc.handleKey.trim() !== ''
      ? userDoc.handleKey.trim().toLowerCase()
      : typeof userDoc?.handle === 'string' && userDoc.handle.trim() !== ''
        ? userDoc.handle.trim().replace(/^@/, '').toLowerCase()
        : null

  const ref = adminDb
    .collection('users')
    .doc(uid)
    .collection('workoutPlanSubscriptions')
    .doc(subscriptionDocumentId)

  let shareHideFutureWorkouts = true
  if (gid) {
    const itemSnap = await adminDb
      .collection('users')
      .doc(owner)
      .collection('planGroupShares')
      .doc(pid)
      .collection('items')
      .doc(gid)
      .get()
    if (itemSnap.exists) {
      const raw = (itemSnap.data() as Record<string, unknown>)?.hideFutureWorkouts
      shareHideFutureWorkouts = typeof raw === 'boolean' ? raw : true
    }
  }

  const data: Record<string, unknown> = {
    subscriberUserId: uid,
    ownerUserId,
    remotePlanId,
    status: 'active',
    followSource: 'groupFeed',
    ordinal: Date.now(),
    subscriberFullName,
    subscriberHandle,
    subscriberPublicHandle: FieldValue.delete(),
    shareAllowEditing: false,
    shareHideFutureWorkouts,
    updatedAt: FieldValue.serverTimestamp(),
  }
  if (gid) {
    data.followContextGroupId = gid
  }

  const name = opts.displayName?.trim() || null
  if (name) {
    data.remotePlanName = name
    data.planNameSnapshot = name
  }
  const desc = opts.description?.trim() || null
  if (desc) {
    data.planDescriptionSnapshot = desc
  }
  const handle = opts.remotePlanHandle?.trim() || null
  if (handle) {
    data.remotePlanHandle = handle
  }

  await ref.set(data, { merge: true })
}

/**
 * PATCH /api/app/following-plans
 * Reorder active subscriptions. Body: { subscriptionDocumentIds: string[] } (every active subscription id, in order).
 */
export async function PATCH(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  let body: { subscriptionDocumentIds?: unknown }
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = body.subscriptionDocumentIds
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json(
      { error: 'subscriptionDocumentIds (non-empty array) required' },
      { status: 400 }
    )
  }
  const ids = raw.filter((id): id is string => typeof id === 'string' && id.trim() !== '')

  try {
    await updateWorkoutPlanSubscriptionOrdinals(uid, ids)
    const subs = await getActiveWorkoutPlanSubscriptionsForUser(uid)
    const followingPlans = await Promise.all(
      subs.map(async (sub) => {
        const plan = await getPlanById(sub.ownerUserId, sub.remotePlanId)
        const live =
          plan && !plan.deletedAt ? (plan.workoutPlanDescription ?? '').trim() || null : null
        const remotePlanDescription = live ?? sub.remotePlanDescription ?? null
        const access = await resolvePlanFollowAccessForSubscriber(uid, sub.ownerUserId, sub.remotePlanId, {
          followSource: sub.followSource ?? null,
          followContextGroupId: sub.followContextGroupId ?? null,
        })
        return { ...sub, remotePlanDescription, ...remotePlanKindFromLivePlan(plan), ...access }
      })
    )
    return NextResponse.json({ followingPlans })
  } catch (err) {
    console.error('[app following-plans PATCH]', err)
    const message = err instanceof Error ? err.message : 'Failed to reorder subscriptions'
    const status = message.includes('exactly once') ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function GET(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  try {
    const { uid } = authResult
    const subs = await getActiveWorkoutPlanSubscriptionsForUser(uid)
    const followingPlans = await Promise.all(
      subs.map(async (sub) => {
        const plan = await getPlanById(sub.ownerUserId, sub.remotePlanId)
        const live =
          plan && !plan.deletedAt ? (plan.workoutPlanDescription ?? '').trim() || null : null
        const remotePlanDescription = live ?? sub.remotePlanDescription ?? null
        const access = await resolvePlanFollowAccessForSubscriber(uid, sub.ownerUserId, sub.remotePlanId, {
          followSource: sub.followSource ?? null,
          followContextGroupId: sub.followContextGroupId ?? null,
        })
        return { ...sub, remotePlanDescription, ...remotePlanKindFromLivePlan(plan), ...access }
      })
    )
    return NextResponse.json({ followingPlans })
  } catch (err) {
    console.error('[app following-plans GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load plan subscriptions' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  let body: {
    handleKey?: unknown
    ownerUserId?: unknown
    remotePlanId?: unknown
    groupId?: unknown
    planNameSnapshot?: unknown
    planDescriptionSnapshot?: unknown
  }
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }

  const handleKeyRaw = typeof body.handleKey === 'string' ? body.handleKey.trim().toLowerCase() : ''
  const handleKey = handleKeyRaw.startsWith('@') ? handleKeyRaw.slice(1) : handleKeyRaw
  const ownerFromBody = typeof body.ownerUserId === 'string' ? body.ownerUserId.trim() : ''
  const remotePlanFromBody = typeof body.remotePlanId === 'string' ? body.remotePlanId.trim() : ''
  const contextGroupId =
    typeof body.groupId === 'string' && body.groupId.trim() !== '' ? body.groupId.trim() : null
  const planNameFromBody =
    typeof body.planNameSnapshot === 'string' ? body.planNameSnapshot.trim() : ''
  const planDescFromBody =
    typeof body.planDescriptionSnapshot === 'string' ? body.planDescriptionSnapshot.trim() : ''

  const { uid } = authResult

  try {
    if (ownerFromBody && remotePlanFromBody) {
      const allowed = await viewerCanAccessSharedLibraryItem(
        uid,
        ownerFromBody,
        'plan',
        remotePlanFromBody,
        contextGroupId,
      )
      if (!allowed) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (ownerFromBody === uid) {
        return NextResponse.json({ error: 'You cannot subscribe to your own plan' }, { status: 400 })
      }
      const plan = await getPlanById(ownerFromBody, remotePlanFromBody)
      if (plan?.deletedAt) {
        return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
      }
      const displayName =
        (plan?.workoutPlanName?.trim() || '') ||
        planNameFromBody ||
        null
      const description =
        (plan?.workoutPlanDescription?.trim() || '') || planDescFromBody || null
      await persistGroupFeedPlanFollow(uid, ownerFromBody, remotePlanFromBody, {
        displayName,
        description,
        remotePlanHandle: plan?.handle?.trim() || null,
        followContextGroupId: contextGroupId,
      })
      return NextResponse.json({ ok: true, status: 'active' })
    }

    if (!handleKey) {
      return NextResponse.json(
        { error: 'handleKey or ownerUserId+remotePlanId required' },
        { status: 400 },
      )
    }

    const indexSnap = await adminDb.collection('workoutPlanHandleIndex').doc(handleKey).get()
    if (!indexSnap.exists) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }
    const idx = indexSnap.data() as Record<string, unknown>
    const ownerUserId = typeof idx.ownerUserId === 'string' ? idx.ownerUserId : ''
    const remotePlanId = typeof idx.planId === 'string' ? idx.planId : ''
    const privacy = typeof idx.privacy === 'number' ? idx.privacy : null
    const planDeleted = idx.planDeleted === true
    if (!ownerUserId || !remotePlanId || planDeleted) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }
    if (privacy !== 2 && privacy !== 3) {
      return NextResponse.json({ error: 'Plan is not available for subscription' }, { status: 400 })
    }
    if (ownerUserId === uid) {
      return NextResponse.json({ error: 'You cannot subscribe to your own plan' }, { status: 400 })
    }

    const plan = await getPlanById(ownerUserId, remotePlanId)
    if (!plan || plan.deletedAt) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    const status = privacy === 3 ? 'active' : 'pending'
    await persistPlanFollow(uid, ownerUserId, remotePlanId, plan, status, handleKey)

    return NextResponse.json({ ok: true, status })
  } catch (err) {
    console.error('[app following-plans POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to subscribe to plan' },
      { status: 500 }
    )
  }
}
