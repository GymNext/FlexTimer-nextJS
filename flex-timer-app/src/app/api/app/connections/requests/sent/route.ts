import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { listOutgoingConnectionRequests } from '@/lib/connection-requests'

/**
 * GET /api/app/connections/requests/sent
 * Pending connection invitations the signed-in user sent to others.
 */
export async function GET(_request: NextRequest) {
  const authResult = await requireUserAuth(_request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  try {
    const requests = await listOutgoingConnectionRequests(uid)
    return NextResponse.json({ requests })
  } catch (err) {
    console.error('[app connections requests sent GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load sent invitations' },
      { status: 500 },
    )
  }
}
