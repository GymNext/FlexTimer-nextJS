import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { loadConnectionSharedLibrary } from '@/lib/connection-shared-library'
import { loadHubSharedLibrary } from '@/lib/group-feed'
import { listActiveMembershipGroupIds, loadMembershipGroupDetail } from '@/lib/group-memberships'
import { loadUserConnectionsList } from '@/lib/user-connections'

/**
 * GET /api/app/connections/shared
 * Aggregates shared workouts, collections, and plans **shared with the viewer** from:
 * - mutual connections (incoming only: `users/{uid}/shared*` mirrors owned by each peer), and
 * - hubs you belong to (`groups/{id}/feed` share rows), excluding feed posts authored by the viewer.
 */
export async function GET(_request: NextRequest) {
  const authResult = await requireUserAuth(_request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult

  try {
    const [connections, membershipIds] = await Promise.all([
      loadUserConnectionsList(uid),
      listActiveMembershipGroupIds(uid),
    ])
    const totalMemberships = membershipIds.length

    const peerRows = await Promise.all(
      connections.map(async (c) => {
        const lib = await loadConnectionSharedLibrary(uid, c.peerUserId)
        return {
          peerUserId: c.peerUserId,
          displayName: c.displayName,
          handle: c.handle,
          workouts: lib.workouts,
          collections: lib.collections,
          plans: lib.plans,
        }
      })
    )

    const peers = peerRows.filter(
      (p) => p.workouts.length + p.collections.length + p.plans.length > 0
    )

    const hubLibs = await Promise.all(
      membershipIds.map(async (groupId) => {
        const lib = await loadHubSharedLibrary(groupId, { omitFeedDocsWhereActorUserId: uid })
        return { groupId, lib }
      })
    )

    const hubsWithItems = hubLibs.filter(
      ({ lib }) => lib.workouts.length + lib.collections.length + lib.plans.length > 0
    )

    const hubs = await Promise.all(
      hubsWithItems.map(async ({ groupId, lib }) => {
        const detail = await loadMembershipGroupDetail(groupId, null)
        const name = detail?.name?.trim() || 'Hub'
        const h = detail?.handle?.trim() || null
        return {
          groupId,
          displayName: name,
          handle: h,
          workouts: lib.workouts,
          collections: lib.collections,
          plans: lib.plans,
        }
      })
    )

    return NextResponse.json({
      peers,
      hubs,
      totalConnections: connections.length,
      totalMemberships,
    })
  } catch (err) {
    console.error('[app connections shared GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load shared content' },
      { status: 500 }
    )
  }
}
