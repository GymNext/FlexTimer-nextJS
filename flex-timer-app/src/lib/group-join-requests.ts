import { FieldPath, FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import { appendUserJoinGroupFeedItem } from '@/lib/group-feed-user-join'
import {
  getOwnedGroupOrNull,
  getPublicProfileSnippet,
  isUserMemberOfGroup,
  setGroupMembershipIndexForMemberInBatch,
} from '@/lib/group-invite'
import { parseFirestoreJoinPolicy } from '@/types/group'

const GROUPS = 'groups'
const PUBLIC_GROUP_PROFILES = 'publicGroupProfiles'

function str(d: Record<string, unknown>, key: string): string {
  const v = d[key]
  return typeof v === 'string' ? v : ''
}

/**
 * Matches {@link approveJoinRequestAsOwner}: missing/blank status counts as pending.
 * Firestore `where('status','==','pending')` omits docs with no `status` field — those must still list.
 */
function joinRequestDocIsPending(data: Record<string, unknown> | undefined): boolean {
  if (!data) return true
  const s = str(data, 'status').trim().toLowerCase()
  if (s === '' || s === 'pending') return true
  if (s === 'rejected' || s === 'approved' || s === 'cancelled' || s === 'denied' || s === 'declined') return false
  return true
}

export type JoinRequestListItem = {
  userId: string
  displayName: string
  handle: string | null
}

export class JoinRequestActionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'JoinRequestActionError'
  }
}

const JOIN_REQUEST_SCAN_BATCH = 100

/** Owner dashboard: pending `groups/{groupId}/joinRequests` (restricted hubs). */
export async function listPendingJoinRequestsPage(
  groupId: string,
  pageSize: number,
  /** Opaque: `nextCursor` from the previous response (last joinRequest doc id scanned). */
  scanAfterDocId: string | null,
): Promise<{ requests: JoinRequestListItem[]; nextCursor: string | null }> {
  if (!adminDb) return { requests: [], nextCursor: null }
  const col = adminDb.collection(GROUPS).doc(groupId).collection('joinRequests')
  const want = pageSize + 1
  const pending: JoinRequestListItem[] = []
  let nextCursor: string | null = null
  let scanAfter = scanAfterDocId

  while (pending.length < want) {
    let q = col.orderBy(FieldPath.documentId()).limit(JOIN_REQUEST_SCAN_BATCH)
    if (scanAfter) q = q.startAfter(scanAfter)
    const snap = await q.get()
    if (snap.empty) break

    let hitPageCapInsideBatch = false
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>
      if (!joinRequestDocIsPending(data)) continue
      const profile = await getPublicProfileSnippet(doc.id)
      pending.push({
        userId: doc.id,
        displayName: profile.displayName,
        handle: profile.handle,
      })
      if (pending.length >= want) {
        nextCursor = doc.id
        hitPageCapInsideBatch = true
        break
      }
    }

    if (hitPageCapInsideBatch) break
    scanAfter = snap.docs[snap.docs.length - 1]!.id
    if (snap.docs.length < JOIN_REQUEST_SCAN_BATCH) break
  }

  const hasMore = pending.length > pageSize
  const requests = hasMore ? pending.slice(0, pageSize) : pending
  return { requests, nextCursor: hasMore ? nextCursor : null }
}

export async function countPendingJoinRequests(groupId: string): Promise<number> {
  if (!adminDb) return 0
  const col = adminDb.collection(GROUPS).doc(groupId).collection('joinRequests')
  let total = 0
  let lastId: string | null = null
  for (;;) {
    let q = col.orderBy(FieldPath.documentId()).limit(500)
    if (lastId) q = q.startAfter(lastId)
    const snap = await q.get()
    if (snap.empty) break
    for (const d of snap.docs) {
      if (joinRequestDocIsPending(d.data() as Record<string, unknown>)) total++
    }
    lastId = snap.docs[snap.docs.length - 1]?.id ?? null
    if (snap.docs.length < 500) break
  }
  return total
}

/**
 * Hub owner approves a pending join request: active member + remove request.
 * Sub hubs: requester must already be in the parent hub (same rule as invite accept).
 */
export async function approveJoinRequestAsOwner(
  ownerUserId: string,
  groupId: string,
  requesterUserId: string,
): Promise<void> {
  if (!adminDb) throw new JoinRequestActionError('Database not configured', 503)
  const owner = ownerUserId.trim()
  const gid = groupId.trim()
  const rid = requesterUserId.trim()
  if (!owner || !gid || !rid) throw new JoinRequestActionError('Invalid request', 400)

  const owned = await getOwnedGroupOrNull(owner, gid)
  if (!owned) throw new JoinRequestActionError('Hub not found', 404)

  const jp = parseFirestoreJoinPolicy(owned.data.joinPolicy)
  if (jp !== 'restricted') {
    throw new JoinRequestActionError('This hub does not use join requests', 400)
  }

  const gRef = adminDb.collection(GROUPS).doc(gid)
  const jrRef = gRef.collection('joinRequests').doc(rid)
  const jrSnap = await jrRef.get()
  if (!jrSnap.exists) throw new JoinRequestActionError('This request is no longer available', 404)
  const jr = jrSnap.data() as Record<string, unknown>
  if ((str(jr, 'status').trim() || 'pending') !== 'pending') {
    throw new JoinRequestActionError('This request is no longer pending', 409)
  }

  if (await isUserMemberOfGroup(gid, rid)) {
    await jrRef.delete()
    return
  }

  const gSnap = await gRef.get()
  if (!gSnap.exists) throw new JoinRequestActionError('Hub not found', 404)
  const gd = gSnap.data() as Record<string, unknown>
  if (gd.deletedAt != null) throw new JoinRequestActionError('Hub not found', 404)

  const parentRaw = str(gd, 'parentGroupId').trim()
  if (parentRaw) {
    const inParent = await isUserMemberOfGroup(parentRaw, rid)
    if (!inParent) {
      throw new JoinRequestActionError(
        'This user must be a member of the parent hub before they can join this sub hub.',
        403,
      )
    }
  }

  const pSnap = await adminDb.collection(PUBLIC_GROUP_PROFILES).doc(gid).get()
  const pd = pSnap.exists ? (pSnap.data() as Record<string, unknown>) : {}

  const now = FieldValue.serverTimestamp()
  const mRef = gRef.collection('members').doc(rid)
  const batch = adminDb.batch()
  batch.set(
    mRef,
    {
      userId: rid,
      role: 'member',
      status: 'active',
      updatedAt: now,
      joinedAt: now,
    },
    { merge: true },
  )
  setGroupMembershipIndexForMemberInBatch(batch, {
    memberUserId: rid,
    groupId: gid,
    groupData: gd,
    publicProfileData: pd,
    updatedAt: now,
  })
  appendUserJoinGroupFeedItem(batch, gid, rid, now)
  batch.delete(jrRef)
  await batch.commit()
}

/** Hub owner rejects a pending join request (deletes the request doc). */
export async function rejectJoinRequestAsOwner(
  ownerUserId: string,
  groupId: string,
  requesterUserId: string,
): Promise<void> {
  if (!adminDb) throw new JoinRequestActionError('Database not configured', 503)
  const owner = ownerUserId.trim()
  const gid = groupId.trim()
  const rid = requesterUserId.trim()
  if (!owner || !gid || !rid) throw new JoinRequestActionError('Invalid request', 400)

  const owned = await getOwnedGroupOrNull(owner, gid)
  if (!owned) throw new JoinRequestActionError('Hub not found', 404)

  const jp = parseFirestoreJoinPolicy(owned.data.joinPolicy)
  if (jp !== 'restricted') {
    throw new JoinRequestActionError('This hub does not use join requests', 400)
  }

  const jrRef = adminDb.collection(GROUPS).doc(gid).collection('joinRequests').doc(rid)
  const jrSnap = await jrRef.get()
  if (!jrSnap.exists) throw new JoinRequestActionError('This request is no longer available', 404)
  const jr = jrSnap.data() as Record<string, unknown>
  if ((str(jr, 'status').trim() || 'pending') !== 'pending') {
    throw new JoinRequestActionError('This request is no longer pending', 409)
  }
  await jrRef.delete()
}
