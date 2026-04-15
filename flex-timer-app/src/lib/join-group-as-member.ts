import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import { isUserMemberOfGroup, setGroupMembershipIndexForMemberInBatch } from '@/lib/group-invite'
import { parseFirestoreJoinPolicy, type AppGroupJoinPolicy } from '@/types/group'

const GROUPS = 'groups'
const PUBLIC_GROUP_PROFILES = 'publicGroupProfiles'

function str(d: Record<string, unknown>, key: string): string {
  const v = d[key]
  return typeof v === 'string' ? v : ''
}

export type JoinGroupOutcome =
  | { kind: 'joined' }
  | { kind: 'alreadyMember' }
  | { kind: 'requested' }
  | { kind: 'alreadyPending' }

export class JoinGroupError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'JoinGroupError'
  }
}

/**
 * Public hub: add active member (and enforce parent membership for sub hubs).
 * Restricted hub: upsert pending `joinRequests/{userId}`.
 */
export async function joinOrRequestGroup(userId: string, groupId: string): Promise<JoinGroupOutcome> {
  if (!adminDb) throw new JoinGroupError('Database not configured', 503)

  const gRef = adminDb.collection(GROUPS).doc(groupId)
  const gSnap = await gRef.get()
  if (!gSnap.exists) throw new JoinGroupError('Hub not found', 404)
  const gd = gSnap.data() as Record<string, unknown>
  if (gd.deletedAt != null) throw new JoinGroupError('Hub not found', 404)

  const joinPolicy = parseFirestoreJoinPolicy(gd.joinPolicy)
  if (!joinPolicy) throw new JoinGroupError('Invalid hub', 400)

  if (await isUserMemberOfGroup(groupId, userId)) {
    return { kind: 'alreadyMember' }
  }

  const parentRaw = str(gd, 'parentGroupId').trim()
  if (parentRaw) {
    const inParent = await isUserMemberOfGroup(parentRaw, userId)
    if (!inParent) {
      throw new JoinGroupError('Join the parent hub first, then you can join this sub hub.', 403)
    }
  }

  if (joinPolicy === 'private') {
    throw new JoinGroupError('This hub is private. You need an invitation.', 403)
  }

  const now = FieldValue.serverTimestamp()
  const mRef = gRef.collection('members').doc(userId)

  if (joinPolicy === 'public') {
    const pSnap = await adminDb.collection(PUBLIC_GROUP_PROFILES).doc(groupId).get()
    const pd = pSnap.exists ? (pSnap.data() as Record<string, unknown>) : {}
    const batch = adminDb.batch()
    batch.set(
      mRef,
      {
        userId,
        role: 'member',
        status: 'active',
        updatedAt: now,
        joinedAt: now,
      },
      { merge: true },
    )
    setGroupMembershipIndexForMemberInBatch(batch, {
      memberUserId: userId,
      groupId,
      groupData: gd,
      publicProfileData: pd,
      updatedAt: now,
    })
    await batch.commit()
    return { kind: 'joined' }
  }

  // restricted
  const jrRef = gRef.collection('joinRequests').doc(userId)
  const jrSnap = await jrRef.get()
  if (jrSnap.exists) {
    const st = (jrSnap.data() as Record<string, unknown>).status
    if (typeof st === 'string' && st === 'pending') {
      return { kind: 'alreadyPending' }
    }
  }
  await jrRef.set(
    {
      userId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    { merge: true },
  )
  return { kind: 'requested' }
}
