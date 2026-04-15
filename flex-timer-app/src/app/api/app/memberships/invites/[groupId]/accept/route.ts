import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { acceptPendingHubInvite, RespondGroupInviteError } from '@/lib/group-invite'

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

type RouteParams = Promise<{ groupId: string }>

/**
 * POST /api/app/memberships/invites/[groupId]/accept
 * Accept a pending hub invitation and join as an active member.
 */
export async function POST(
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
  const { groupId } = await context.params
  const gid = typeof groupId === 'string' ? groupId.trim() : ''
  if (!gid) return bad('Invalid hub id')

  try {
    await acceptPendingHubInvite(uid, gid)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof RespondGroupInviteError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[app memberships invites accept POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to accept invitation' },
      { status: 500 },
    )
  }
}
