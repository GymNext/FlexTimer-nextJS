import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import {
  countGroupMembers,
  getOwnedGroupOrNull,
  isUserMemberOfGroup,
  listGroupMembersWithProfiles,
  listGroupMembersWithProfilesPage,
} from '@/lib/group-invite'

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

const PAGE_CAP = 25

/**
 * GET /api/app/groups/[groupId]/members
 * Owner-only: members with display name / handle (hub owner omitted from the list).
 * Query: limit=25&cursor=<userId> for pagination; omit limit to return all (small lists / invite browse).
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

  const ownerUserId =
    typeof owned.data.ownerUserId === 'string' && owned.data.ownerUserId.trim()
      ? owned.data.ownerUserId.trim()
      : null
  const omitOpts = ownerUserId ? { omitUserId: ownerUserId } : {}

  const limitRaw = request.nextUrl.searchParams.get('limit')
  if (limitRaw != null) {
    const limit = Math.min(PAGE_CAP, Math.max(1, Number.parseInt(limitRaw, 10) || PAGE_CAP))
    const cursor = request.nextUrl.searchParams.get('cursor')?.trim() || null
    const { members, nextCursor } = await listGroupMembersWithProfilesPage(gid, limit, cursor, omitOpts)
    let totalCount: number | null = null
    if (!cursor) {
      const raw = await countGroupMembers(gid)
      const ownerIn = ownerUserId ? await isUserMemberOfGroup(gid, ownerUserId) : false
      totalCount = Math.max(0, raw - (ownerIn ? 1 : 0))
    }
    return NextResponse.json({ members, nextCursor, totalCount })
  }

  const members = await listGroupMembersWithProfiles(gid, omitOpts)
  return NextResponse.json({ members })
}
