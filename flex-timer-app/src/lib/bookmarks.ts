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
      isUnavailable: bool(d, 'isUnavailable') === true,
      updatedAt: tsToIso(d.updatedAt),
    })
  }
  out.sort((a, b) => (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0))
  return out
}

