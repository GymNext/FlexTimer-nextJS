import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { RespondConnectionRequestError, withdrawOutgoingConnectionRequest } from '@/lib/connection-requests'

type RouteParams = Promise<{ toUserId: string }>

/**
 * DELETE /api/app/connections/requests/sent/[toUserId]
 * Withdraw a pending connection request the signed-in user sent to `toUserId`.
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: RouteParams },
) {
  const authResult = await requireUserAuth(_request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { toUserId: rawTo } = await context.params
  const to = typeof rawTo === 'string' ? rawTo.trim() : ''
  if (!to) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })
  }

  try {
    await withdrawOutgoingConnectionRequest(uid, to)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof RespondConnectionRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[app connections requests sent toUserId DELETE]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to cancel invitation' },
      { status: 500 },
    )
  }
}
