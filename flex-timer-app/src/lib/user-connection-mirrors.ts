/**
 * User-to-user share mirrors under `users/{recipientUid}/sharedWorkouts|sharedCollections|sharedPlans`.
 * Matches iOS `StorageManager` (`groupShareMirrorDocumentId`, `_userConnectionMirrorEnvelope`, share roots).
 */
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import { sanitizeTrainingIntentOnPlanPayloadForFirestoreWrite } from '@/lib/plan-training-intent'
import { USER_COLLECTIONS } from '@/types/user'

/** iOS `\\u{1e}` between owner user id and shared object id in mirror document ids. */
export const GROUP_SHARE_MIRROR_SEP = '\u001e'

export const SHARED_WORKOUTS_SUB = 'sharedWorkouts'
export const SHARED_COLLECTIONS_SUB = 'sharedCollections'
export const SHARED_PLANS_SUB = 'sharedPlans'

const GROUPS_COLLECTION = 'groups'
const WORKOUT_GROUP_SHARES_ROOT = 'workoutGroupShares'
const WORKOUT_USER_SHARES_ROOT = 'workoutUserShares'
const COLLECTION_USER_SHARES_ROOT = 'collectionUserShares'
const PLAN_USER_SHARES_ROOT = 'planUserShares'
const PLAN_GROUP_SHARES_ROOT = 'planGroupShares'
const SHARE_ITEMS_SUB = 'items'

/** Top-level fields on `sharedPlans` mirrors (matches iOS / `plan-share.ts`). */
const PLAN_SHARE_HIDE_FUTURE_WORKOUTS_FIELD = 'hideFutureWorkouts'

const BATCH = 450

export function groupShareMirrorDocumentId(ownerUserId: string, objectId: string): string {
  const o = ownerUserId.trim()
  const i = objectId.trim()
  return `${o}${GROUP_SHARE_MIRROR_SEP}${i}`
}

/** iOS `bareWorkoutIdForGroupSharedMirror` — strip redundant `owner\u001e` prefix from collection `workoutIds` entries. */
export function bareWorkoutIdForGroupSharedMirror(ownerUserId: string, workoutIdEntry: string): string {
  const o = ownerUserId.trim()
  const raw = workoutIdEntry.trim()
  if (!o || !raw) return raw
  const sep = GROUP_SHARE_MIRROR_SEP
  const idx = raw.indexOf(sep)
  if (idx < 0) return raw
  const prefix = raw.slice(0, idx).trim()
  const suffix = raw.slice(idx + sep.length).trim()
  if (prefix === o && suffix) return suffix
  return raw
}

function groupMirrorEnvelope(groupId: string, ownerUid: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    mirrorOwnerUserId: ownerUid,
    groupId,
    payload,
    updatedAt: FieldValue.serverTimestamp(),
  }
}

async function listGroupIdsForPlanShare(ownerUid: string, planId: string): Promise<string[]> {
  if (!adminDb) return []
  const oid = planId.trim()
  const uid = ownerUid.trim()
  if (!oid || !uid) return []
  const snap = await adminDb
    .collection('users')
    .doc(uid)
    .collection(PLAN_GROUP_SHARES_ROOT)
    .doc(oid)
    .collection(SHARE_ITEMS_SUB)
    .get()
  return snap.docs.map((d) => d.id.trim()).filter(Boolean)
}

async function listGroupIdsForWorkoutShare(ownerUid: string, workoutId: string): Promise<string[]> {
  if (!adminDb) return []
  const oid = workoutId.trim()
  const uid = ownerUid.trim()
  if (!oid || !uid) return []
  const snap = await adminDb
    .collection('users')
    .doc(uid)
    .collection(WORKOUT_GROUP_SHARES_ROOT)
    .doc(oid)
    .collection(SHARE_ITEMS_SUB)
    .get()
  return snap.docs.map((d) => d.id.trim()).filter(Boolean)
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

async function listDirectSharePeerIds(
  ownerUid: string,
  root: typeof WORKOUT_USER_SHARES_ROOT | typeof COLLECTION_USER_SHARES_ROOT | typeof PLAN_USER_SHARES_ROOT,
  objectId: string
): Promise<string[]> {
  if (!adminDb) return []
  const oid = objectId.trim()
  const uid = ownerUid.trim()
  if (!oid || !uid) return []
  const snap = await adminDb
    .collection('users')
    .doc(uid)
    .collection(root)
    .doc(oid)
    .collection(SHARE_ITEMS_SUB)
    .get()
  return snap.docs.map((d) => d.id.trim()).filter(Boolean)
}

async function commitInBatches(
  ops: Array<{ ref: DocumentReference; data: Record<string, unknown>; merge: boolean }>
): Promise<void> {
  const db = adminDb
  if (!db || ops.length === 0) return
  for (let i = 0; i < ops.length; i += BATCH) {
    const chunk = ops.slice(i, i + BATCH)
    const batch = db.batch()
    for (const op of chunk) {
      batch.set(op.ref, op.data, { merge: op.merge })
    }
    await batch.commit()
  }
}

async function deleteInBatches(refs: DocumentReference[]): Promise<void> {
  const db = adminDb
  if (!db || refs.length === 0) return
  for (let i = 0; i < refs.length; i += BATCH) {
    const chunk = refs.slice(i, i + BATCH)
    const batch = db.batch()
    for (const ref of chunk) {
      batch.delete(ref)
    }
    await batch.commit()
  }
}

function logMirrorErr(phase: string, err: unknown) {
  console.error(`[user-connection-mirrors] ${phase}`, err)
}

/**
 * Push canonical workout document fields to each `users/{peer}/sharedWorkouts/{mirrorId}` for peers
 * in `users/{owner}/workoutUserShares/{workoutId}/items/*`.
 */
export async function syncWorkoutUserConnectionMirrors(ownerUserId: string, workoutId: string): Promise<void> {
  const db = adminDb
  if (!db) return
  try {
    const uid = ownerUserId.trim()
    const wid = workoutId.trim()
    if (!uid || !wid) return

    const peers = await listDirectSharePeerIds(uid, WORKOUT_USER_SHARES_ROOT, wid)
    if (peers.length === 0) return

    const wRef = db.collection('users').doc(uid).collection(USER_COLLECTIONS.workouts).doc(wid)
    const wSnap = await wRef.get()
    if (!wSnap.exists) {
      await deleteWorkoutUserConnectionMirrors(uid, wid)
      return
    }
    const payload = (wSnap.data() ?? {}) as Record<string, unknown>
    const mirrorId = groupShareMirrorDocumentId(uid, wid)
    const ops = peers.map((peer) => ({
      ref: db.collection('users').doc(peer).collection(SHARED_WORKOUTS_SUB).doc(mirrorId),
      data: userConnectionMirrorEnvelope(peer, uid, payload),
      merge: true,
    }))
    await commitInBatches(ops)
  } catch (e) {
    logMirrorErr('syncWorkoutUserConnectionMirrors', e)
  }
}

/**
 * Push canonical workout fields to each `groups/{gid}/sharedWorkouts/{mirrorId}` for hubs in
 * `users/{owner}/workoutGroupShares/{workoutId}/items/*` (iOS `_syncWorkoutMirrorsForCurrentUser` group branch).
 */
export async function syncWorkoutHubMirrors(ownerUserId: string, workoutId: string): Promise<void> {
  const db = adminDb
  if (!db) return
  try {
    const uid = ownerUserId.trim()
    const wid = workoutId.trim()
    if (!uid || !wid) return

    const gids = await listGroupIdsForWorkoutShare(uid, wid)
    if (gids.length === 0) return

    const wRef = db.collection('users').doc(uid).collection(USER_COLLECTIONS.workouts).doc(wid)
    const wSnap = await wRef.get()
    if (!wSnap.exists) {
      await deleteWorkoutHubMirrors(uid, wid)
      return
    }
    const payload = (wSnap.data() ?? {}) as Record<string, unknown>
    const mirrorId = groupShareMirrorDocumentId(uid, wid)
    const ops = gids.map((gid) => ({
      ref: db.collection(GROUPS_COLLECTION).doc(gid).collection(SHARED_WORKOUTS_SUB).doc(mirrorId),
      data: groupMirrorEnvelope(gid, uid, payload),
      merge: true,
    }))
    await commitInBatches(ops)
  } catch (e) {
    logMirrorErr('syncWorkoutHubMirrors', e)
  }
}

export async function deleteWorkoutHubMirrors(ownerUserId: string, workoutId: string): Promise<void> {
  const db = adminDb
  if (!db) return
  try {
    const uid = ownerUserId.trim()
    const wid = workoutId.trim()
    if (!uid || !wid) return
    const gids = await listGroupIdsForWorkoutShare(uid, wid)
    const mirrorId = groupShareMirrorDocumentId(uid, wid)
    const refs = gids.map((gid) => db.collection(GROUPS_COLLECTION).doc(gid).collection(SHARED_WORKOUTS_SUB).doc(mirrorId))
    await deleteInBatches(refs)
  } catch (e) {
    logMirrorErr('deleteWorkoutHubMirrors', e)
  }
}

export async function deleteWorkoutUserConnectionMirrors(ownerUserId: string, workoutId: string): Promise<void> {
  const db = adminDb
  if (!db) return
  try {
    const uid = ownerUserId.trim()
    const wid = workoutId.trim()
    if (!uid || !wid) return
    const peers = await listDirectSharePeerIds(uid, WORKOUT_USER_SHARES_ROOT, wid)
    const mirrorId = groupShareMirrorDocumentId(uid, wid)
    const refs = peers.map((peer) =>
      db.collection('users').doc(peer).collection(SHARED_WORKOUTS_SUB).doc(mirrorId)
    )
    await deleteInBatches(refs)
  } catch (e) {
    logMirrorErr('deleteWorkoutUserConnectionMirrors', e)
  }
}

export async function syncCollectionUserConnectionMirrors(ownerUserId: string, collectionId: string): Promise<void> {
  const db = adminDb
  if (!db) return
  try {
    const uid = ownerUserId.trim()
    const cid = collectionId.trim()
    if (!uid || !cid) return

    const peers = await listDirectSharePeerIds(uid, COLLECTION_USER_SHARES_ROOT, cid)
    if (peers.length === 0) return

    const cRef = db.collection('users').doc(uid).collection(USER_COLLECTIONS.workoutCollections).doc(cid)
    const cSnap = await cRef.get()
    if (!cSnap.exists) {
      await deleteCollectionUserConnectionMirrors(uid, cid)
      return
    }
    const payload = (cSnap.data() ?? {}) as Record<string, unknown>
    const mirrorId = groupShareMirrorDocumentId(uid, cid)
    const ops = peers.map((peer) => ({
      ref: db.collection('users').doc(peer).collection(SHARED_COLLECTIONS_SUB).doc(mirrorId),
      data: userConnectionMirrorEnvelope(peer, uid, payload),
      merge: true,
    }))
    await commitInBatches(ops)
  } catch (e) {
    logMirrorErr('syncCollectionUserConnectionMirrors', e)
  }
}

export async function deleteCollectionUserConnectionMirrors(ownerUserId: string, collectionId: string): Promise<void> {
  const db = adminDb
  if (!db) return
  try {
    const uid = ownerUserId.trim()
    const cid = collectionId.trim()
    if (!uid || !cid) return
    const peers = await listDirectSharePeerIds(uid, COLLECTION_USER_SHARES_ROOT, cid)
    const mirrorId = groupShareMirrorDocumentId(uid, cid)
    const refs = peers.map((peer) =>
      db.collection('users').doc(peer).collection(SHARED_COLLECTIONS_SUB).doc(mirrorId)
    )
    await deleteInBatches(refs)
  } catch (e) {
    logMirrorErr('deleteCollectionUserConnectionMirrors', e)
  }
}

export async function syncPlanUserConnectionMirrors(ownerUserId: string, planId: string): Promise<void> {
  const db = adminDb
  if (!db) return
  try {
    const uid = ownerUserId.trim()
    const pid = planId.trim()
    if (!uid || !pid) return

    const peers = await listDirectSharePeerIds(uid, PLAN_USER_SHARES_ROOT, pid)
    if (peers.length === 0) return

    const pRef = db.collection('users').doc(uid).collection(USER_COLLECTIONS.workoutPlans).doc(pid)
    const pSnap = await pRef.get()
    if (!pSnap.exists) {
      await deletePlanUserConnectionMirrors(uid, pid)
      return
    }
    const payload = { ...(pSnap.data() ?? {}) } as Record<string, unknown>
    sanitizeTrainingIntentOnPlanPayloadForFirestoreWrite(payload)
    const mirrorId = groupShareMirrorDocumentId(uid, pid)
    const itemsCol = db.collection('users').doc(uid).collection(PLAN_USER_SHARES_ROOT).doc(pid).collection(SHARE_ITEMS_SUB)
    const itemSnaps = await Promise.all(peers.map((peer) => itemsCol.doc(peer).get()))
    const ops = peers.map((peer, i) => {
      const d = itemSnaps[i]?.exists ? (itemSnaps[i].data() as Record<string, unknown>) : {}
      const hideRaw = d[PLAN_SHARE_HIDE_FUTURE_WORKOUTS_FIELD]
      const hideFutureWorkouts = typeof hideRaw === 'boolean' ? hideRaw : true
      return {
        ref: db.collection('users').doc(peer).collection(SHARED_PLANS_SUB).doc(mirrorId),
        data: {
          ...userConnectionMirrorEnvelope(peer, uid, payload),
          [PLAN_SHARE_HIDE_FUTURE_WORKOUTS_FIELD]: hideFutureWorkouts,
          allowEditing: FieldValue.delete(),
        },
        merge: true,
      }
    })
    await commitInBatches(ops)
  } catch (e) {
    logMirrorErr('syncPlanUserConnectionMirrors', e)
  }
}

/**
 * Push canonical plan fields to each `groups/{gid}/sharedPlans/{mirrorId}` for hubs in
 * `users/{owner}/planGroupShares/{planId}/items/*`, preserving per-hub `hideFutureWorkouts` from each item doc
 * (iOS `_syncPlanMirrorsForCurrentUser` group branch).
 */
export async function syncPlanGroupShareMirrors(ownerUserId: string, planId: string): Promise<void> {
  const db = adminDb
  if (!db) return
  try {
    const uid = ownerUserId.trim()
    const pid = planId.trim()
    if (!uid || !pid) return

    const gids = await listGroupIdsForPlanShare(uid, pid)
    if (gids.length === 0) return

    const pRef = db.collection('users').doc(uid).collection(USER_COLLECTIONS.workoutPlans).doc(pid)
    const pSnap = await pRef.get()
    if (!pSnap.exists) {
      return
    }
    const payload = { ...(pSnap.data() ?? {}) } as Record<string, unknown>
    sanitizeTrainingIntentOnPlanPayloadForFirestoreWrite(payload)
    const mirrorId = groupShareMirrorDocumentId(uid, pid)
    const itemsCol = db.collection('users').doc(uid).collection(PLAN_GROUP_SHARES_ROOT).doc(pid).collection(SHARE_ITEMS_SUB)
    const itemSnaps = await Promise.all(gids.map((gid) => itemsCol.doc(gid).get()))
    const ops = gids.map((gid, i) => {
      const d = itemSnaps[i]?.exists ? (itemSnaps[i].data() as Record<string, unknown>) : {}
      const hideRaw = d[PLAN_SHARE_HIDE_FUTURE_WORKOUTS_FIELD]
      const hideFutureWorkouts = typeof hideRaw === 'boolean' ? hideRaw : true
      return {
        ref: db.collection(GROUPS_COLLECTION).doc(gid).collection(SHARED_PLANS_SUB).doc(mirrorId),
        data: {
          ...groupMirrorEnvelope(gid, uid, payload),
          [PLAN_SHARE_HIDE_FUTURE_WORKOUTS_FIELD]: hideFutureWorkouts,
          allowEditing: FieldValue.delete(),
        },
        merge: true,
      }
    })
    await commitInBatches(ops)
  } catch (e) {
    logMirrorErr('syncPlanGroupShareMirrors', e)
  }
}

/** After the owner’s canonical `workoutPlans/{planId}` doc changes, refresh all hub + connection `sharedPlans` mirrors. */
export async function syncPlanShareMirrorsForOwner(ownerUserId: string, planId: string): Promise<void> {
  await Promise.all([
    syncPlanUserConnectionMirrors(ownerUserId, planId),
    syncPlanGroupShareMirrors(ownerUserId, planId),
  ])
}

export async function deletePlanUserConnectionMirrors(ownerUserId: string, planId: string): Promise<void> {
  const db = adminDb
  if (!db) return
  try {
    const uid = ownerUserId.trim()
    const pid = planId.trim()
    if (!uid || !pid) return
    const peers = await listDirectSharePeerIds(uid, PLAN_USER_SHARES_ROOT, pid)
    const mirrorId = groupShareMirrorDocumentId(uid, pid)
    const refs = peers.map((peer) =>
      db.collection('users').doc(peer).collection(SHARED_PLANS_SUB).doc(mirrorId)
    )
    await deleteInBatches(refs)
  } catch (e) {
    logMirrorErr('deletePlanUserConnectionMirrors', e)
  }
}
