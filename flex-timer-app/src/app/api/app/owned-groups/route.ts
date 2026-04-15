import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { getOwnedGroupsForUser } from '@/lib/firestore'
import { buildOwnedHubTree } from '@/lib/build-owned-hub-tree'
import {
  attachJoinRequestCountsToHubTree,
  ownedHubJoinRequestBadgeMapFromFlat,
} from '@/lib/owned-hub-join-request-badges'

/**
 * GET /api/app/owned-groups
 * Returns hierarchical hubs the signed-in user owns (`groups` / subgroups via `parentGroupId`).
 * Each node may include `pendingJoinRequestCount` for restricted hubs; `pendingJoinRequestTotal` sums them.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult

  try {
    const flat = await getOwnedGroupsForUser(uid)
    const hubs = buildOwnedHubTree(flat)
    const { byGroupId, total } = await ownedHubJoinRequestBadgeMapFromFlat(flat)
    const hubsWithBadges = attachJoinRequestCountsToHubTree(hubs, byGroupId)
    return NextResponse.json({ hubs: hubsWithBadges, pendingJoinRequestTotal: total })
  } catch (err) {
    console.error('[app owned-groups]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load hubs' },
      { status: 500 }
    )
  }
}
