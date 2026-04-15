import { adminDb } from '@/lib/firebase-admin'
import { getOwnedGroupsForUser } from '@/lib/firestore'
import { listActiveMembershipGroupIds } from '@/lib/group-memberships'

const USER_FEED_OWNER_FIELD = 'userFeedOwnerId'

function isCreateGroupHubFeedDoc(data: Record<string, unknown>): boolean {
  const raw = String(data.actionType ?? data.type ?? '').trim()
  if (raw === 'createGroup') return true
  const alnum = raw.toLowerCase().replace(/[\s_\-./]+/g, '')
  return alnum === 'creategroup'
}

async function userOwnsGroup(uid: string, groupId: string): Promise<boolean> {
  const owned = await getOwnedGroupsForUser(uid)
  return owned.some((g) => g.groupId === groupId)
}

export async function userCanReadGroupFeed(uid: string, groupId: string): Promise<boolean> {
  if (!adminDb) return false
  const u = uid.trim()
  const gid = groupId.trim()
  if (!u || !gid) return false
  const [owned, memberIds] = await Promise.all([
    getOwnedGroupsForUser(u),
    listActiveMembershipGroupIds(u),
  ])
  if (owned.some((g) => g.groupId === gid)) return true
  return memberIds.includes(gid)
}

/**
 * Deletes `users/{uid}/feed/{feedItemId}` when the document belongs to that user.
 */
export async function deletePersonalFeedItemForUser(uid: string, feedItemId: string): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const u = uid.trim()
  const fid = feedItemId.trim()
  if (!u || !fid) throw new Error('Missing feed item')

  const ref = adminDb.collection('users').doc(u).collection('feed').doc(fid)
  const snap = await ref.get()
  if (!snap.exists) {
    const err = new Error('Feed item not found')
    ;(err as Error & { status?: number }).status = 404
    throw err
  }
  const owner = String((snap.data() as Record<string, unknown>)[USER_FEED_OWNER_FIELD] ?? '').trim()
  if (owner !== u) {
    const err = new Error('You cannot hide this activity')
    ;(err as Error & { status?: number }).status = 403
    throw err
  }
  await ref.delete()
}

/**
 * Deletes `groups/{groupId}/feed/{feedItemId}` when the caller authored the row (`actorUserId`),
 * or when the row is a hub `createGroup` event and the caller owns that hub.
 */
export async function deleteGroupFeedItemForActor(uid: string, groupId: string, feedItemId: string): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const u = uid.trim()
  const gid = groupId.trim()
  const fid = feedItemId.trim()
  if (!u || !gid || !fid) throw new Error('Missing feed item')

  const allowed = await userCanReadGroupFeed(u, gid)
  if (!allowed) {
    const err = new Error('You cannot hide activity in this group feed')
    ;(err as Error & { status?: number }).status = 403
    throw err
  }

  const ref = adminDb.collection('groups').doc(gid).collection('feed').doc(fid)
  const snap = await ref.get()
  if (!snap.exists) {
    const err = new Error('Feed item not found')
    ;(err as Error & { status?: number }).status = 404
    throw err
  }
  const data = snap.data() as Record<string, unknown>
  const actor = String(data.actorUserId ?? '').trim()
  if (actor !== u) {
    const createGroupRow = isCreateGroupHubFeedDoc(data)
    if (!createGroupRow || !(await userOwnsGroup(u, gid))) {
      const err = new Error('You can only hide your own activity from the group feed')
      ;(err as Error & { status?: number }).status = 403
      throw err
    }
  }
  await ref.delete()
}
