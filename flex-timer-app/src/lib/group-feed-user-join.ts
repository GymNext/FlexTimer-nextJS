import type { WriteBatch } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'

const GROUPS = 'groups'
const FEED = 'feed'

/**
 * Appends `groups/{groupId}/feed/*` with iOS-shaped membership join activity (`actionType: userJoin`).
 */
export function appendUserJoinGroupFeedItem(
  batch: WriteBatch,
  groupId: string,
  actorUserId: string,
  createdAt: FieldValue,
): void {
  if (!adminDb) return
  const feedRef = adminDb.collection(GROUPS).doc(groupId).collection(FEED).doc()
  batch.set(feedRef, {
    actionType: 'userJoin',
    actorUserId,
    createdAt,
    groupId,
    objectId: actorUserId,
  })
}

/**
 * Appends `groups/{groupId}/feed/*` with iOS-shaped membership leave activity (`actionType: userLeave`).
 */
export function appendUserLeaveGroupFeedItem(
  batch: WriteBatch,
  groupId: string,
  actorUserId: string,
  createdAt: FieldValue,
): void {
  if (!adminDb) return
  const feedRef = adminDb.collection(GROUPS).doc(groupId).collection(FEED).doc()
  batch.set(feedRef, {
    actionType: 'userLeave',
    actorUserId,
    createdAt,
    groupId,
    objectId: actorUserId,
  })
}
