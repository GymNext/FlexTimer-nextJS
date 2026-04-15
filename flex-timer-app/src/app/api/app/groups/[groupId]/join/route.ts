import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { JoinGroupError, joinOrRequestGroup } from '@/lib/join-group-as-member'

function jsonError(msg: string, status: number) {
  return NextResponse.json({ error: msg }, { status })
}

/**
 * POST /api/app/groups/[groupId]/join
 * Join a public hub, or submit a join request for a restricted hub.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }
  if (!adminAuth) {
    return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
  }

  const { uid } = authResult
  const { groupId } = await context.params
  const gid = typeof groupId === 'string' ? groupId.trim() : ''
  if (!gid) return jsonError('Invalid hub id', 400)

  try {
    const outcome = await joinOrRequestGroup(uid, gid)
    return NextResponse.json(outcome)
  } catch (err) {
    if (err instanceof JoinGroupError) {
      return jsonError(err.message, err.status)
    }
    console.error('[app groups join POST]', err)
    return jsonError(err instanceof Error ? err.message : 'Failed to join hub', 500)
  }
}
