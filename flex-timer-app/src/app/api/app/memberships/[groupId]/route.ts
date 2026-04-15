import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase-admin'
import { listActiveGroupMembersExcluding } from '@/lib/group-invite'
import { loadMembershipGroupDetail } from '@/lib/group-memberships'
import { LeaveMembershipError, leaveGroupMembership } from '@/lib/leave-group-membership'

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

function memberDocTimestampIso(d: Record<string, unknown>, key: string): string | null {
  const v = d[key]
  if (v == null) return null
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (
    typeof v === 'object' &&
    v !== null &&
    'toDate' in v &&
    typeof (v as { toDate: () => Date }).toDate === 'function'
  ) {
    try {
      return (v as { toDate: () => Date }).toDate().toISOString()
    } catch {
      return null
    }
  }
  return null
}

/**
 * GET /api/app/memberships/[groupId]
 * Hub details for an active member (not owner-only).
 * Member list is omitted for `joinPolicy === 'public'` (large hubs); response includes `members: []`.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
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
  if (!gid) return bad('Invalid hub id')

  try {
    if (!adminDb) {
      return NextResponse.json({ error: 'Firebase Admin not configured' }, { status: 503 })
    }
    const mSnap = await adminDb.collection('groups').doc(gid).collection('members').doc(uid).get()
    if (!mSnap.exists) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const mData = mSnap.data() as Record<string, unknown>
    const st = mData.status
    if (typeof st === 'string' && st !== 'active') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const roleRaw = mData.role
    const role = typeof roleRaw === 'string' && roleRaw.trim() ? roleRaw.trim() : null

    const gSnap = await adminDb.collection('groups').doc(gid).get()
    if (!gSnap.exists) {
      return NextResponse.json({ error: 'Hub not found' }, { status: 404 })
    }
    const gd = gSnap.data() as Record<string, unknown>
    if (gd.deletedAt != null) {
      return NextResponse.json({ error: 'Hub not found' }, { status: 404 })
    }
    const owner = typeof gd.ownerUserId === 'string' ? gd.ownerUserId.trim() : ''
    if (owner === uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const detail = await loadMembershipGroupDetail(gid, role)
    if (!detail) {
      return NextResponse.json({ error: 'Hub not found' }, { status: 404 })
    }
    const members =
      detail.joinPolicy === 'public' ? [] : await listActiveGroupMembersExcluding(gid, uid)
    const memberJoinedAt =
      memberDocTimestampIso(mData, 'joinedAt') ?? memberDocTimestampIso(mData, 'createdAt')
    return NextResponse.json({ ...detail, members, memberJoinedAt })
  } catch (err) {
    console.error('[app memberships groupId GET]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load hub' },
      { status: 500 },
    )
  }
}

/**
 * DELETE /api/app/memberships/[groupId]
 * Leave a hub as a non-owning member (removes `members/{uid}`).
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
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
  if (!gid) return bad('Invalid hub id')

  try {
    await leaveGroupMembership(uid, gid)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof LeaveMembershipError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[app memberships groupId DELETE]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to leave hub' },
      { status: 500 },
    )
  }
}
