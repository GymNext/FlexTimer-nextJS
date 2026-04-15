import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { getOwnedGroupsForUser } from '@/lib/firestore'
import { ownedHubJoinRequestBadgeMapFromFlat } from '@/lib/owned-hub-join-request-badges'

/**
 * GET /api/app/owned-groups/join-request-badges
 * Totals pending join requests across owned restricted hubs (for nav badging).
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
    const flat = await getOwnedGroupsForUser(uid)
    const { total } = await ownedHubJoinRequestBadgeMapFromFlat(flat)
    return NextResponse.json({ total })
  } catch (err) {
    console.error('[app owned-groups join-request-badges]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load join request counts' },
      { status: 500 }
    )
  }
}
