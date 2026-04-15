import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { listIncomingConnectionRequests, sendConnectionRequest } from '@/lib/connection-requests'

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

/**
 * GET /api/app/connections/requests
 * Pending connection invitations sent to the signed-in user.
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
    const requests = await listIncomingConnectionRequests(uid)
    return NextResponse.json({ requests })
  } catch (err) {
    console.error('[app connections requests GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load invitations' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/app/connections/requests
 * Body: { toUserId: string } — send a connection request to another user.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  let body: { toUserId?: string }
  try {
    body = (await request.json()) as { toUserId?: string }
  } catch {
    return bad('Invalid JSON')
  }
  const to = typeof body.toUserId === 'string' ? body.toUserId.trim() : ''
  if (!to) return bad('toUserId is required')
  if (to === uid) return bad('You cannot connect to yourself')

  try {
    const kind = await sendConnectionRequest(uid, to)
    return NextResponse.json({ ok: true, kind })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send request'
    console.error('[app connections requests POST]', err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
