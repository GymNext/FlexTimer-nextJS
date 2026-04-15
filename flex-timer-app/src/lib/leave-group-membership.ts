import { FieldValue } from 'firebase-admin/firestore'
import { appendUserLeaveGroupFeedItem } from '@/lib/group-feed-user-join'
import { adminDb } from '@/lib/firebase-admin'
import { parseFirestoreJoinPolicy } from '@/types/group'

const GROUPS = 'groups'

export class LeaveMembershipError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'LeaveMembershipError'
  }
}

/**
 * Remove the signed-in user from `groups/{groupId}/members/{userId}`.
 * Hub owners must use Hubs instead (cannot leave via memberships UI).
 */
export async function leaveGroupMembership(userId: string, groupId: string): Promise<void> {
  if (!adminDb) throw new LeaveMembershipError('Database not configured', 503)

  const gRef = adminDb.collection(GROUPS).doc(groupId)
  const gSnap = await gRef.get()
  if (!gSnap.exists) throw new LeaveMembershipError('Hub not found', 404)
  const gd = gSnap.data() as Record<string, unknown>
  if (gd.deletedAt != null) throw new LeaveMembershipError('Hub not found', 404)

  const owner = typeof gd.ownerUserId === 'string' ? gd.ownerUserId.trim() : ''
  if (owner === userId) {
    throw new LeaveMembershipError('Use Hubs to manage hubs you own.', 403)
  }

  const mRef = gRef.collection('members').doc(userId)
  const mSnap = await mRef.get()
  if (!mSnap.exists) throw new LeaveMembershipError('You are not a member of this hub.', 403)

  const mData = mSnap.data() as Record<string, unknown>
  const st = mData.status
  if (typeof st === 'string' && st !== 'active') {
    throw new LeaveMembershipError('You are not an active member.', 403)
  }
  const roleRaw = typeof mData.role === 'string' ? mData.role.trim().toLowerCase() : ''
  if (roleRaw === 'owner') {
    throw new LeaveMembershipError('Owners cannot leave through this flow.', 403)
  }

  const now = FieldValue.serverTimestamp()
  const batch = adminDb.batch()
  const joinPolicy = parseFirestoreJoinPolicy(gd.joinPolicy)
  if (joinPolicy && joinPolicy !== 'public') {
    appendUserLeaveGroupFeedItem(batch, groupId, userId, now)
  }
  batch.delete(mRef)
  const idxRef = adminDb.collection('users').doc(userId).collection('groupMembershipIndex').doc(groupId)
  batch.delete(idxRef)
  await batch.commit()
}
