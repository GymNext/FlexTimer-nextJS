import { createHash, timingSafeEqual } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import { establishMutualUserConnectionIfNeeded } from '@/lib/connection-requests'
import {
  isUserMemberOfGroup,
  setGroupMembershipIndexForMemberInBatch,
} from '@/lib/group-invite'
import { appendUserJoinGroupFeedItem } from '@/lib/group-feed-user-join'
import { parseFirestoreJoinPolicy, type AppGroupJoinPolicy } from '@/types/group'

const USERS = 'users'
const GROUPS = 'groups'
const PUBLIC_GROUP_PROFILES = 'publicGroupProfiles'

const RL_WINDOW_MS = 60_000
const RL_MAX = 40
const rlBuckets = new Map<string, number[]>()

function str(d: Record<string, unknown>, key: string): string {
  const v = d[key]
  return typeof v === 'string' ? v : ''
}

export class InstantLinkError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'InstantLinkError'
  }
}

/** Simple per-process sliding-window limiter (best-effort; use Redis in multi-instance production). */
export function checkInstantLinkRateLimit(bucketKey: string): void {
  const now = Date.now()
  const arr = (rlBuckets.get(bucketKey) ?? []).filter((t) => now - t < RL_WINDOW_MS)
  if (arr.length >= RL_MAX) {
    throw new InstantLinkError('Too many requests', 429)
  }
  arr.push(now)
  rlBuckets.set(bucketKey, arr)
}

/** Constant-time comparison of two UTF-8 strings (via SHA-256 digests). */
export function constantTimeCodesEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest()
  const hb = createHash('sha256').update(b, 'utf8').digest()
  return ha.length === hb.length && timingSafeEqual(ha, hb)
}

/**
 * POST instant user-connect: validate `users/{target}.instantConnectCode`, then establish mutual connection.
 */
export async function redeemInstantUserConnect(
  callerUid: string,
  targetUserId: string,
  rawCode: string,
): Promise<void> {
  if (!adminDb) throw new InstantLinkError('Service unavailable', 503)
  const caller = callerUid.trim()
  const target = targetUserId.trim()
  const code = typeof rawCode === 'string' ? rawCode.trim() : ''
  if (!caller || !target || !code) {
    throw new InstantLinkError('Invalid request', 400)
  }
  if (caller === target) {
    throw new InstantLinkError('Invalid request', 400)
  }

  const userSnap = await adminDb.collection(USERS).doc(target).get()
  if (!userSnap.exists) {
    throw new InstantLinkError('Invalid instant link', 404)
  }
  const ud = userSnap.data() as Record<string, unknown>
  const storedRaw = ud.instantConnectCode
  if (typeof storedRaw !== 'string' || storedRaw.trim() === '') {
    throw new InstantLinkError('Invalid instant link', 403)
  }
  const stored = storedRaw.trim()
  if (!constantTimeCodesEqual(code, stored)) {
    throw new InstantLinkError('Invalid instant link', 403)
  }

  await establishMutualUserConnectionIfNeeded(caller, target)
}

/**
 * POST instant group-join: validate `groups/{groupId}.instantJoinCode` (non-public hubs only),
 * then add active member + `users/{caller}/groupMembershipIndex/{groupId}` (same shape as join approval).
 */
export async function redeemInstantGroupJoin(
  callerUid: string,
  groupId: string,
  rawCode: string,
): Promise<void> {
  if (!adminDb) throw new InstantLinkError('Service unavailable', 503)
  const caller = callerUid.trim()
  const gid = groupId.trim()
  const code = typeof rawCode === 'string' ? rawCode.trim() : ''
  if (!caller || !gid || !code) {
    throw new InstantLinkError('Invalid request', 400)
  }

  const gRef = adminDb.collection(GROUPS).doc(gid)
  const gSnap = await gRef.get()
  if (!gSnap.exists) {
    throw new InstantLinkError('Invalid instant link', 404)
  }
  const gd = gSnap.data() as Record<string, unknown>
  if (gd.deletedAt != null) {
    throw new InstantLinkError('Invalid instant link', 404)
  }

  const ownerUid = str(gd, 'ownerUserId').trim()
  if (ownerUid === caller) {
    return
  }

  const joinPolicy: AppGroupJoinPolicy = parseFirestoreJoinPolicy(gd.joinPolicy) ?? 'private'
  if (joinPolicy === 'public') {
    throw new InstantLinkError('Use the standard join flow for public hubs', 400)
  }

  const storedRaw = gd.instantJoinCode
  if (typeof storedRaw !== 'string' || storedRaw.trim() === '') {
    throw new InstantLinkError('Invalid instant link', 403)
  }
  const stored = storedRaw.trim()
  if (!constantTimeCodesEqual(code, stored)) {
    throw new InstantLinkError('Invalid instant link', 403)
  }

  if (await isUserMemberOfGroup(gid, caller)) {
    const jrRef = gRef.collection('joinRequests').doc(caller)
    const jrSnap = await jrRef.get()
    if (jrSnap.exists) {
      await jrRef.delete()
    }
    return
  }

  const parentRaw = str(gd, 'parentGroupId').trim()
  if (parentRaw) {
    const inParent = await isUserMemberOfGroup(parentRaw, caller)
    if (!inParent) {
      throw new InstantLinkError('Join the parent hub first, then you can join this sub hub.', 403)
    }
  }

  const pRef = adminDb.collection(PUBLIC_GROUP_PROFILES).doc(gid)
  const pSnap = await pRef.get()
  const pd = pSnap.exists ? (pSnap.data() as Record<string, unknown>) : {}

  const now = FieldValue.serverTimestamp()
  const mRef = gRef.collection('members').doc(caller)
  const jrRef = gRef.collection('joinRequests').doc(caller)
  const batch = adminDb.batch()
  batch.set(
    mRef,
    {
      userId: caller,
      role: 'member',
      status: 'active',
      updatedAt: now,
      joinedAt: now,
    },
    { merge: true },
  )
  setGroupMembershipIndexForMemberInBatch(batch, {
    memberUserId: caller,
    groupId: gid,
    groupData: gd,
    publicProfileData: pd,
    updatedAt: now,
  })
  appendUserJoinGroupFeedItem(batch, gid, caller, now)
  batch.delete(jrRef)
  await batch.commit()
}
