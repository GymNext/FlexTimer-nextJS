import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { getOwnedGroupOrNull } from '@/lib/group-invite'
import { countPendingJoinRequests, listPendingJoinRequestsPage } from '@/lib/group-join-requests'

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

const PAGE_CAP = 25

/**
 * GET /api/app/groups/[groupId]/join-requests?limit=25&cursor=
 * Owner-only: pending join requests for restricted hubs (`groups/{id}/joinRequests`).
 * Includes docs with missing `status` (treated as pending), same as approve/reject.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
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

  const owned = await getOwnedGroupOrNull(uid, gid)
  if (!owned) return NextResponse.json({ error: 'Hub not found' }, { status: 404 })

  const limit = Math.min(
    PAGE_CAP,
    Math.max(1, Number.parseInt(request.nextUrl.searchParams.get('limit') ?? String(PAGE_CAP), 10) || PAGE_CAP),
  )
  const cursor = request.nextUrl.searchParams.get('cursor')?.trim() || null

  const { requests, nextCursor } = await listPendingJoinRequestsPage(gid, limit, cursor)
  const totalCount = cursor ? null : await countPendingJoinRequests(gid)

  return NextResponse.json({ requests, nextCursor, totalCount })
}
