import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { listActiveMembershipGroupIds, loadMembershipListItems } from '@/lib/group-memberships'

/**
 * GET /api/app/memberships
 * Groups where the user is an active member but not the owner (owned hubs are under Connect → Hubs).
 * Requires collection-group indexing on `members.userId` (see `firestore.indexes.json` fieldOverrides).
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
    const groupIds = await listActiveMembershipGroupIds(uid)
    const memberships = await loadMembershipListItems(groupIds, { excludeOwnerUserId: uid })
    return NextResponse.json({ memberships })
  } catch (err) {
    console.error('[app memberships GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load memberships' },
      { status: 500 },
    )
  }
}
