import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import {
  countOutgoingPendingInvites,
  createGroupInvite,
  getOwnedGroupOrNull,
  listOutgoingPendingInvitesPage,
} from '@/lib/group-invite'

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

const PAGE_CAP = 25

/**
 * GET /api/app/groups/[groupId]/invites?limit=25&cursor=
 * Owner-only: pending invites you sent for this group.
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

  const { invites, nextCursor } = await listOutgoingPendingInvitesPage(gid, uid, limit, cursor)
  const totalCount = cursor ? null : await countOutgoingPendingInvites(gid, uid)

  return NextResponse.json({ invites, nextCursor, totalCount })
}

/**
 * POST /api/app/groups/[groupId]/invites
 * Body: { invitedUserId: string }
 */
export async function POST(request: NextRequest, context: { params: Promise<{ groupId: string }> }) {
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

  let body: { invitedUserId?: unknown }
  try {
    body = (await request.json()) as { invitedUserId?: unknown }
  } catch {
    return bad('Invalid JSON')
  }

  const invitedUserId = typeof body.invitedUserId === 'string' ? body.invitedUserId.trim() : ''
  if (!invitedUserId) return bad('invitedUserId is required')

  const parentRaw = owned.data.parentGroupId
  const parentGroupId =
    typeof parentRaw === 'string' && parentRaw.trim() !== '' ? parentRaw.trim() : null

  try {
    const result = await createGroupInvite({
      groupId: gid,
      invitedUserId,
      invitedByUserId: uid,
      parentGroupId,
    })
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create invite'
    if (msg.includes('You cannot invite yourself')) return bad(msg)
    if (msg.includes('must be a member of the parent hub')) {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    console.error('[app groups invites POST]', err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
