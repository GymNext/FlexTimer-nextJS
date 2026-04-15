import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { loadGroupInvitePublicView } from '@/lib/group-invite'

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

type RouteParams = Promise<{ groupId: string }>

/**
 * GET /api/app/groups/[groupId]/invite-preview
 * Hub profile card: pending invite, owner, active member, or public/restricted hub
 * (private hubs require membership, invite, or ownership).
 */
export async function GET(
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
    const view = await loadGroupInvitePublicView(uid, gid)
    if (!view) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json(view)
  } catch (err) {
    console.error('[app groups invite-preview GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load hub' },
      { status: 500 },
    )
  }
}
