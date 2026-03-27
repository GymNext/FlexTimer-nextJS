import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { getActiveWorkoutPlanSubscriptionsForUser, getPlanById, getUserDocument } from '@/lib/firestore'
import { FieldValue } from 'firebase-admin/firestore'

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
    const followingPlans = await getActiveWorkoutPlanSubscriptionsForUser(uid)
    return NextResponse.json({ followingPlans })
  } catch (err) {
    console.error('[app following-plans GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load followed plans' },
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

  let body: { handleKey?: unknown }
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }
  const handleKeyRaw = typeof body.handleKey === 'string' ? body.handleKey.trim().toLowerCase() : ''
  const handleKey = handleKeyRaw.startsWith('@') ? handleKeyRaw.slice(1) : handleKeyRaw
  if (!handleKey) {
    return NextResponse.json({ error: 'handleKey required' }, { status: 400 })
  }

  const { uid } = authResult

  try {
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
      return NextResponse.json({ error: 'Plan is not followable' }, { status: 400 })
    }
    if (ownerUserId === uid) {
      return NextResponse.json({ error: 'You cannot follow your own plan' }, { status: 400 })
    }

    const plan = await getPlanById(ownerUserId, remotePlanId)
    if (!plan || plan.deletedAt) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    const status = privacy === 3 ? 'active' : 'pending'
    const subscriptionDocumentId = `${ownerUserId}_${remotePlanId}`

    const userDoc = await getUserDocument(uid)
    const firstName = typeof userDoc?.firstName === 'string' ? userDoc.firstName.trim() : ''
    const lastName = typeof userDoc?.lastName === 'string' ? userDoc.lastName.trim() : ''
    const subscriberFullName = `${firstName} ${lastName}`.trim() || null
    const subscriberPublicHandle =
      typeof userDoc?.publicHandle === 'string' && userDoc.publicHandle.trim()
        ? userDoc.publicHandle.trim()
        : null

    const ref = adminDb
      .collection('users')
      .doc(uid)
      .collection('workoutPlanSubscriptions')
      .doc(subscriptionDocumentId)

    await ref.set(
      {
        subscriberUserId: uid,
        ownerUserId,
        remotePlanId,
        status,
        remotePlanName: plan.workoutPlanName || null,
        remotePlanHandle: plan.handle ?? handleKey,
        ordinal: Date.now(),
        subscriberFullName,
        subscriberPublicHandle,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    return NextResponse.json({ ok: true, status })
  } catch (err) {
    console.error('[app following-plans POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to follow plan' },
      { status: 500 }
    )
  }
}
