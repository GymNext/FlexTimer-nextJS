import type { CollectionReference } from 'firebase-admin/firestore'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'

const GROUPS_COLLECTION = 'groups'
const PUBLIC_GROUP_PROFILES = 'publicGroupProfiles'
const GROUP_HANDLE_INDEX = 'groupHandleIndex'

/**
 * Soft-deletes an owned hub and clears its handle index entry when safe.
 * Fails if the user still owns a non-deleted sub hub under this group.
 */
export async function softDeleteOwnedGroup(ownerUserId: string, groupId: string): Promise<void> {
  if (!adminDb) throw new Error('Database not configured')

  const gRef = adminDb.collection(GROUPS_COLLECTION).doc(groupId)
  const snap = await gRef.get()
  if (!snap.exists) throw new Error('Hub not found')
  const d = snap.data() as Record<string, unknown>
  if (d.deletedAt != null) throw new Error('Hub already deleted')
  if (d.ownerUserId !== ownerUserId) throw new Error('You do not own this hub')

  const ownedSnap = await adminDb.collection(GROUPS_COLLECTION).where('ownerUserId', '==', ownerUserId).get()
  for (const doc of ownedSnap.docs) {
    if (doc.id === groupId) continue
    const row = doc.data() as Record<string, unknown>
    if (row.deletedAt != null) continue
    const parent = row.parentGroupId
    if (typeof parent === 'string' && parent.trim() === groupId) {
      throw new Error('Remove or delete sub hubs before deleting this hub')
    }
  }

  const handleKey = typeof d.handleKey === 'string' ? d.handleKey.trim() : ''
  const now = FieldValue.serverTimestamp()
  const delTs = Timestamp.now()

  const batch = adminDb.batch()
  batch.set(gRef, { deletedAt: delTs, updatedAt: now }, { merge: true })
  batch.set(adminDb.collection(PUBLIC_GROUP_PROFILES).doc(groupId), { deletedAt: delTs, updatedAt: now }, {
    merge: true,
  })

  if (handleKey) {
    const idxRef = adminDb.collection(GROUP_HANDLE_INDEX).doc(handleKey)
    const idxSnap = await idxRef.get()
    if (idxSnap.exists) {
      const idx = idxSnap.data() as Record<string, unknown>
      if (idx.groupId === groupId) {
        batch.delete(idxRef)
      }
    }
  }

  await batch.commit()
}

async function deleteAllDocumentsInCollection(col: CollectionReference): Promise<void> {
  if (!adminDb) return
  const batchSize = 400
  for (;;) {
    const snap = await col.limit(batchSize).get()
    if (snap.empty) break
    const batch = adminDb.batch()
    for (const doc of snap.docs) {
      batch.delete(doc.ref)
    }
    await batch.commit()
  }
}

/**
 * Hard-deletes a soft-deleted owned hub: all subcollections, `publicGroupProfiles`, handle index entry, then `groups`.
 * Fails if the hub is not soft-deleted, not owned, or any sub hub still references this hub as parent.
 */
export async function permanentlyDeleteOwnedGroup(ownerUserId: string, groupId: string): Promise<void> {
  if (!adminDb) throw new Error('Database not configured')

  const gRef = adminDb.collection(GROUPS_COLLECTION).doc(groupId)
  const snap = await gRef.get()
  if (!snap.exists) throw new Error('Hub not found')
  const d = snap.data() as Record<string, unknown>
  if (d.ownerUserId !== ownerUserId) throw new Error('You do not own this hub')
  if (d.deletedAt == null) {
    throw new Error('Hub must be in deleted state before it can be permanently removed')
  }

  const ownedSnap = await adminDb.collection(GROUPS_COLLECTION).where('ownerUserId', '==', ownerUserId).get()
  for (const doc of ownedSnap.docs) {
    if (doc.id === groupId) continue
    const row = doc.data() as Record<string, unknown>
    const parent = row.parentGroupId
    if (typeof parent === 'string' && parent.trim() === groupId) {
      throw new Error('Remove or permanently delete sub hubs under this hub first')
    }
  }

  const handleKey = typeof d.handleKey === 'string' ? d.handleKey.trim() : ''

  const subCols = await gRef.listCollections()
  for (const colRef of subCols) {
    await deleteAllDocumentsInCollection(colRef)
  }

  if (handleKey) {
    const idxRef = adminDb.collection(GROUP_HANDLE_INDEX).doc(handleKey)
    const idxSnap = await idxRef.get()
    if (idxSnap.exists) {
      const idx = idxSnap.data() as Record<string, unknown>
      if (idx.groupId === groupId) {
        await idxRef.delete()
      }
    }
  }

  await adminDb.collection(PUBLIC_GROUP_PROFILES).doc(groupId).delete()
  await gRef.delete()
}
