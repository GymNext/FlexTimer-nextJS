import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import {
  EndUserConnectionError,
  endUserConnection,
  loadConnectionPeerDetail,
} from '@/lib/user-connections'

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

type RouteParams = Promise<{ peerUserId: string }>

/**
 * GET /api/app/connections/[peerUserId]
 * Public profile + connection metadata when the viewer is connected to the peer.
 */
export async function GET(
  request: NextRequest,
  context: { params: RouteParams }
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { peerUserId } = await context.params
  const peer = typeof peerUserId === 'string' ? peerUserId.trim() : ''
  if (!peer) return bad('Invalid user id')

  try {
    const detail = await loadConnectionPeerDetail(uid, peer)
    if (!detail) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json(detail)
  } catch (err) {
    console.error('[app connections peerUserId GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load connection' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/app/connections/[peerUserId]
 * Remove the mutual connection document (either participant may end the connection).
 */
export async function DELETE(
  request: NextRequest,
  context: { params: RouteParams }
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { peerUserId } = await context.params
  const peer = typeof peerUserId === 'string' ? peerUserId.trim() : ''
  if (!peer) return bad('Invalid user id')

  try {
    await endUserConnection(uid, peer)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof EndUserConnectionError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[app connections peerUserId DELETE]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to disconnect' },
      { status: 500 }
    )
  }
}
