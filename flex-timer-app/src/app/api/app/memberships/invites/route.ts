import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { listIncomingHubInvitesForUser } from '@/lib/group-invite'

/**
 * GET /api/app/memberships/invites
 * Pending hub invitations sent to the signed-in user.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  try {
    const invites = await listIncomingHubInvitesForUser(uid)
    return NextResponse.json({ invites })
  } catch (err) {
    console.error('[app memberships invites GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load invitations' },
      { status: 500 },
    )
  }
}
