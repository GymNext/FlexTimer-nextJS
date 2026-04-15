/**
 * Sharing workouts and workout collections to hubs and connections — mirrors iOS patterns
 * (`workoutGroupShares`, `workoutUserShares`, `collectionGroupShares`, `collectionUserShares`,
 * `groups/{id}/feed`, per-user `feed`, hub/user mirrors).
 */
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import { userConnectionDocumentId, assertUsersAreConnected } from '@/lib/user-connections'
import {
  SHARED_COLLECTIONS_SUB,
  SHARED_WORKOUTS_SUB,
  bareWorkoutIdForGroupSharedMirror,
  groupShareMirrorDocumentId,
} from '@/lib/user-connection-mirrors'
import { MAX_PLAN_SHARE_DESTINATIONS, userMaySharePlanToGroup } from '@/lib/plan-share'
import { USER_COLLECTIONS } from '@/types/user'

const WORKOUT_GROUP_SHARES_ROOT = 'workoutGroupShares'
const WORKOUT_USER_SHARES_ROOT = 'workoutUserShares'
const COLLECTION_GROUP_SHARES_ROOT = 'collectionGroupShares'
const COLLECTION_USER_SHARES_ROOT = 'collectionUserShares'
const SHARE_ITEMS_SUB = 'items'
const GROUP_FEED_SUB = 'feed'
const GROUPS_COLLECTION = 'groups'
const PUBLIC_GROUP_PROFILES = 'publicGroupProfiles'
const USER_FEED_OWNER_FIELD = 'userFeedOwnerId'
/** Matches iOS `shareRecipientUserId` on personal feed share rows (both recipient and sharer copies). */
const SHARE_RECIPIENT_USER_ID_FIELD = 'shareRecipientUserId'
const RECIPIENT_FEED_ITEM_FIELD = 'recipientFeedItemId'
const SHARER_FEED_ITEM_FIELD = 'sharerFeedItemId'
const GROUP_FEED_ITEM_FIELD = 'groupFeedItemId'
const SHARED_HUB_FEED_COUNT_FIELD = 'sharedHubContentItemCount'
const USER_CONNECTION_SHARED_COUNT_FIELD = 'sharedContentItemCount'

const MAX_SHARE_COMMENT_LENGTH = 4000
const MIRROR_BATCH = 450

export type ResourceShareKind = 'workout' | 'collection'

export type ResourceGroupShareRow = {
  groupId: string
  sharedAt: string | null
  groupFeedItemId: string | null
}

export type ResourceUserShareRow = {
  peerUserId: string
  sharedAt: string | null
  recipientFeedItemId: string | null
  sharerFeedItemId: string | null
}

function tsToIso(raw: unknown): string | null {
  if (raw == null) return null
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'toDate' in raw &&
    typeof (raw as { toDate: () => Date }).toDate === 'function'
  ) {
    return (raw as { toDate: () => Date }).toDate().toISOString()
  }
  return null
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

function userConnectionMirrorEnvelope(
  recipientUserId: string,
  ownerUid: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  return {
    mirrorOwnerUserId: ownerUid,
    recipientUserId,
    payload,
    updatedAt: FieldValue.serverTimestamp(),
  }
}

function resourceDocHasDeletedAt(data: Record<string, unknown>): boolean {
  const v = data.deletedAt
  if (v == null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function')
    return true
  return false
}

/** Firestore may store `workoutIds` as mixed arrays; match iOS `_stringArrayFromLooseFirestoreValue`. */
function stringArrayFromLooseFirestoreValue(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) {
    const out: string[] = []
    for (const el of value) {
      if (typeof el === 'string') {
        const t = el.trim()
        if (t) out.push(t)
      } else if (typeof el === 'number' && Number.isFinite(el)) {
        const t = String(el).trim()
        if (t) out.push(t)
      }
    }
    return out
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return []
}

/** Canonical `users/{owner}/workouts/{id}` document id for a collection `workoutIds` entry. */
function ownerWorkoutDocIdForCollectionEntry(ownerUid: string, workoutIdEntry: string): string {
  return bareWorkoutIdForGroupSharedMirror(ownerUid, workoutIdEntry)
}

/**
 * After hub `sharedCollections` is written, mirror each listed workout to `groups/{gid}/sharedWorkouts/*`
 * (iOS `_primeCollectionGroupMirrors`).
 */
export async function primeCollectionHubWorkoutMirrors(
  ownerUid: string,
  groupId: string,
  collectionData: Record<string, unknown>
): Promise<void> {
  const db = adminDb
  if (!db) return
  const u = ownerUid.trim()
  const g = groupId.trim()
  if (!u || !g) return

  const entries = stringArrayFromLooseFirestoreValue(collectionData.workoutIds)
  const seen = new Set<string>()
  const uniqueEntries: string[] = []
  for (const e of entries) {
    if (seen.has(e)) continue
    seen.add(e)
    uniqueEntries.push(e)
  }
  if (uniqueEntries.length === 0) return

  const workoutDocIds = uniqueEntries.map((e) => ownerWorkoutDocIdForCollectionEntry(u, e))
  const snaps = await Promise.all(
    workoutDocIds.map((docId) => db.collection('users').doc(u).collection(USER_COLLECTIONS.workouts).doc(docId).get())
  )

  type Op = { ref: DocumentReference; data: Record<string, unknown> }
  const ops: Op[] = []
  for (let i = 0; i < uniqueEntries.length; i++) {
    const entry = uniqueEntries[i]
    const s = snaps[i]
    if (!s.exists) continue
    const payload = { ...(s.data() as Record<string, unknown>) }
    const mid = groupShareMirrorDocumentId(u, entry)
    const ref = db.collection(GROUPS_COLLECTION).doc(g).collection(SHARED_WORKOUTS_SUB).doc(mid)
    ops.push({ ref, data: groupMirrorEnvelope(g, u, payload) })
  }

  for (let i = 0; i < ops.length; i += MIRROR_BATCH) {
    const chunk = ops.slice(i, i + MIRROR_BATCH)
    const batch = db.batch()
    for (const op of chunk) batch.set(op.ref, op.data, { merge: true })
    await batch.commit()
  }
}

/**
 * After connection `users/{peer}/sharedCollections` is written, mirror workouts (iOS `_primeCollectionUserMirrors`).
 */
export async function primeCollectionUserWorkoutMirrors(
  ownerUid: string,
  peerUid: string,
  collectionData: Record<string, unknown>
): Promise<void> {
  const db = adminDb
  if (!db) return
  const u = ownerUid.trim()
  const peer = peerUid.trim()
  if (!u || !peer) return

  const entries = stringArrayFromLooseFirestoreValue(collectionData.workoutIds)
  const seen = new Set<string>()
  const uniqueEntries: string[] = []
  for (const e of entries) {
    if (seen.has(e)) continue
    seen.add(e)
    uniqueEntries.push(e)
  }
  if (uniqueEntries.length === 0) return

  const workoutDocIds = uniqueEntries.map((e) => ownerWorkoutDocIdForCollectionEntry(u, e))
  const snaps = await Promise.all(
    workoutDocIds.map((docId) => db.collection('users').doc(u).collection(USER_COLLECTIONS.workouts).doc(docId).get())
  )

  type Op = { ref: DocumentReference; data: Record<string, unknown> }
  const ops: Op[] = []
  for (let i = 0; i < uniqueEntries.length; i++) {
    const entry = uniqueEntries[i]
    const s = snaps[i]
    if (!s.exists) continue
    const payload = { ...(s.data() as Record<string, unknown>) }
    const mid = groupShareMirrorDocumentId(u, entry)
    const ref = db.collection('users').doc(peer).collection(SHARED_WORKOUTS_SUB).doc(mid)
    ops.push({ ref, data: userConnectionMirrorEnvelope(peer, u, payload) })
  }

  for (let i = 0; i < ops.length; i += MIRROR_BATCH) {
    const chunk = ops.slice(i, i + MIRROR_BATCH)
    const batch = db.batch()
    for (const op of chunk) batch.set(op.ref, op.data, { merge: true })
    await batch.commit()
  }
}

/**
 * Push latest collection + contained workout payloads to every hub that has `collectionGroupShares` for this collection.
 * Call after owner edits the collection (iOS `_syncCollectionMirrors` + `_primeCollectionGroupMirrors` on changes).
 */
export async function syncCollectionHubWorkoutMirrors(ownerUserId: string, collectionId: string): Promise<void> {
  const db = adminDb
  if (!db) return
  const uid = ownerUserId.trim()
  const cid = collectionId.trim()
  if (!uid || !cid) return

  const groupsSnap = await db
    .collection('users')
    .doc(uid)
    .collection(COLLECTION_GROUP_SHARES_ROOT)
    .doc(cid)
    .collection(SHARE_ITEMS_SUB)
    .get()
  if (groupsSnap.empty) return

  const cRef = db.collection('users').doc(uid).collection(USER_COLLECTIONS.workoutCollections).doc(cid)
  const cSnap = await cRef.get()
  if (!cSnap.exists || resourceDocHasDeletedAt((cSnap.data() ?? {}) as Record<string, unknown>)) return

  const collectionData = { ...(cSnap.data() as Record<string, unknown>) }
  const collMid = groupShareMirrorDocumentId(uid, cid)

  for (const doc of groupsSnap.docs) {
    const gid = doc.id.trim()
    if (!gid) continue
    const collRef = db.collection(GROUPS_COLLECTION).doc(gid).collection(SHARED_COLLECTIONS_SUB).doc(collMid)
    await collRef.set(groupMirrorEnvelope(gid, uid, collectionData), { merge: true })
    await primeCollectionHubWorkoutMirrors(uid, gid, collectionData)
  }
}

/**
 * Re-mirror collection + workouts for each direct user share (`collectionUserShares`), iOS parity with hub path.
 */
export async function syncCollectionUserWorkoutMirrors(ownerUserId: string, collectionId: string): Promise<void> {
  const db = adminDb
  if (!db) return
  const uid = ownerUserId.trim()
  const cid = collectionId.trim()
  if (!uid || !cid) return

  const peersSnap = await db
    .collection('users')
    .doc(uid)
    .collection(COLLECTION_USER_SHARES_ROOT)
    .doc(cid)
    .collection(SHARE_ITEMS_SUB)
    .get()
  if (peersSnap.empty) return

  const cRef = db.collection('users').doc(uid).collection(USER_COLLECTIONS.workoutCollections).doc(cid)
  const cSnap = await cRef.get()
  if (!cSnap.exists || resourceDocHasDeletedAt((cSnap.data() ?? {}) as Record<string, unknown>)) return

  const collectionData = { ...(cSnap.data() as Record<string, unknown>) }
  const collMid = groupShareMirrorDocumentId(uid, cid)

  for (const doc of peersSnap.docs) {
    const peer = doc.id.trim()
    if (!peer) continue
    const collRef = db.collection('users').doc(peer).collection(SHARED_COLLECTIONS_SUB).doc(collMid)
    await collRef.set(userConnectionMirrorEnvelope(peer, uid, collectionData), { merge: true })
    await primeCollectionUserWorkoutMirrors(uid, peer, collectionData)
  }
}

/** iOS `_workoutIdsToStripGroupWhenRemovingCollectionShare` — collection `workoutIds` entry strings (mirror doc keys). */
async function listCollectionWorkoutEntriesToStripOnGroupUnshare(
  ownerUid: string,
  collectionId: string,
  groupId: string
): Promise<string[]> {
  const db = adminDb
  if (!db) return []
  const u = ownerUid.trim()
  const cid = collectionId.trim()
  const gid = groupId.trim()
  if (!u || !cid || !gid) return []

  const cSnap = await db.collection('users').doc(u).collection(USER_COLLECTIONS.workoutCollections).doc(cid).get()
  if (!cSnap.exists) return []
  const entries = stringArrayFromLooseFirestoreValue((cSnap.data() as Record<string, unknown>).workoutIds)
  const results = await Promise.all(
    entries.map(async (entry) => {
      const wShareRef = db
        .collection('users')
        .doc(u)
        .collection(WORKOUT_GROUP_SHARES_ROOT)
        .doc(entry)
        .collection(SHARE_ITEMS_SUB)
        .doc(gid)
      const w = await wShareRef.get()
      if (w.exists) return null
      return entry
    })
  )
  return results.filter((x): x is string => typeof x === 'string' && x !== '')
}

/** iOS `_workoutIdsToStripUserWhenRemovingCollectionShare`. */
async function listCollectionWorkoutEntriesToStripOnUserUnshare(
  ownerUid: string,
  collectionId: string,
  peerUid: string
): Promise<string[]> {
  const db = adminDb
  if (!db) return []
  const u = ownerUid.trim()
  const cid = collectionId.trim()
  const peer = peerUid.trim()
  if (!u || !cid || !peer) return []

  const cSnap = await db.collection('users').doc(u).collection(USER_COLLECTIONS.workoutCollections).doc(cid).get()
  if (!cSnap.exists) return []
  const entries = stringArrayFromLooseFirestoreValue((cSnap.data() as Record<string, unknown>).workoutIds)
  const results = await Promise.all(
    entries.map(async (entry) => {
      const wShareRef = db
        .collection('users')
        .doc(u)
        .collection(WORKOUT_USER_SHARES_ROOT)
        .doc(entry)
        .collection(SHARE_ITEMS_SUB)
        .doc(peer)
      const w = await wShareRef.get()
      if (w.exists) return null
      return entry
    })
  )
  return results.filter((x): x is string => typeof x === 'string' && x !== '')
}

async function deleteHubWorkoutMirrorsForCollectionEntries(
  ownerUid: string,
  groupId: string,
  workoutEntries: string[]
): Promise<void> {
  const db = adminDb
  if (!db || workoutEntries.length === 0) return
  const g = groupId.trim()
  const u = ownerUid.trim()
  if (!g || !u) return
  for (let i = 0; i < workoutEntries.length; i += MIRROR_BATCH) {
    const batch = db.batch()
    for (const entry of workoutEntries.slice(i, i + MIRROR_BATCH)) {
      const mid = groupShareMirrorDocumentId(u, entry)
      const ref = db.collection(GROUPS_COLLECTION).doc(g).collection(SHARED_WORKOUTS_SUB).doc(mid)
      batch.delete(ref)
    }
    await batch.commit()
  }
}

async function deleteUserWorkoutMirrorsForCollectionEntries(
  ownerUid: string,
  peerUid: string,
  workoutEntries: string[]
): Promise<void> {
  const db = adminDb
  if (!db || workoutEntries.length === 0) return
  const peer = peerUid.trim()
  const u = ownerUid.trim()
  if (!peer || !u) return
  for (let i = 0; i < workoutEntries.length; i += MIRROR_BATCH) {
    const batch = db.batch()
    for (const entry of workoutEntries.slice(i, i + MIRROR_BATCH)) {
      const mid = groupShareMirrorDocumentId(u, entry)
      const ref = db.collection('users').doc(peer).collection(SHARED_WORKOUTS_SUB).doc(mid)
      batch.delete(ref)
    }
    await batch.commit()
  }
}

/**
 * When a workout document is permanently removed, drop `sharedWorkouts` mirrors that only existed
 * because it appeared in a hub/user shared collection (no `workoutGroupShares` / `workoutUserShares` row).
 */
export async function purgeWorkoutMirrorsFromCollectionDerivedShares(
  ownerUid: string,
  workoutId: string
): Promise<void> {
  const db = adminDb
  if (!db) return
  const u = ownerUid.trim()
  const target = workoutId.trim()
  if (!u || !target) return

  const cols = await db.collection('users').doc(u).collection(USER_COLLECTIONS.workoutCollections).get()
  for (const cdoc of cols.docs) {
    const d = (cdoc.data() ?? {}) as Record<string, unknown>
    if (resourceDocHasDeletedAt(d)) continue
    const cid = cdoc.id
    const entries = stringArrayFromLooseFirestoreValue(d.workoutIds)
    const matchingEntries = entries.filter((entry) => bareWorkoutIdForGroupSharedMirror(u, entry) === target)
    if (matchingEntries.length === 0) continue

    const groupSnap = await db
      .collection('users')
      .doc(u)
      .collection(COLLECTION_GROUP_SHARES_ROOT)
      .doc(cid)
      .collection(SHARE_ITEMS_SUB)
      .get()
    for (const gdoc of groupSnap.docs) {
      const gid = gdoc.id.trim()
      if (!gid) continue
      for (const entry of matchingEntries) {
        const ref = db
          .collection(GROUPS_COLLECTION)
          .doc(gid)
          .collection(SHARED_WORKOUTS_SUB)
          .doc(groupShareMirrorDocumentId(u, entry))
        await deleteHubMirror(ref)
      }
    }

    const peerSnap = await db
      .collection('users')
      .doc(u)
      .collection(COLLECTION_USER_SHARES_ROOT)
      .doc(cid)
      .collection(SHARE_ITEMS_SUB)
      .get()
    for (const pdoc of peerSnap.docs) {
      const peer = pdoc.id.trim()
      if (!peer) continue
      for (const entry of matchingEntries) {
        const ref = db
          .collection('users')
          .doc(peer)
          .collection(SHARED_WORKOUTS_SUB)
          .doc(groupShareMirrorDocumentId(u, entry))
        await deleteHubMirror(ref)
      }
    }
  }
}

function groupRoot(kind: ResourceShareKind): string {
  return kind === 'workout' ? WORKOUT_GROUP_SHARES_ROOT : COLLECTION_GROUP_SHARES_ROOT
}

function userRoot(kind: ResourceShareKind): string {
  return kind === 'workout' ? WORKOUT_USER_SHARES_ROOT : COLLECTION_USER_SHARES_ROOT
}

function hubMirrorSub(kind: ResourceShareKind): string {
  return kind === 'workout' ? SHARED_WORKOUTS_SUB : SHARED_COLLECTIONS_SUB
}

function feedActionType(kind: ResourceShareKind): string {
  return kind === 'workout' ? 'shareWorkout' : 'shareCollection'
}

export async function countResourceShareDestinations(
  uid: string,
  kind: ResourceShareKind,
  resourceId: string
): Promise<number> {
  if (!adminDb) return 0
  const rid = resourceId.trim()
  const u = uid.trim()
  if (!rid || !u) return 0
  const gCol = adminDb
    .collection('users')
    .doc(u)
    .collection(groupRoot(kind))
    .doc(rid)
    .collection(SHARE_ITEMS_SUB)
  const uCol = adminDb
    .collection('users')
    .doc(u)
    .collection(userRoot(kind))
    .doc(rid)
    .collection(SHARE_ITEMS_SUB)
  const [gSnap, uSnap] = await Promise.all([gCol.get(), uCol.get()])
  return (gSnap.size ?? 0) + (uSnap.size ?? 0)
}

export async function listResourceGroupShares(
  uid: string,
  kind: ResourceShareKind,
  resourceId: string
): Promise<ResourceGroupShareRow[]> {
  if (!adminDb) return []
  const rid = resourceId.trim()
  const u = uid.trim()
  if (!rid || !u) return []
  const snap = await adminDb
    .collection('users')
    .doc(u)
    .collection(groupRoot(kind))
    .doc(rid)
    .collection(SHARE_ITEMS_SUB)
    .get()
  const rows: ResourceGroupShareRow[] = []
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>
    rows.push({
      groupId: doc.id,
      sharedAt: tsToIso(d.sharedAt),
      groupFeedItemId: typeof d.groupFeedItemId === 'string' ? d.groupFeedItemId.trim() || null : null,
    })
  }
  rows.sort((a, b) => {
    const ta = a.sharedAt ? Date.parse(a.sharedAt) : 0
    const tb = b.sharedAt ? Date.parse(b.sharedAt) : 0
    return tb - ta
  })
  return rows
}

export async function listResourceUserShares(
  uid: string,
  kind: ResourceShareKind,
  resourceId: string
): Promise<ResourceUserShareRow[]> {
  if (!adminDb) return []
  const rid = resourceId.trim()
  const u = uid.trim()
  if (!rid || !u) return []
  const snap = await adminDb
    .collection('users')
    .doc(u)
    .collection(userRoot(kind))
    .doc(rid)
    .collection(SHARE_ITEMS_SUB)
    .get()
  const rows: ResourceUserShareRow[] = []
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>
    rows.push({
      peerUserId: doc.id,
      sharedAt: tsToIso(d.sharedAt),
      recipientFeedItemId:
        typeof d[RECIPIENT_FEED_ITEM_FIELD] === 'string'
          ? String(d[RECIPIENT_FEED_ITEM_FIELD]).trim() || null
          : null,
      sharerFeedItemId:
        typeof d[SHARER_FEED_ITEM_FIELD] === 'string' ? String(d[SHARER_FEED_ITEM_FIELD]).trim() || null : null,
    })
  }
  rows.sort((a, b) => {
    const ta = a.sharedAt ? Date.parse(a.sharedAt) : 0
    const tb = b.sharedAt ? Date.parse(b.sharedAt) : 0
    return tb - ta
  })
  return rows
}

async function assertResourceOwned(uid: string, kind: ResourceShareKind, resourceId: string) {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const rid = resourceId.trim()
  const u = uid.trim()
  if (kind === 'workout') {
    const snap = await adminDb.collection('users').doc(u).collection(USER_COLLECTIONS.workouts).doc(rid).get()
    if (!snap.exists || resourceDocHasDeletedAt((snap.data() ?? {}) as Record<string, unknown>)) {
      const err = new Error('Workout not found')
      ;(err as Error & { status?: number }).status = 404
      throw err
    }
    return snap.data()
  }
  const snap = await adminDb.collection('users').doc(u).collection(USER_COLLECTIONS.workoutCollections).doc(rid).get()
  if (!snap.exists || resourceDocHasDeletedAt((snap.data() ?? {}) as Record<string, unknown>)) {
    const err = new Error('Collection not found')
    ;(err as Error & { status?: number }).status = 404
    throw err
  }
  return snap.data()
}

export async function shareResourceWithGroup(
  uid: string,
  kind: ResourceShareKind,
  resourceId: string,
  groupId: string,
  comment?: string | null
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const u = uid.trim()
  const rid = resourceId.trim()
  const gid = groupId.trim()
  if (!u || !rid || !gid) throw new Error('Missing resource or group')

  await assertResourceOwned(u, kind, rid)

  const allowed = await userMaySharePlanToGroup(u, gid)
  if (!allowed) throw new Error('You cannot share to this hub with your current membership')

  const shareRef = adminDb
    .collection('users')
    .doc(u)
    .collection(groupRoot(kind))
    .doc(rid)
    .collection(SHARE_ITEMS_SUB)
    .doc(gid)
  const existing = await shareRef.get()
  if (existing.exists) {
    const err = new Error('Already shared with that hub')
    ;(err as Error & { status?: number }).status = 409
    throw err
  }

  const total = await countResourceShareDestinations(u, kind, rid)
  if (total >= MAX_PLAN_SHARE_DESTINATIONS) {
    const err = new Error('You can share with at most 10 hubs and people combined')
    ;(err as Error & { status?: number }).status = 429
    throw err
  }

  const resRef =
    kind === 'workout'
      ? adminDb.collection('users').doc(u).collection(USER_COLLECTIONS.workouts).doc(rid)
      : adminDb.collection('users').doc(u).collection(USER_COLLECTIONS.workoutCollections).doc(rid)
  const resSnap = await resRef.get()
  if (!resSnap.exists) throw new Error('Resource not found')
  const payload = { ...(resSnap.data() as Record<string, unknown>) }

  const feedRef = adminDb.collection(GROUPS_COLLECTION).doc(gid).collection(GROUP_FEED_SUB).doc()
  const feedItemId = feedRef.id
  const actionType = feedActionType(kind)
  const feedData: Record<string, unknown> = {
    createdAt: FieldValue.serverTimestamp(),
    groupId: gid,
    actorUserId: u,
    actionType,
    objectId: rid,
  }
  const c = sanitizeComment(comment)
  if (c) feedData.comment = c

  const mirrorKey = groupShareMirrorDocumentId(u, rid)
  const mirrorRef = adminDb.collection(GROUPS_COLLECTION).doc(gid).collection(hubMirrorSub(kind)).doc(mirrorKey)
  const pubRef = adminDb.collection(PUBLIC_GROUP_PROFILES).doc(gid)

  const batch = adminDb.batch()
  batch.set(
    shareRef,
    {
      sharedAt: FieldValue.serverTimestamp(),
      groupFeedItemId: feedItemId,
    },
    { merge: false }
  )
  batch.set(feedRef, feedData, { merge: false })
  batch.set(mirrorRef, groupMirrorEnvelope(gid, u, payload), { merge: true })
  batch.update(pubRef, { [SHARED_HUB_FEED_COUNT_FIELD]: FieldValue.increment(1) })
  await batch.commit()

  if (kind === 'collection') {
    await primeCollectionHubWorkoutMirrors(u, gid, payload)
  }
}

export async function shareResourceWithUser(
  uid: string,
  kind: ResourceShareKind,
  resourceId: string,
  peerUserId: string,
  comment?: string | null
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const u = uid.trim()
  const rid = resourceId.trim()
  const peer = peerUserId.trim()
  if (!u || !rid || !peer) throw new Error('Missing resource or user')
  if (peer === u) throw new Error('Invalid recipient')

  await assertResourceOwned(u, kind, rid)

  const connected = await assertUsersAreConnected(u, peer)
  if (!connected) {
    const err = new Error('You can only share with people you are connected to')
    ;(err as Error & { status?: number }).status = 403
    throw err
  }

  const shareRef = adminDb
    .collection('users')
    .doc(u)
    .collection(userRoot(kind))
    .doc(rid)
    .collection(SHARE_ITEMS_SUB)
    .doc(peer)
  const existing = await shareRef.get()
  if (existing.exists) {
    const err = new Error('Already shared with that person')
    ;(err as Error & { status?: number }).status = 409
    throw err
  }

  const total = await countResourceShareDestinations(u, kind, rid)
  if (total >= MAX_PLAN_SHARE_DESTINATIONS) {
    const err = new Error('You can share with at most 10 hubs and people combined')
    ;(err as Error & { status?: number }).status = 429
    throw err
  }

  const resRef =
    kind === 'workout'
      ? adminDb.collection('users').doc(u).collection(USER_COLLECTIONS.workouts).doc(rid)
      : adminDb.collection('users').doc(u).collection(USER_COLLECTIONS.workoutCollections).doc(rid)
  const resSnap = await resRef.get()
  if (!resSnap.exists) throw new Error('Resource not found')
  const payload = { ...(resSnap.data() as Record<string, unknown>) }

  const actionType = feedActionType(kind)
  const recipientFeedRef = adminDb.collection('users').doc(peer).collection(GROUP_FEED_SUB).doc()
  const recipientFeedItemId = recipientFeedRef.id
  const recipientFeedData: Record<string, unknown> = {
    createdAt: FieldValue.serverTimestamp(),
    [USER_FEED_OWNER_FIELD]: peer,
    actorUserId: u,
    [SHARE_RECIPIENT_USER_ID_FIELD]: peer,
    actionType,
    objectId: rid,
  }
  const com = sanitizeComment(comment)
  if (com) recipientFeedData.comment = com

  const sharerFeedRef = adminDb.collection('users').doc(u).collection(GROUP_FEED_SUB).doc()
  const sharerFeedItemId = sharerFeedRef.id
  const sharerFeedData: Record<string, unknown> = {
    createdAt: FieldValue.serverTimestamp(),
    [USER_FEED_OWNER_FIELD]: u,
    actorUserId: u,
    actionType,
    objectId: rid,
    peerUserId: peer,
  }
  if (com) sharerFeedData.comment = com

  const mirrorKey = groupShareMirrorDocumentId(u, rid)
  const userMirrorSub = kind === 'workout' ? SHARED_WORKOUTS_SUB : SHARED_COLLECTIONS_SUB
  const mirrorRef = adminDb.collection('users').doc(peer).collection(userMirrorSub).doc(mirrorKey)
  const connId = userConnectionDocumentId(u, peer)
  const connRef = adminDb.collection('userConnections').doc(connId)

  const batch = adminDb.batch()
  batch.set(
    shareRef,
    {
      sharedAt: FieldValue.serverTimestamp(),
      [RECIPIENT_FEED_ITEM_FIELD]: recipientFeedItemId,
      [SHARER_FEED_ITEM_FIELD]: sharerFeedItemId,
    },
    { merge: false }
  )
  batch.set(recipientFeedRef, recipientFeedData, { merge: false })
  batch.set(sharerFeedRef, sharerFeedData, { merge: false })
  batch.set(mirrorRef, userConnectionMirrorEnvelope(peer, u, payload), { merge: true })
  batch.update(connRef, { [USER_CONNECTION_SHARED_COUNT_FIELD]: FieldValue.increment(1) })
  await batch.commit()

  if (kind === 'collection') {
    await primeCollectionUserWorkoutMirrors(u, peer, payload)
  }
}

async function deleteHubMirror(ref: DocumentReference): Promise<void> {
  if (!adminDb) return
  const snap = await ref.get()
  if (snap.exists) await ref.delete()
}

export async function stopSharingResourceWithGroup(
  uid: string,
  kind: ResourceShareKind,
  resourceId: string,
  groupId: string,
  groupFeedItemIdHint?: string | null
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const db = adminDb
  const u = uid.trim()
  const rid = resourceId.trim()
  const gid = groupId.trim()
  if (!u || !rid || !gid) throw new Error('Missing resource or group')

  const allowed = await userMaySharePlanToGroup(u, gid)
  if (!allowed) {
    const err = new Error('You cannot manage this share')
    ;(err as Error & { status?: number }).status = 403
    throw err
  }

  const shareRef = db
    .collection('users')
    .doc(u)
    .collection(groupRoot(kind))
    .doc(rid)
    .collection(SHARE_ITEMS_SUB)
    .doc(gid)
  const feedCol = db.collection(GROUPS_COLLECTION).doc(gid).collection(GROUP_FEED_SUB)
  const mirrorRef = db
    .collection(GROUPS_COLLECTION)
    .doc(gid)
    .collection(hubMirrorSub(kind))
    .doc(groupShareMirrorDocumentId(u, rid))
  const pubRef = db.collection(PUBLIC_GROUP_PROFILES).doc(gid)
  const actionType = feedActionType(kind)

  const hint = groupFeedItemIdHint?.trim() ?? ''
  let feedDocId: string | null = hint || null

  const commitDeletes = async (fid: string | null) => {
    if (kind === 'collection') {
      const stripEntries = await listCollectionWorkoutEntriesToStripOnGroupUnshare(u, rid, gid)
      await deleteHubWorkoutMirrorsForCollectionEntries(u, gid, stripEntries)
    }
    await deleteHubMirror(mirrorRef)
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
      t.update(pubRef, { [SHARED_HUB_FEED_COUNT_FIELD]: curInt - 1 })
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

  const qSnap = await feedCol.where('objectId', '==', rid).limit(40).get()
  const match = qSnap.docs.find((d) => {
    const data = d.data() as Record<string, unknown>
    return data.actionType === actionType && String(data.actorUserId ?? '').trim() === u
  })
  await commitDeletes(match?.id ?? null)
}

export async function stopSharingResourceWithUser(
  uid: string,
  kind: ResourceShareKind,
  resourceId: string,
  peerUserId: string,
  recipientFeedItemIdHint?: string | null
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const db = adminDb
  const u = uid.trim()
  const rid = resourceId.trim()
  const peer = peerUserId.trim()
  if (!u || !rid || !peer) throw new Error('Missing resource or user')

  const connected = await assertUsersAreConnected(u, peer)
  if (!connected) {
    const err = new Error('You cannot manage this share')
    ;(err as Error & { status?: number }).status = 403
    throw err
  }

  const shareRef = db
    .collection('users')
    .doc(u)
    .collection(userRoot(kind))
    .doc(rid)
    .collection(SHARE_ITEMS_SUB)
    .doc(peer)
  const recipientFeedCol = db.collection('users').doc(peer).collection(GROUP_FEED_SUB)
  const sharerFeedCol = db.collection('users').doc(u).collection(GROUP_FEED_SUB)
  const userMirrorSub = kind === 'workout' ? SHARED_WORKOUTS_SUB : SHARED_COLLECTIONS_SUB
  const mirrorRef = db.collection('users').doc(peer).collection(userMirrorSub).doc(groupShareMirrorDocumentId(u, rid))
  const connId = userConnectionDocumentId(u, peer)
  const connRef = db.collection('userConnections').doc(connId)
  const actionType = feedActionType(kind)

  const commitDeletes = async (recipientFid: string | null, sharerFid: string | null) => {
    if (kind === 'collection') {
      const stripEntries = await listCollectionWorkoutEntriesToStripOnUserUnshare(u, rid, peer)
      await deleteUserWorkoutMirrorsForCollectionEntries(u, peer, stripEntries)
    }
    const batch = db.batch()
    batch.delete(mirrorRef)
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
    data.actionType === actionType &&
    String(data.actorUserId ?? '').trim() === u &&
    String(data.objectId ?? '').trim() === rid &&
    String(data[USER_FEED_OWNER_FIELD] ?? '').trim() === peer

  const sharerFeedMatches = (data: Record<string, unknown>) => {
    const shareRec = String(data[SHARE_RECIPIENT_USER_ID_FIELD] ?? '').trim()
    const legacyPeer = String(data.peerUserId ?? '').trim()
    return (
      data.actionType === actionType &&
      String(data.actorUserId ?? '').trim() === u &&
      String(data.objectId ?? '').trim() === rid &&
      String(data[USER_FEED_OWNER_FIELD] ?? '').trim() === u &&
      (shareRec === peer || legacyPeer === peer)
    )
  }

  if (!recipientFid) {
    const qSnap = await recipientFeedCol.where('objectId', '==', rid).limit(40).get()
    recipientFid =
      qSnap.docs.find((doc) => recipientFeedMatches(doc.data() as Record<string, unknown>))?.id ?? null
  }
  if (!sharerFid) {
    const qSnap = await sharerFeedCol.where('objectId', '==', rid).limit(40).get()
    sharerFid = qSnap.docs.find((doc) => sharerFeedMatches(doc.data() as Record<string, unknown>))?.id ?? null
  }

  await commitDeletes(recipientFid, sharerFid)
}
