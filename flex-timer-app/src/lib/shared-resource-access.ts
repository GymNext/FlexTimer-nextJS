import { adminDb } from '@/lib/firebase-admin'
import {
  groupShareMirrorDocumentId,
  SHARED_COLLECTIONS_SUB,
  SHARED_PLANS_SUB,
  SHARED_WORKOUTS_SUB,
} from '@/lib/user-connection-mirrors'

/**
 * Whether `viewerUid` may read `ownerUid`'s workout / collection / plan in a feed or shared-library context.
 * - Same user always allowed.
 * - Otherwise: recipient mirror under `users/{viewer}/shared*` for that owner+resource, or
 *   active member (or hub owner) of `contextGroupId` when the item came from that hub's feed.
 */
export async function viewerCanAccessSharedLibraryItem(
  viewerUid: string,
  ownerUid: string,
  kind: 'workout' | 'collection' | 'plan',
  resourceId: string,
  contextGroupId: string | null
): Promise<boolean> {
  if (!adminDb) return false
  const v = viewerUid.trim()
  const o = ownerUid.trim()
  const rid = resourceId.trim()
  if (!v || !o || !rid) return false
  if (v === o) return true

  const sub =
    kind === 'workout'
      ? SHARED_WORKOUTS_SUB
      : kind === 'collection'
        ? SHARED_COLLECTIONS_SUB
        : SHARED_PLANS_SUB
  const docId = groupShareMirrorDocumentId(o, rid)
  const mirrorSnap = await adminDb.collection('users').doc(v).collection(sub).doc(docId).get()
  if (mirrorSnap.exists) {
    const mo = mirrorSnap.data()?.mirrorOwnerUserId
    if (typeof mo === 'string' && mo.trim() === o) return true
  }

  const gid = contextGroupId?.trim() ?? ''
  if (gid) {
    const gSnap = await adminDb.collection('groups').doc(gid).get()
    if (!gSnap.exists) return false
    const gd = gSnap.data() as Record<string, unknown>
    if (gd.deletedAt != null) return false
    const gOwner = typeof gd.ownerUserId === 'string' ? gd.ownerUserId.trim() : ''
    if (gOwner === v) return true
    const mSnap = await adminDb.collection('groups').doc(gid).collection('members').doc(v).get()
    if (!mSnap.exists) return false
    const st = (mSnap.data() as Record<string, unknown>).status
    return typeof st === 'string' && st === 'active'
  }

  return false
}
