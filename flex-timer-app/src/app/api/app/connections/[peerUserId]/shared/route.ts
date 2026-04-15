import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { loadConnectionSharedLibrary } from '@/lib/connection-shared-library'
import { assertUsersAreConnected } from '@/lib/user-connections'

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

type RouteParams = Promise<{ peerUserId: string }>

/**
 * GET /api/app/connections/[peerUserId]/shared
 * Shared workouts, collections, and plans the **peer** shared **with** the viewer (incoming mirrors on
 * `users/{viewer}/shared*` only).
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
    const ok = await assertUsersAreConnected(uid, peer)
    if (!ok) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const library = await loadConnectionSharedLibrary(uid, peer)
    return NextResponse.json(library)
  } catch (err) {
    console.error('[app connections peerUserId shared GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load shared library' },
      { status: 500 }
    )
  }
}
