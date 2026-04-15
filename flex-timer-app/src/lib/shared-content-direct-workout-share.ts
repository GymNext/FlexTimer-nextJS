/**
 * Shared Content “Workouts” lists should only include workouts the owner shared directly,
 * not mirrors that exist only because the workout appears inside a shared collection.
 */
import { adminDb } from '@/lib/firebase-admin'
import { bareWorkoutIdForGroupSharedMirror } from '@/lib/user-connection-mirrors'

const SHARE_ITEMS_SUB = 'items'
const WORKOUT_USER_SHARES_ROOT = 'workoutUserShares'
const WORKOUT_GROUP_SHARES_ROOT = 'workoutGroupShares'

function canonicalWorkoutIdForShareLookup(ownerUserId: string, mirrorResourceId: string): string {
  const o = ownerUserId.trim()
  const raw = mirrorResourceId.trim()
  if (!o || !raw) return ''
  return bareWorkoutIdForGroupSharedMirror(o, raw).trim()
}

/** True when `users/{owner}/workoutUserShares/{wid}/items/{viewer}` exists (direct person share). */
export async function workoutHasDirectUserShareWithViewer(
  workoutOwnerUserId: string,
  viewerUserId: string,
  mirrorResourceId: string
): Promise<boolean> {
  const db = adminDb
  if (!db) return false
  const owner = workoutOwnerUserId.trim()
  const viewer = viewerUserId.trim()
  const wid = canonicalWorkoutIdForShareLookup(owner, mirrorResourceId)
  if (!owner || !viewer || !wid) return false
  const snap = await db
    .collection('users')
    .doc(owner)
    .collection(WORKOUT_USER_SHARES_ROOT)
    .doc(wid)
    .collection(SHARE_ITEMS_SUB)
    .doc(viewer)
    .get()
  return snap.exists
}

/** True when `users/{owner}/workoutGroupShares/{wid}/items/{groupId}` exists (direct hub share). */
export async function workoutHasDirectGroupShareInHub(
  workoutOwnerUserId: string,
  hubGroupId: string,
  mirrorResourceId: string
): Promise<boolean> {
  const db = adminDb
  if (!db) return false
  const owner = workoutOwnerUserId.trim()
  const gid = hubGroupId.trim()
  const wid = canonicalWorkoutIdForShareLookup(owner, mirrorResourceId)
  if (!owner || !gid || !wid) return false
  const snap = await db
    .collection('users')
    .doc(owner)
    .collection(WORKOUT_GROUP_SHARES_ROOT)
    .doc(wid)
    .collection(SHARE_ITEMS_SUB)
    .doc(gid)
    .get()
  return snap.exists
}
