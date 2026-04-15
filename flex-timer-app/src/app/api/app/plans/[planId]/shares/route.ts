import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { getPlanById } from '@/lib/firestore'
import { loadPublicUserProfileView } from '@/lib/public-profile-view'
import {
  listPlanGroupShares,
  listPlanUserShares,
  MAX_PLAN_SHARE_DESTINATIONS,
  sharePlanWithGroup,
  sharePlanWithUser,
  stopSharingPlanWithGroup,
  stopSharingPlanWithUser,
  countPlanShareDestinations,
  updatePlanGroupShareHideFuture,
  updatePlanUserShareFlags,
} from '@/lib/plan-share'

type RouteParams = Promise<{ planId: string }>

async function groupDisplayName(groupId: string): Promise<string> {
  if (!adminDb) return groupId
  const pub = await adminDb.collection('publicGroupProfiles').doc(groupId).get()
  if (!pub.exists) return groupId
  const n = String((pub.data() as Record<string, unknown>)?.name ?? '').trim()
  return n || groupId
}

export async function GET(
  request: NextRequest,
  { params }: { params: RouteParams }
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
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

    const [groupRows, userRows] = await Promise.all([listPlanGroupShares(uid, planId), listPlanUserShares(uid, planId)])

    const groupShares = await Promise.all(
      groupRows.map(async (r) => ({
        ...r,
        groupName: await groupDisplayName(r.groupId),
      }))
    )

    const userShares = await Promise.all(
      userRows.map(async (r) => {
        const prof = await loadPublicUserProfileView(r.peerUserId)
        return {
          ...r,
          displayName: prof.displayName,
          handle: prof.handle,
        }
      })
    )

    const destinationCount = await countPlanShareDestinations(uid, planId)

    return NextResponse.json({
      groupShares,
      userShares,
      destinationCount,
      maxDestinations: MAX_PLAN_SHARE_DESTINATIONS,
    })
  } catch (err) {
    console.error('[plan shares GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load shares' },
      { status: 500 }
    )
  }
}

function parseOptionalBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === true) return true
  if (value === false) return false
  return defaultValue
}

/**
 * POST /api/app/plans/[planId]/shares
 * Body: { target, groupId?, peerUserId?, comment?, hideFutureWorkouts?, allowEditing? }
 * - Hub (group): `hideFutureWorkouts` optional, default true.
 * - Connection + private training: `allowEditing` optional, default false; future visibility is always on (hideFutureWorkouts stored false).
 * - Connection + group training: `hideFutureWorkouts` optional, default true; allowEditing is always false.
 */
export async function POST(request: NextRequest, { params }: { params: RouteParams }) {
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
    target?: string
    groupId?: string
    peerUserId?: string
    comment?: string | null
    hideFutureWorkouts?: unknown
    allowEditing?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const target = body.target === 'group' || body.target === 'user' ? body.target : null
  if (!target) {
    return NextResponse.json({ error: 'target must be \"group\" or \"user\"' }, { status: 400 })
  }

  try {
    const plan = await getPlanById(uid, planId)
    if (!plan || plan.deletedAt) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }
    if (plan.isPersonal) {
      return NextResponse.json({ error: 'Personal plans cannot be shared' }, { status: 400 })
    }

    if (target === 'group') {
      if (plan.trainingIntent !== 1) {
        return NextResponse.json(
          { error: 'Private training plans can only be shared with connected people, not hubs' },
          { status: 400 }
        )
      }
      const gid = typeof body.groupId === 'string' ? body.groupId.trim() : ''
      if (!gid) {
        return NextResponse.json({ error: 'groupId is required' }, { status: 400 })
      }
      const hideFuture = parseOptionalBoolean(body.hideFutureWorkouts, true)
      await sharePlanWithGroup(uid, planId, gid, body.comment ?? null, hideFuture)
      return NextResponse.json({ ok: true })
    }

    const peer = typeof body.peerUserId === 'string' ? body.peerUserId.trim() : ''
    if (!peer) {
      return NextResponse.json({ error: 'peerUserId is required' }, { status: 400 })
    }
    const groupTraining = plan.trainingIntent === 1
    if (groupTraining) {
      const hideFuture = parseOptionalBoolean(body.hideFutureWorkouts, true)
      await sharePlanWithUser(uid, planId, peer, body.comment ?? null, false, hideFuture)
    } else {
      const allowEdit = parseOptionalBoolean(body.allowEditing, false)
      await sharePlanWithUser(uid, planId, peer, body.comment ?? null, allowEdit, false)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const e = err as Error & { status?: number }
    const status = typeof e.status === 'number' ? e.status : 500
    if (status >= 400 && status < 500) {
      return NextResponse.json({ error: e.message || 'Request failed' }, { status })
    }
    console.error('[plan shares POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to share plan' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/app/plans/[planId]/shares
 * Body: { target: 'group'|'user', groupId?, peerUserId?, hideFutureWorkouts?, allowEditing? }
 * Hub share: `hideFutureWorkouts` (boolean) required.
 * Connection + group training: `hideFutureWorkouts` (boolean) required.
 * Connection + private training: `allowEditing` (boolean) required.
 */
export async function PATCH(request: NextRequest, { params }: { params: RouteParams }) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { planId } = await params
  if (!planId) {
    return NextResponse.json({ error: 'planId required' }, { status: 400 })
  }

  let body: {
    target?: string
    groupId?: string
    peerUserId?: string
    allowEditing?: unknown
    hideFutureWorkouts?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const target = body.target === 'group' || body.target === 'user' ? body.target : null
  if (!target) {
    return NextResponse.json({ error: 'target must be "group" or "user"' }, { status: 400 })
  }

  try {
    const plan = await getPlanById(uid, planId)
    if (!plan || plan.deletedAt) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }
    if (plan.isPersonal) {
      return NextResponse.json({ error: 'Personal plans cannot be shared' }, { status: 400 })
    }

    if (target === 'group') {
      if (plan.trainingIntent !== 1) {
        return NextResponse.json(
          { error: 'Private training plans can only be shared with connected people, not hubs' },
          { status: 400 }
        )
      }
      const gid = typeof body.groupId === 'string' ? body.groupId.trim() : ''
      if (!gid) {
        return NextResponse.json({ error: 'groupId is required' }, { status: 400 })
      }
      if (typeof body.hideFutureWorkouts !== 'boolean') {
        return NextResponse.json(
          { error: 'hideFutureWorkouts (boolean) is required' },
          { status: 400 }
        )
      }
      await updatePlanGroupShareHideFuture(uid, planId, gid, body.hideFutureWorkouts)
      return NextResponse.json({ ok: true })
    }

    const peer = typeof body.peerUserId === 'string' ? body.peerUserId.trim() : ''
    if (!peer) {
      return NextResponse.json({ error: 'peerUserId is required' }, { status: 400 })
    }
    if (plan.trainingIntent === 1) {
      if (typeof body.hideFutureWorkouts !== 'boolean') {
        return NextResponse.json(
          { error: 'hideFutureWorkouts (boolean) is required' },
          { status: 400 }
        )
      }
      await updatePlanUserShareFlags(uid, planId, peer, {
        hideFutureWorkouts: body.hideFutureWorkouts,
      })
    } else {
      if (typeof body.allowEditing !== 'boolean') {
        return NextResponse.json(
          { error: 'allowEditing (boolean) is required' },
          { status: 400 }
        )
      }
      await updatePlanUserShareFlags(uid, planId, peer, { allowEditing: body.allowEditing })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const e = err as Error & { status?: number }
    const status = typeof e.status === 'number' ? e.status : 500
    if (status >= 400 && status < 500) {
      return NextResponse.json({ error: e.message || 'Request failed' }, { status })
    }
    console.error('[plan shares PATCH]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update share' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/app/plans/[planId]/shares?target=group&groupId=...
 * DELETE /api/app/plans/[planId]/shares?target=user&peerUserId=...
 */
export async function DELETE(request: NextRequest, { params }: { params: RouteParams }) {
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

  const url = new URL(request.url)
  const target = url.searchParams.get('target')
  if (target !== 'group' && target !== 'user') {
    return NextResponse.json({ error: 'target must be group or user' }, { status: 400 })
  }

  try {
    const plan = await getPlanById(uid, planId)
    if (!plan || plan.deletedAt) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    if (target === 'group') {
      const groupId = url.searchParams.get('groupId')?.trim() ?? ''
      if (!groupId) {
        return NextResponse.json({ error: 'groupId required' }, { status: 400 })
      }
      const feedHint = url.searchParams.get('groupFeedItemId')
      await stopSharingPlanWithGroup(uid, planId, groupId, feedHint)
      return new NextResponse(null, { status: 204 })
    }

    const peerUserId = url.searchParams.get('peerUserId')?.trim() ?? ''
    if (!peerUserId) {
      return NextResponse.json({ error: 'peerUserId required' }, { status: 400 })
    }
    const feedHint = url.searchParams.get('recipientFeedItemId')
    await stopSharingPlanWithUser(uid, planId, peerUserId, feedHint)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    const e = err as Error & { status?: number }
    const status = typeof e.status === 'number' ? e.status : 500
    if (status >= 400 && status < 500) {
      return NextResponse.json({ error: e.message || 'Request failed' }, { status })
    }
    console.error('[plan shares DELETE]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to remove share' },
      { status: 500 }
    )
  }
}
