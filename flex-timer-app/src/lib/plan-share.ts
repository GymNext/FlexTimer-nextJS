/**
 * Plan sharing to groups and connected users — mirrors iOS `StorageManager`
 * (`planGroupShares`, `planUserShares`, `groups/{id}/feed`, `sharedPlans`, counts).
 */
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import { getPlanById } from '@/lib/firestore'
import { sanitizeTrainingIntentOnPlanPayloadForFirestoreWrite } from '@/lib/plan-training-intent'
import { resolveSharedMirrorReadContextForViewer } from '@/lib/shared-resource-access'
import { userConnectionDocumentId, assertUsersAreConnected } from '@/lib/user-connections'
import {
  SHARED_PLANS_SUB,
  groupShareMirrorDocumentId,
} from '@/lib/user-connection-mirrors'
import { parseFirestoreJoinPolicy } from '@/types/group'
import { USER_COLLECTIONS } from '@/types/user'

const PLAN_GROUP_SHARES_ROOT = 'planGroupShares'
const PLAN_USER_SHARES_ROOT = 'planUserShares'
const SHARE_ITEMS_SUB = 'items'
const GROUP_FEED_SUB = 'feed'
const GROUPS_COLLECTION = 'groups'
const PUBLIC_GROUP_PROFILES = 'publicGroupProfiles'
const USER_FEED_OWNER_FIELD = 'userFeedOwnerId'
/** Matches iOS `USER_FEED_SHARE_RECIPIENT_USER_ID_FIELD` — connection recipient on both personal feed copies. */
const SHARE_RECIPIENT_USER_ID_FIELD = 'shareRecipientUserId'
const RECIPIENT_FEED_ITEM_FIELD = 'recipientFeedItemId'
/** Personal-feed doc on the sharer when sharing to a connection (`users/{sharer}/feed`). */
const SHARER_FEED_ITEM_FIELD = 'sharerFeedItemId'
const GROUP_FEED_ITEM_FIELD = 'groupFeedItemId'
const SHARED_HUB_FEED_COUNT_FIELD = 'sharedHubContentItemCount'
const USER_CONNECTION_SHARED_COUNT_FIELD = 'sharedContentItemCount'
/** Matches iOS `PLAN_SHARE_HIDE_FUTURE_WORKOUTS_FIELD` / `PLAN_SHARE_ALLOW_EDITING_FIELD`. */
export const PLAN_SHARE_HIDE_FUTURE_WORKOUTS_FIELD = 'hideFutureWorkouts'
export const PLAN_SHARE_ALLOW_EDITING_FIELD = 'allowEditing'

export const MAX_PLAN_SHARE_DESTINATIONS = 10

const MAX_SHARE_COMMENT_LENGTH = 4000

/** Resolved access flags for a subscriber following someone else's plan (UI + API). */
export type ResolvedPlanFollowAccess = {
  shareAllowEditing: boolean
  shareHideFutureWorkouts: boolean
}

/**
 * Resolved from the subscriber’s readable plan mirror (`users/{sub}/sharedPlans` or `groups/{id}/sharedPlans`),
 * matching mobile: subscription docs do not store share flags or hub routing.
 */
export async function resolvePlanFollowAccessForSubscriber(
  subscriberUserId: string,
  ownerUserId: string,
  remotePlanId: string,
  opts?: { hubGroupIds?: string[] },
): Promise<ResolvedPlanFollowAccess> {
  const o = ownerUserId.trim()
  const pid = remotePlanId.trim()
  const sub = subscriberUserId.trim()
  if (!o || !pid || !sub || !adminDb) {
    return { shareAllowEditing: false, shareHideFutureWorkouts: false }
  }

  const ctx = await resolveSharedMirrorReadContextForViewer(sub, o, 'plan', pid, null, opts)
  if (!ctx) {
    return { shareAllowEditing: false, shareHideFutureWorkouts: false }
  }

  const planDocId = groupShareMirrorDocumentId(o, pid)
  const mirrorRef = ctx.readViaGroupId
    ? adminDb.collection(GROUPS_COLLECTION).doc(ctx.readViaGroupId).collection(SHARED_PLANS_SUB).doc(planDocId)
    : adminDb.collection('users').doc(sub).collection(SHARED_PLANS_SUB).doc(planDocId)

  const snap = await mirrorRef.get()
  if (!snap.exists) {
    return { shareAllowEditing: false, shareHideFutureWorkouts: false }
  }
  const d = snap.data() as Record<string, unknown>
  const access: ResolvedPlanFollowAccess = {
    shareAllowEditing: readAllowEditingFromShareDoc(d),
    shareHideFutureWorkouts: readHideFutureWorkoutsFromShareDoc(d),
  }

  const plan = await getPlanById(o, pid)
  if (plan && !plan.deletedAt && plan.trainingIntent !== 1) {
    return { ...access, shareHideFutureWorkouts: false }
  }
  return access
}

export type PlanGroupShareRow = {
  groupId: string
  sharedAt: string | null
  groupFeedItemId: string | null
  hideFutureWorkouts: boolean
}

export type PlanUserShareRow = {
  peerUserId: string
  sharedAt: string | null
  recipientFeedItemId: string | null
  sharerFeedItemId: string | null
  allowEditing: boolean
  hideFutureWorkouts: boolean
}

function tsToIso(raw: unknown): string | null {
  if (raw == null) return null
  if (typeof raw === 'object' && raw !== null && 'toDate' in raw && typeof (raw as { toDate: () => Date }).toDate === 'function') {
    return (raw as { toDate: () => Date }).toDate().toISOString()
  }
  return null
}

function readHideFutureWorkoutsFromShareDoc(d: Record<string, unknown>): boolean {
  const raw = d[PLAN_SHARE_HIDE_FUTURE_WORKOUTS_FIELD]
  if (typeof raw === 'boolean') return raw
  return true
}

function readAllowEditingFromShareDoc(d: Record<string, unknown>): boolean {
  const raw = d[PLAN_SHARE_ALLOW_EDITING_FIELD]
  if (typeof raw === 'boolean') return raw
  return false
}

function sanitizeComment(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined
  const t = raw.trim()
  if (!t) return undefined
  if (t.length <= MAX_SHARE_COMMENT_LENGTH) return t
  return t.slice(0, MAX_SHARE_COMMENT_LENGTH)
}

function groupMirrorEnvelope(groupId: string, ownerUid: string, payload: Record<string, unknown>) {
  return {
    mirrorOwnerUserId: ownerUid,
    groupId,
    payload,
    updatedAt: FieldValue.serverTimestamp(),
  }
}

function userConnectionMirrorEnvelope(recipientUserId: string, ownerUid: string, payload: Record<string, unknown>) {
  return {
    mirrorOwnerUserId: ownerUid,
    recipientUserId,
    payload,
    updatedAt: FieldValue.serverTimestamp(),
  }
}

/** Top-level mirror fields (same paths as iOS); not part of `payload`. */
function planMirrorShareFlagsDoc(
  allowEditing: boolean,
  hideFutureWorkouts: boolean
): Record<string, unknown> {
  return {
    [PLAN_SHARE_ALLOW_EDITING_FIELD]: allowEditing,
    [PLAN_SHARE_HIDE_FUTURE_WORKOUTS_FIELD]: hideFutureWorkouts,
  }
}

async function userOwnsGroup(uid: string, groupId: string): Promise<boolean> {
  if (!adminDb) return false
  const snap = await adminDb.collection(GROUPS_COLLECTION).doc(groupId).get()
  if (!snap.exists) return false
  const owner = String(snap.data()?.ownerUserId ?? '').trim()
  return owner === uid
}

/**
 * Member may share when index shows active membership, hub is private/restricted, and membersMayShareContent.
 * Owners are handled separately (`userOwnsGroup`).
 */
async function memberMaySharePlanToGroup(uid: string, groupId: string): Promise<boolean> {
  if (!adminDb) return false
  const idxSnap = await adminDb
    .collection('users')
    .doc(uid)
    .collection('groupMembershipIndex')
    .doc(groupId)
    .get()
  if (!idxSnap.exists) return false
  const d = idxSnap.data() as Record<string, unknown>
  const status = String(d.status ?? '').trim()
  if (status !== 'active') return false
  const jp = parseFirestoreJoinPolicy(d.joinPolicy)
  if (!jp || jp === 'public') return false
  if (d.membersMayShareContent === true) return true
  return false
}

export async function userMaySharePlanToGroup(uid: string, groupId: string): Promise<boolean> {
  const gid = groupId.trim()
  const u = uid.trim()
  if (!gid || !u) return false
  if (await userOwnsGroup(u, gid)) return true
  return memberMaySharePlanToGroup(u, gid)
}

export async function countPlanShareDestinations(uid: string, planId: string): Promise<number> {
  if (!adminDb) return 0
  const pid = planId.trim()
  const u = uid.trim()
  if (!pid || !u) return 0
  const gCol = adminDb
    .collection('users')
    .doc(u)
    .collection(PLAN_GROUP_SHARES_ROOT)
    .doc(pid)
    .collection(SHARE_ITEMS_SUB)
  const uCol = adminDb
    .collection('users')
    .doc(u)
    .collection(PLAN_USER_SHARES_ROOT)
    .doc(pid)
    .collection(SHARE_ITEMS_SUB)
  const [gSnap, uSnap] = await Promise.all([gCol.get(), uCol.get()])
  return (gSnap.size ?? 0) + (uSnap.size ?? 0)
}

export async function listPlanGroupShares(uid: string, planId: string): Promise<PlanGroupShareRow[]> {
  if (!adminDb) return []
  const pid = planId.trim()
  const u = uid.trim()
  if (!pid || !u) return []
  const snap = await adminDb
    .collection('users')
    .doc(u)
    .collection(PLAN_GROUP_SHARES_ROOT)
    .doc(pid)
    .collection(SHARE_ITEMS_SUB)
    .get()
  const rows: PlanGroupShareRow[] = []
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>
    const hfRaw = d[PLAN_SHARE_HIDE_FUTURE_WORKOUTS_FIELD]
    const hideFuture = typeof hfRaw === 'boolean' ? hfRaw : true
    rows.push({
      groupId: doc.id,
      sharedAt: tsToIso(d.sharedAt),
      groupFeedItemId: typeof d.groupFeedItemId === 'string' ? d.groupFeedItemId.trim() || null : null,
      hideFutureWorkouts: hideFuture,
    })
  }
  rows.sort((a, b) => {
    const ta = a.sharedAt ? Date.parse(a.sharedAt) : 0
    const tb = b.sharedAt ? Date.parse(b.sharedAt) : 0
    return tb - ta
  })
  return rows
}

export async function listPlanUserShares(uid: string, planId: string): Promise<PlanUserShareRow[]> {
  if (!adminDb) return []
  const pid = planId.trim()
  const u = uid.trim()
  if (!pid || !u) return []
  const snap = await adminDb
    .collection('users')
    .doc(u)
    .collection(PLAN_USER_SHARES_ROOT)
    .doc(pid)
    .collection(SHARE_ITEMS_SUB)
    .get()
  const rows: PlanUserShareRow[] = []
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>
    const allowEdit = readAllowEditingFromShareDoc(d)
    rows.push({
      peerUserId: doc.id,
      sharedAt: tsToIso(d.sharedAt),
      recipientFeedItemId:
        typeof d[RECIPIENT_FEED_ITEM_FIELD] === 'string'
          ? String(d[RECIPIENT_FEED_ITEM_FIELD]).trim() || null
          : null,
      sharerFeedItemId:
        typeof d[SHARER_FEED_ITEM_FIELD] === 'string'
          ? String(d[SHARER_FEED_ITEM_FIELD]).trim() || null
          : null,
      allowEditing: allowEdit,
      hideFutureWorkouts: readHideFutureWorkoutsFromShareDoc(d),
    })
  }
  rows.sort((a, b) => {
    const ta = a.sharedAt ? Date.parse(a.sharedAt) : 0
    const tb = b.sharedAt ? Date.parse(b.sharedAt) : 0
    return tb - ta
  })
  return rows
}

export async function sharePlanWithGroup(
  uid: string,
  planId: string,
  groupId: string,
  comment?: string | null,
  hideFutureWorkouts = true
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const u = uid.trim()
  const pid = planId.trim()
  const gid = groupId.trim()
  if (!u || !pid || !gid) throw new Error('Missing plan or group')

  const plan = await getPlanById(u, pid)
  if (!plan || plan.deletedAt) throw new Error('Plan not found')
  if (plan.isPersonal) throw new Error('Personal plans cannot be shared')
  // Firestore `trainingIntent`: numeric 1 = group training (hub + people); 0 = private training (connections only).
  if (plan.trainingIntent !== 1) {
    const err = new Error('Private training plans can only be shared with connected people, not hubs')
    ;(err as Error & { status?: number }).status = 400
    throw err
  }

  const allowed = await userMaySharePlanToGroup(u, gid)
  if (!allowed) throw new Error('You cannot share to this hub with your current membership')

  const shareRef = adminDb
    .collection('users')
    .doc(u)
    .collection(PLAN_GROUP_SHARES_ROOT)
    .doc(pid)
    .collection(SHARE_ITEMS_SUB)
    .doc(gid)
  const existing = await shareRef.get()
  if (existing.exists) {
    const err = new Error('This plan is already shared with that hub')
    ;(err as Error & { status?: number }).status = 409
    throw err
  }

  const total = await countPlanShareDestinations(u, pid)
  if (total >= MAX_PLAN_SHARE_DESTINATIONS) {
    const err = new Error('You can share a plan with at most 10 hubs and people combined')
    ;(err as Error & { status?: number }).status = 429
    throw err
  }

  const planRef = adminDb.collection('users').doc(u).collection(USER_COLLECTIONS.workoutPlans).doc(pid)
  const planSnap = await planRef.get()
  if (!planSnap.exists) throw new Error('Plan not found')
  const planPayload = { ...(planSnap.data() as Record<string, unknown>) }
  sanitizeTrainingIntentOnPlanPayloadForFirestoreWrite(planPayload)

  const feedRef = adminDb.collection(GROUPS_COLLECTION).doc(gid).collection(GROUP_FEED_SUB).doc()
  const feedItemId = feedRef.id
  const feedData: Record<string, unknown> = {
    createdAt: FieldValue.serverTimestamp(),
    groupId: gid,
    actorUserId: u,
    actionType: 'sharePlan',
    objectId: pid,
  }
  const c = sanitizeComment(comment)
  if (c) feedData.comment = c

  const planKey = groupShareMirrorDocumentId(u, pid)
  const planMirrorRef = adminDb.collection(GROUPS_COLLECTION).doc(gid).collection(SHARED_PLANS_SUB).doc(planKey)
  const pubRef = adminDb.collection(PUBLIC_GROUP_PROFILES).doc(gid)

  const batch = adminDb.batch()
  batch.set(
    shareRef,
    {
      sharedAt: FieldValue.serverTimestamp(),
      groupFeedItemId: feedItemId,
      [PLAN_SHARE_HIDE_FUTURE_WORKOUTS_FIELD]: hideFutureWorkouts,
    },
    { merge: false }
  )
  batch.set(feedRef, feedData, { merge: false })
  batch.set(
    planMirrorRef,
    {
      ...groupMirrorEnvelope(gid, u, planPayload),
      ...planMirrorShareFlagsDoc(false, hideFutureWorkouts),
    },
    { merge: true }
  )
  batch.update(pubRef, { [SHARED_HUB_FEED_COUNT_FIELD]: FieldValue.increment(1) })
  await batch.commit()
}

export async function sharePlanWithUser(
  uid: string,
  planId: string,
  peerUserId: string,
  comment?: string | null,
  allowEditing = false,
  hideFutureWorkouts = true
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const u = uid.trim()
  const pid = planId.trim()
  const rid = peerUserId.trim()
  if (!u || !pid || !rid) throw new Error('Missing plan or user')
  if (rid === u) throw new Error('Invalid recipient')

  const plan = await getPlanById(u, pid)
  if (!plan || plan.deletedAt) throw new Error('Plan not found')
  if (plan.isPersonal) throw new Error('Personal plans cannot be shared')

  const connected = await assertUsersAreConnected(u, rid)
  if (!connected) {
    const err = new Error('You can only share with people you are connected to')
    ;(err as Error & { status?: number }).status = 403
    throw err
  }

  const shareRef = adminDb
    .collection('users')
    .doc(u)
    .collection(PLAN_USER_SHARES_ROOT)
    .doc(pid)
    .collection(SHARE_ITEMS_SUB)
    .doc(rid)
  const existing = await shareRef.get()
  if (existing.exists) {
    const err = new Error('This plan is already shared with that person')
    ;(err as Error & { status?: number }).status = 409
    throw err
  }

  const total = await countPlanShareDestinations(u, pid)
  if (total >= MAX_PLAN_SHARE_DESTINATIONS) {
    const err = new Error('You can share a plan with at most 10 hubs and people combined')
    ;(err as Error & { status?: number }).status = 429
    throw err
  }

  const planRef = adminDb.collection('users').doc(u).collection(USER_COLLECTIONS.workoutPlans).doc(pid)
  const planSnap = await planRef.get()
  if (!planSnap.exists) throw new Error('Plan not found')
  const planPayload = { ...(planSnap.data() as Record<string, unknown>) }
  sanitizeTrainingIntentOnPlanPayloadForFirestoreWrite(planPayload)

  const recipientFeedRef = adminDb.collection('users').doc(rid).collection(GROUP_FEED_SUB).doc()
  const recipientFeedItemId = recipientFeedRef.id

  const recipientFeedData: Record<string, unknown> = {
    createdAt: FieldValue.serverTimestamp(),
    [USER_FEED_OWNER_FIELD]: rid,
    actorUserId: u,
    [SHARE_RECIPIENT_USER_ID_FIELD]: rid,
    actionType: 'sharePlan',
    objectId: pid,
  }
  const c = sanitizeComment(comment)
  if (c) recipientFeedData.comment = c

  const sharerFeedRef = adminDb.collection('users').doc(u).collection(GROUP_FEED_SUB).doc()
  const sharerFeedItemId = sharerFeedRef.id
  const sharerFeedData: Record<string, unknown> = {
    createdAt: FieldValue.serverTimestamp(),
    [USER_FEED_OWNER_FIELD]: u,
    actorUserId: u,
    [SHARE_RECIPIENT_USER_ID_FIELD]: rid,
    actionType: 'sharePlan',
    objectId: pid,
  }
  if (c) sharerFeedData.comment = c

  const planKey = groupShareMirrorDocumentId(u, pid)
  const planMirrorRef = adminDb.collection('users').doc(rid).collection(SHARED_PLANS_SUB).doc(planKey)
  const connId = userConnectionDocumentId(u, rid)
  const connRef = adminDb.collection('userConnections').doc(connId)

  const batch = adminDb.batch()
  batch.set(
    shareRef,
    {
      sharedAt: FieldValue.serverTimestamp(),
      [RECIPIENT_FEED_ITEM_FIELD]: recipientFeedItemId,
      [SHARER_FEED_ITEM_FIELD]: sharerFeedItemId,
      [PLAN_SHARE_ALLOW_EDITING_FIELD]: allowEditing,
      [PLAN_SHARE_HIDE_FUTURE_WORKOUTS_FIELD]: hideFutureWorkouts,
    },
    { merge: false }
  )
  batch.set(recipientFeedRef, recipientFeedData, { merge: false })
  batch.set(sharerFeedRef, sharerFeedData, { merge: false })
  batch.set(
    planMirrorRef,
    {
      ...userConnectionMirrorEnvelope(rid, u, planPayload),
      ...planMirrorShareFlagsDoc(allowEditing, hideFutureWorkouts),
    },
    { merge: true }
  )
  batch.update(connRef, { [USER_CONNECTION_SHARED_COUNT_FIELD]: FieldValue.increment(1) })
  await batch.commit()
}

/** Update hide-future on `planGroupShares` and the matching `groups/{groupId}/sharedPlans` mirror (not feed rows). */
export async function updatePlanGroupShareHideFuture(
  ownerUid: string,
  planId: string,
  groupId: string,
  hideFutureWorkouts: boolean
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const u = ownerUid.trim()
  const pid = planId.trim()
  const gid = groupId.trim()
  if (!u || !pid || !gid) throw new Error('Missing plan or group')

  const plan = await getPlanById(u, pid)
  if (!plan || plan.deletedAt) {
    const err = new Error('Plan not found')
    ;(err as Error & { status?: number }).status = 404
    throw err
  }
  if (plan.trainingIntent !== 1) {
    const err = new Error('Private training plans cannot update hub share flags')
    ;(err as Error & { status?: number }).status = 400
    throw err
  }

  const allowed = await userMaySharePlanToGroup(u, gid)
  if (!allowed) {
    const err = new Error('You cannot manage this share')
    ;(err as Error & { status?: number }).status = 403
    throw err
  }

  const db = adminDb
  const shareRef = db
    .collection('users')
    .doc(u)
    .collection(PLAN_GROUP_SHARES_ROOT)
    .doc(pid)
    .collection(SHARE_ITEMS_SUB)
    .doc(gid)
  const shareSnap = await shareRef.get()
  if (!shareSnap.exists) {
    const err = new Error('Share not found')
    ;(err as Error & { status?: number }).status = 404
    throw err
  }
  const planKey = groupShareMirrorDocumentId(u, pid)
  const planMirrorRef = db.collection(GROUPS_COLLECTION).doc(gid).collection(SHARED_PLANS_SUB).doc(planKey)

  const batch = db.batch()
  batch.update(shareRef, { [PLAN_SHARE_HIDE_FUTURE_WORKOUTS_FIELD]: hideFutureWorkouts })
  batch.update(planMirrorRef, {
    [PLAN_SHARE_ALLOW_EDITING_FIELD]: false,
    [PLAN_SHARE_HIDE_FUTURE_WORKOUTS_FIELD]: hideFutureWorkouts,
    updatedAt: FieldValue.serverTimestamp(),
  })
  await batch.commit()
}

/**
 * Update flags on an existing connection share (`planUserShares` item) and the recipient’s
 * `users/{peer}/sharedPlans/{mirrorId}` mirror.
 * Private training: only `allowEditing` (hide future stays false on share + mirror).
 * Group training: only `hideFutureWorkouts` (`allowEditing` remains false).
 */
export async function updatePlanUserShareFlags(
  ownerUid: string,
  planId: string,
  peerUserId: string,
  patch: { allowEditing?: boolean; hideFutureWorkouts?: boolean }
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const u = ownerUid.trim()
  const pid = planId.trim()
  const rid = peerUserId.trim()
  if (!u || !pid || !rid) throw new Error('Missing plan or user')
  if (rid === u) {
    const err = new Error('Invalid recipient')
    ;(err as Error & { status?: number }).status = 400
    throw err
  }

  const plan = await getPlanById(u, pid)
  if (!plan || plan.deletedAt) {
    const err = new Error('Plan not found')
    ;(err as Error & { status?: number }).status = 404
    throw err
  }
  if (plan.isPersonal) {
    const err = new Error('Personal plans cannot be shared')
    ;(err as Error & { status?: number }).status = 400
    throw err
  }

  const groupTraining = plan.trainingIntent === 1
  if (groupTraining) {
    if (patch.hideFutureWorkouts === undefined) {
      const err = new Error('hideFutureWorkouts (boolean) is required for group training plan shares')
      ;(err as Error & { status?: number }).status = 400
      throw err
    }
    if (patch.allowEditing !== undefined) {
      const err = new Error('allowEditing cannot be updated for group training plan shares')
      ;(err as Error & { status?: number }).status = 400
      throw err
    }
  } else {
    if (patch.allowEditing === undefined) {
      const err = new Error('allowEditing (boolean) is required for private training plan shares')
      ;(err as Error & { status?: number }).status = 400
      throw err
    }
    if (patch.hideFutureWorkouts !== undefined) {
      const err = new Error('hideFutureWorkouts cannot be updated for private training plan shares')
      ;(err as Error & { status?: number }).status = 400
      throw err
    }
  }

  const connected = await assertUsersAreConnected(u, rid)
  if (!connected) {
    const err = new Error('You can only share with people you are connected to')
    ;(err as Error & { status?: number }).status = 403
    throw err
  }

  const db = adminDb
  const shareRef = db
    .collection('users')
    .doc(u)
    .collection(PLAN_USER_SHARES_ROOT)
    .doc(pid)
    .collection(SHARE_ITEMS_SUB)
    .doc(rid)
  const shareSnap = await shareRef.get()
  if (!shareSnap.exists) {
    const err = new Error('Share not found')
    ;(err as Error & { status?: number }).status = 404
    throw err
  }

  const shareUpdate: Record<string, unknown> = {}
  let mirrorAllow: boolean
  let mirrorHide: boolean
  if (groupTraining) {
    shareUpdate[PLAN_SHARE_HIDE_FUTURE_WORKOUTS_FIELD] = patch.hideFutureWorkouts
    shareUpdate[PLAN_SHARE_ALLOW_EDITING_FIELD] = false
    mirrorAllow = false
    mirrorHide = patch.hideFutureWorkouts!
  } else {
    shareUpdate[PLAN_SHARE_ALLOW_EDITING_FIELD] = patch.allowEditing
    shareUpdate[PLAN_SHARE_HIDE_FUTURE_WORKOUTS_FIELD] = false
    mirrorAllow = patch.allowEditing!
    mirrorHide = false
  }

  const planKey = groupShareMirrorDocumentId(u, pid)
  const planMirrorRef = db.collection('users').doc(rid).collection(SHARED_PLANS_SUB).doc(planKey)

  const batch = db.batch()
  batch.update(shareRef, shareUpdate)
  batch.update(planMirrorRef, {
    [PLAN_SHARE_ALLOW_EDITING_FIELD]: mirrorAllow,
    [PLAN_SHARE_HIDE_FUTURE_WORKOUTS_FIELD]: mirrorHide,
    updatedAt: FieldValue.serverTimestamp(),
  })
  await batch.commit()
}

async function deletePlanMirror(ref: DocumentReference): Promise<void> {
  if (!adminDb) return
  const snap = await ref.get()
  if (snap.exists) await ref.delete()
}

export async function stopSharingPlanWithGroup(
  uid: string,
  planId: string,
  groupId: string,
  groupFeedItemIdHint?: string | null
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const db = adminDb
  const u = uid.trim()
  const pid = planId.trim()
  const gid = groupId.trim()
  if (!u || !pid || !gid) throw new Error('Missing plan or group')

  const allowed = await userMaySharePlanToGroup(u, gid)
  if (!allowed) {
    const err = new Error('You cannot manage this share')
    ;(err as Error & { status?: number }).status = 403
    throw err
  }

  const shareRef = db
    .collection('users')
    .doc(u)
    .collection(PLAN_GROUP_SHARES_ROOT)
    .doc(pid)
    .collection(SHARE_ITEMS_SUB)
    .doc(gid)
  const feedCol = db.collection(GROUPS_COLLECTION).doc(gid).collection(GROUP_FEED_SUB)
  const planMirrorRef = db
    .collection(GROUPS_COLLECTION)
    .doc(gid)
    .collection(SHARED_PLANS_SUB)
    .doc(groupShareMirrorDocumentId(u, pid))
  const pubRef = db.collection(PUBLIC_GROUP_PROFILES).doc(gid)

  const hint = groupFeedItemIdHint?.trim() ?? ''
  let feedDocId: string | null = hint || null

  const commitDeletes = async (fid: string | null) => {
    await deletePlanMirror(planMirrorRef)
    const batch = db.batch()
    batch.delete(shareRef)
    if (fid) batch.delete(feedCol.doc(fid))
    await batch.commit()
    await db.runTransaction(async (t) => {
      const snap = await t.get(pubRef)
      if (!snap.exists) return
      const curRaw = snap.data()?.[SHARED_HUB_FEED_COUNT_FIELD]
      const cur =
        typeof curRaw === 'number'
          ? curRaw
          : typeof curRaw === 'object' && curRaw !== null && 'toNumber' in curRaw
            ? (curRaw as { toNumber: () => number }).toNumber()
            : 0
      const curInt = Math.floor(cur)
      if (curInt <= 0) return
      const next = curInt - 1
      t.update(pubRef, { [SHARED_HUB_FEED_COUNT_FIELD]: next })
    })
  }

  if (feedDocId) {
    await commitDeletes(feedDocId)
    return
  }

  const shareSnap = await shareRef.get()
  if (!shareSnap.exists) {
    const err = new Error('Share not found')
    ;(err as Error & { status?: number }).status = 404
    throw err
  }
  const stored = String((shareSnap.data() as Record<string, unknown>)[GROUP_FEED_ITEM_FIELD] ?? '').trim()
  if (stored) {
    await commitDeletes(stored)
    return
  }

  const qSnap = await feedCol.where('objectId', '==', pid).limit(40).get()
  const match = qSnap.docs.find((d) => {
    const data = d.data() as Record<string, unknown>
    return data.actionType === 'sharePlan' && String(data.actorUserId ?? '').trim() === u
  })
  await commitDeletes(match?.id ?? null)
}

export async function stopSharingPlanWithUser(
  uid: string,
  planId: string,
  peerUserId: string,
  recipientFeedItemIdHint?: string | null
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const db = adminDb
  const u = uid.trim()
  const pid = planId.trim()
  const rid = peerUserId.trim()
  if (!u || !pid || !rid) throw new Error('Missing plan or user')

  const connected = await assertUsersAreConnected(u, rid)
  if (!connected) {
    const err = new Error('You cannot manage this share')
    ;(err as Error & { status?: number }).status = 403
    throw err
  }

  const shareRef = db
    .collection('users')
    .doc(u)
    .collection(PLAN_USER_SHARES_ROOT)
    .doc(pid)
    .collection(SHARE_ITEMS_SUB)
    .doc(rid)
  const recipientFeedCol = db.collection('users').doc(rid).collection(GROUP_FEED_SUB)
  const sharerFeedCol = db.collection('users').doc(u).collection(GROUP_FEED_SUB)
  const planMirrorRef = db
    .collection('users')
    .doc(rid)
    .collection(SHARED_PLANS_SUB)
    .doc(groupShareMirrorDocumentId(u, pid))
  const connId = userConnectionDocumentId(u, rid)
  const connRef = db.collection('userConnections').doc(connId)

  const commitDeletes = async (recipientFid: string | null, sharerFid: string | null) => {
    const batch = db.batch()
    batch.delete(planMirrorRef)
    batch.delete(shareRef)
    if (recipientFid) batch.delete(recipientFeedCol.doc(recipientFid))
    if (sharerFid) batch.delete(sharerFeedCol.doc(sharerFid))
    await batch.commit()
    await db.runTransaction(async (t) => {
      const snap = await t.get(connRef)
      if (!snap.exists) return
      const curRaw = snap.data()?.[USER_CONNECTION_SHARED_COUNT_FIELD]
      const cur =
        typeof curRaw === 'number'
          ? curRaw
          : typeof curRaw === 'object' && curRaw !== null && 'toNumber' in curRaw
            ? (curRaw as { toNumber: () => number }).toNumber()
            : 0
      const next = Math.max(0, Math.floor(cur) - 1)
      t.update(connRef, { [USER_CONNECTION_SHARED_COUNT_FIELD]: next })
    })
  }

  const shareSnap = await shareRef.get()
  if (!shareSnap.exists) {
    const err = new Error('Share not found')
    ;(err as Error & { status?: number }).status = 404
    throw err
  }
  const d = shareSnap.data() as Record<string, unknown>
  const storedRecipient = String(d[RECIPIENT_FEED_ITEM_FIELD] ?? '').trim() || null
  const storedSharer = String(d[SHARER_FEED_ITEM_FIELD] ?? '').trim() || null
  const hint = recipientFeedItemIdHint?.trim() || null

  let recipientFid = hint || storedRecipient
  let sharerFid = storedSharer

  const recipientFeedMatches = (data: Record<string, unknown>) =>
    data.actionType === 'sharePlan' &&
    String(data.actorUserId ?? '').trim() === u &&
    String(data.objectId ?? '').trim() === pid &&
    String(data[USER_FEED_OWNER_FIELD] ?? '').trim() === rid

  const sharerFeedMatches = (data: Record<string, unknown>) => {
    const shareRec = String(data[SHARE_RECIPIENT_USER_ID_FIELD] ?? '').trim()
    const legacyPeer = String(data.peerUserId ?? '').trim()
    return (
      data.actionType === 'sharePlan' &&
      String(data.actorUserId ?? '').trim() === u &&
      String(data.objectId ?? '').trim() === pid &&
      String(data[USER_FEED_OWNER_FIELD] ?? '').trim() === u &&
      (shareRec === rid || legacyPeer === rid)
    )
  }

  if (!recipientFid) {
    const qSnap = await recipientFeedCol.where('objectId', '==', pid).limit(40).get()
    recipientFid =
      qSnap.docs.find((doc) => recipientFeedMatches(doc.data() as Record<string, unknown>))?.id ?? null
  }
  if (!sharerFid) {
    const qSnap = await sharerFeedCol.where('objectId', '==', pid).limit(40).get()
    sharerFid = qSnap.docs.find((doc) => sharerFeedMatches(doc.data() as Record<string, unknown>))?.id ?? null
  }

  await commitDeletes(recipientFid, sharerFid)
}
