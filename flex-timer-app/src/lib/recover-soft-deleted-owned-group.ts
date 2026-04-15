import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import { groupHandleDisplayForStore, stripAtPrefix, subgroupInternalHandleKey } from '@/lib/group-handle'

const GROUPS_COLLECTION = 'groups'
const PUBLIC_GROUP_PROFILES = 'publicGroupProfiles'
const GROUP_HANDLE_INDEX = 'groupHandleIndex'

/**
 * Clears soft-delete on an owned hub (`groups`, `publicGroupProfiles`) and restores
 * `groupHandleIndex` for root hubs when the handle key is still available.
 */
export async function recoverSoftDeletedOwnedGroup(ownerUserId: string, groupId: string): Promise<void> {
  if (!adminDb) throw new Error('Database not configured')

  const gRef = adminDb.collection(GROUPS_COLLECTION).doc(groupId)
  const snap = await gRef.get()
  if (!snap.exists) throw new Error('Hub not found')
  const d = snap.data() as Record<string, unknown>
  if (d.ownerUserId !== ownerUserId) throw new Error('You do not own this hub')
  if (d.deletedAt == null) throw new Error('Hub is not deleted')

  const parentRaw = d.parentGroupId
  const parentId = typeof parentRaw === 'string' && parentRaw.trim() ? parentRaw.trim() : ''
  if (parentId) {
    const pSnap = await adminDb.collection(GROUPS_COLLECTION).doc(parentId).get()
    if (!pSnap.exists) throw new Error('Parent hub not found')
    const pd = pSnap.data() as Record<string, unknown>
    if (pd.deletedAt != null) throw new Error('Restore the parent hub first')
  }

  const handleKey = typeof d.handleKey === 'string' ? d.handleKey.trim() : ''
  const handleStored = typeof d.handle === 'string' ? d.handle.trim() : ''
  const internalKey = subgroupInternalHandleKey(groupId)
  const isSubgroup = Boolean(parentId)
  const shouldRestoreHandleIndex =
    !isSubgroup &&
    handleKey !== '' &&
    handleKey !== internalKey

  const now = FieldValue.serverTimestamp()
  const pRef = adminDb.collection(PUBLIC_GROUP_PROFILES).doc(groupId)
  const batch = adminDb.batch()
  batch.update(gRef, { deletedAt: FieldValue.delete(), updatedAt: now })
  batch.update(pRef, { deletedAt: FieldValue.delete(), updatedAt: now })

  if (shouldRestoreHandleIndex) {
    const idxRef = adminDb.collection(GROUP_HANDLE_INDEX).doc(handleKey)
    const idxSnap = await idxRef.get()
    if (idxSnap.exists) {
      const idx = idxSnap.data() as Record<string, unknown>
      const existingGid = idx.groupId
      if (typeof existingGid === 'string' && existingGid !== groupId) {
        throw new Error('This handle is now in use by another hub. Change your handle after restoring.')
      }
    }
    const handleForIndex =
      handleStored ||
      groupHandleDisplayForStore(stripAtPrefix(''), handleKey)
    batch.set(
      idxRef,
      {
        groupId,
        ownerUserId: ownerUserId,
        handleKey,
        handle: handleForIndex,
        updatedAt: now,
      },
      { merge: true }
    )
  }

  await batch.commit()
}
