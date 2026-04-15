import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'

export type SharedWorkoutBookmarkRow = {
  subscriptionDocumentId: string
  ownerUserId: string
  remoteWorkoutId: string
  mirrorGroupId: string | null
  workoutNameSnapshot: string | null
  workoutDescriptionSnapshot: string | null
  /** Subscriber-owned marker; true when mirror is missing/inaccessible (may be stale). */
  isUnavailable: boolean
  updatedAt: string | null
}

export type SharedCollectionBookmarkRow = {
  subscriptionDocumentId: string
  ownerUserId: string
  remoteCollectionId: string
  mirrorGroupId: string | null
  collectionNameSnapshot: string | null
  collectionDescriptionSnapshot: string | null
  /** Non-empty `workoutIds` on the owner's collection when the bookmark was saved (null if absent / legacy). */
  collectionWorkoutCountSnapshot: number | null
  /** Subscriber-owned marker; true when mirror is missing/inaccessible (may be stale). */
  isUnavailable: boolean
  updatedAt: string | null
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

function str(d: Record<string, unknown>, key: string): string {
  const v = d[key]
  return typeof v === 'string' ? v : ''
}

function bool(d: Record<string, unknown>, key: string): boolean | null {
  const v = d[key]
  if (typeof v === 'boolean') return v
  return null
}

function intNonNegOrNull(d: Record<string, unknown>, key: string): number | null {
  const v = d[key]
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v)
  return null
}

/** Document id must match Firestore rules: `ownerUserId + '_' + remoteWorkoutId`. */
export function workoutBookmarkDocumentId(ownerUserId: string, remoteWorkoutId: string): string {
  return `${ownerUserId.trim()}_${remoteWorkoutId.trim()}`
}

/** Document id must match Firestore rules: `ownerUserId + '_' + remoteCollectionId`. */
export function collectionBookmarkDocumentId(ownerUserId: string, remoteCollectionId: string): string {
  return `${ownerUserId.trim()}_${remoteCollectionId.trim()}`
}

/**
 * Creates or updates an active shared-workout bookmark on `users/{viewerUid}/workoutSubscriptions`.
 * Uses Admin SDK (server); doc id is composite per client rules.
 */
export async function upsertActiveSharedWorkoutBookmark(params: {
  viewerUid: string
  ownerUserId: string
  remoteWorkoutId: string
  mirrorGroupId: string | null
  workoutNameSnapshot: string | null
  workoutDescriptionSnapshot: string | null
}): Promise<{ subscriptionDocumentId: string }> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const viewerUid = params.viewerUid.trim()
  const ownerUserId = params.ownerUserId.trim()
  const remoteWorkoutId = params.remoteWorkoutId.trim()
  if (!viewerUid || !ownerUserId || !remoteWorkoutId) throw new Error('Invalid ids')
  const subId = workoutBookmarkDocumentId(ownerUserId, remoteWorkoutId)
  const gid = params.mirrorGroupId?.trim() ?? ''
  await adminDb
    .collection('users')
    .doc(viewerUid)
    .collection('workoutSubscriptions')
    .doc(subId)
    .set(
      {
        subscriberUserId: viewerUid,
        ownerUserId,
        remoteWorkoutId,
        status: 'active',
        mirrorGroupId: gid ? gid : null,
        workoutNameSnapshot: params.workoutNameSnapshot,
        workoutDescriptionSnapshot: params.workoutDescriptionSnapshot,
        isUnavailable: false,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  return { subscriptionDocumentId: subId }
}

/**
 * Creates or updates an active shared-collection bookmark on `users/{viewerUid}/workoutCollectionSubscriptions`.
 */
export async function upsertActiveSharedCollectionBookmark(params: {
  viewerUid: string
  ownerUserId: string
  remoteCollectionId: string
  mirrorGroupId: string | null
  collectionNameSnapshot: string | null
  collectionDescriptionSnapshot: string | null
  collectionWorkoutCountSnapshot: number
}): Promise<{ subscriptionDocumentId: string }> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const viewerUid = params.viewerUid.trim()
  const ownerUserId = params.ownerUserId.trim()
  const remoteCollectionId = params.remoteCollectionId.trim()
  if (!viewerUid || !ownerUserId || !remoteCollectionId) throw new Error('Invalid ids')
  const subId = collectionBookmarkDocumentId(ownerUserId, remoteCollectionId)
  const gid = params.mirrorGroupId?.trim() ?? ''
  await adminDb
    .collection('users')
    .doc(viewerUid)
    .collection('workoutCollectionSubscriptions')
    .doc(subId)
    .set(
      {
        subscriberUserId: viewerUid,
        ownerUserId,
        remoteCollectionId,
        status: 'active',
        mirrorGroupId: gid ? gid : null,
        collectionNameSnapshot: params.collectionNameSnapshot,
        collectionDescriptionSnapshot: params.collectionDescriptionSnapshot,
        collectionWorkoutCountSnapshot: Math.max(0, Math.floor(params.collectionWorkoutCountSnapshot)),
        isUnavailable: false,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  return { subscriptionDocumentId: subId }
}

/** Deletes the viewer's `workoutSubscriptions` doc if it exists and matches owner + workout id. */
export async function deleteSharedWorkoutBookmark(
  viewerUid: string,
  ownerUserId: string,
  remoteWorkoutId: string
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const v = viewerUid.trim()
  const o = ownerUserId.trim()
  const r = remoteWorkoutId.trim()
  if (!v || !o || !r) throw new Error('Invalid ids')
  const subId = workoutBookmarkDocumentId(o, r)
  const ref = adminDb.collection('users').doc(v).collection('workoutSubscriptions').doc(subId)
  const snap = await ref.get()
  if (!snap.exists) return
  const d = snap.data() as Record<string, unknown>
  if (str(d, 'subscriberUserId').trim() !== v) throw new Error('Forbidden')
  if (str(d, 'ownerUserId').trim() !== o || str(d, 'remoteWorkoutId').trim() !== r) throw new Error('Forbidden')
  await ref.delete()
}

/** Deletes the viewer's `workoutCollectionSubscriptions` doc if it exists and matches owner + collection id. */
export async function deleteSharedCollectionBookmark(
  viewerUid: string,
  ownerUserId: string,
  remoteCollectionId: string
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const v = viewerUid.trim()
  const o = ownerUserId.trim()
  const r = remoteCollectionId.trim()
  if (!v || !o || !r) throw new Error('Invalid ids')
  const subId = collectionBookmarkDocumentId(o, r)
  const ref = adminDb.collection('users').doc(v).collection('workoutCollectionSubscriptions').doc(subId)
  const snap = await ref.get()
  if (!snap.exists) return
  const d = snap.data() as Record<string, unknown>
  if (str(d, 'subscriberUserId').trim() !== v) throw new Error('Forbidden')
  if (str(d, 'ownerUserId').trim() !== o || str(d, 'remoteCollectionId').trim() !== r) {
    throw new Error('Forbidden')
  }
  await ref.delete()
}

/** Active shared workout subscriptions for Bookmarks (subscriber-owned docs). */
export async function listActiveSharedWorkoutBookmarksForUser(
  uid: string
): Promise<SharedWorkoutBookmarkRow[]> {
  if (!adminDb) return []
  const u = uid.trim()
  if (!u) return []
  const snap = await adminDb
    .collection('users')
    .doc(u)
    .collection('workoutSubscriptions')
    .where('status', '==', 'active')
    .get()
  const out: SharedWorkoutBookmarkRow[] = []
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>
    const ownerUserId = str(d, 'ownerUserId').trim()
    const remoteWorkoutId = str(d, 'remoteWorkoutId').trim()
    if (!ownerUserId || !remoteWorkoutId) continue
    const gid = str(d, 'mirrorGroupId').trim()
    out.push({
      subscriptionDocumentId: doc.id,
      ownerUserId,
      remoteWorkoutId,
      mirrorGroupId: gid ? gid : null,
      workoutNameSnapshot: str(d, 'workoutNameSnapshot').trim() || null,
      workoutDescriptionSnapshot: str(d, 'workoutDescriptionSnapshot').trim() || null,
      isUnavailable: bool(d, 'isUnavailable') === true,
      updatedAt: tsToIso(d.updatedAt),
    })
  }
  out.sort((a, b) => (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0))
  return out
}

/** Active shared collection subscriptions for Bookmarks (subscriber-owned docs). */
export async function listActiveSharedCollectionBookmarksForUser(
  uid: string
): Promise<SharedCollectionBookmarkRow[]> {
  if (!adminDb) return []
  const u = uid.trim()
  if (!u) return []
  const snap = await adminDb
    .collection('users')
    .doc(u)
    .collection('workoutCollectionSubscriptions')
    .where('status', '==', 'active')
    .get()
  const out: SharedCollectionBookmarkRow[] = []
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>
    const ownerUserId = str(d, 'ownerUserId').trim()
    const remoteCollectionId = str(d, 'remoteCollectionId').trim()
    if (!ownerUserId || !remoteCollectionId) continue
    const gid = str(d, 'mirrorGroupId').trim()
    out.push({
      subscriptionDocumentId: doc.id,
      ownerUserId,
      remoteCollectionId,
      mirrorGroupId: gid ? gid : null,
      collectionNameSnapshot: str(d, 'collectionNameSnapshot').trim() || null,
      collectionDescriptionSnapshot: str(d, 'collectionDescriptionSnapshot').trim() || null,
      collectionWorkoutCountSnapshot: intNonNegOrNull(d, 'collectionWorkoutCountSnapshot'),
      isUnavailable: bool(d, 'isUnavailable') === true,
      updatedAt: tsToIso(d.updatedAt),
    })
  }
  out.sort((a, b) => (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0))
  return out
}

