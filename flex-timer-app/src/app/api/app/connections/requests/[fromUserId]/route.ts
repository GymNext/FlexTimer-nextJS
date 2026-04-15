import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { RespondConnectionRequestError, rejectConnectionRequest } from '@/lib/connection-requests'

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

type RouteParams = Promise<{ fromUserId: string }>

/**
 * DELETE /api/app/connections/requests/[fromUserId]
 * Reject a pending connection request from that user.
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
  const { fromUserId } = await context.params
  const from = typeof fromUserId === 'string' ? fromUserId.trim() : ''
  if (!from) return bad('Invalid user id')

  try {
    await rejectConnectionRequest(uid, from)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof RespondConnectionRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[app connections requests fromUserId DELETE]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to reject invitation' },
      { status: 500 },
    )
  }
}
