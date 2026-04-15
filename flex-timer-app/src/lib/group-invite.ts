import {
  FieldPath,
  FieldValue,
  type DocumentSnapshot,
  type WriteBatch,
} from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import { appendUserJoinGroupFeedItem } from '@/lib/group-feed-user-join'
import { stripAtPrefix } from '@/lib/group-handle'
import { pickGroupPhotoUrl } from '@/lib/group-memberships'
import { isAppGroupType, parseFirestoreJoinPolicy, type AppGroupJoinPolicy, type AppGroupType } from '@/types/group'

const GROUPS = 'groups'
const PUBLIC_GROUP_PROFILES = 'publicGroupProfiles'
const USER_GROUP_MEMBERSHIP_INDEX = 'groupMembershipIndex'

function str(d: Record<string, unknown>, key: string): string {
  const v = d[key]
  return typeof v === 'string' ? v : ''
}

function groupTypeFromData(d: Record<string, unknown>): AppGroupType | null {
  const gt = str(d, 'groupType').trim()
  return gt && isAppGroupType(gt) ? gt : null
}

function joinPolicyFromData(d: Record<string, unknown>): AppGroupJoinPolicy {
  return parseFirestoreJoinPolicy(d.joinPolicy) ?? 'private'
}

function handleForDisplayGroup(groupDoc: Record<string, unknown>): string | null {
  if (str(groupDoc, 'parentGroupId').trim()) return null
  const raw = str(groupDoc, 'handle').trim()
  if (!raw) return null
  const display = stripAtPrefix(raw.startsWith('@') ? raw : `@${raw}`)
  return display || null
}

function membershipIndexBoolish(d: Record<string, unknown>, key: string): boolean {
  const v = d[key]
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  return false
}

/**
 * `users/{memberUid}/groupMembershipIndex/{groupId}` — iOS `joinPublicGroup`, `acceptGroupInvite`, `approveJoinRequest`.
 * Owners are not written here.
 */
export function setGroupMembershipIndexForMemberInBatch(
  batch: WriteBatch,
  params: {
    memberUserId: string
    groupId: string
    groupData: Record<string, unknown>
    publicProfileData: Record<string, unknown>
    updatedAt: ReturnType<typeof FieldValue.serverTimestamp>
  },
): void {
  if (!adminDb) return
  const gid = params.groupId.trim()
  const uid = params.memberUserId.trim()
  if (!gid || !uid) return

  const gd = params.groupData
  const pd = params.publicProfileData
  const joinPolicy = joinPolicyFromData(gd)
  const memberShareIdx =
    joinPolicy === 'public' ? false : membershipIndexBoolish(pd, 'membersMayShareContent') || membershipIndexBoolish(gd, 'membersMayShareContent')

  const name = str(pd, 'name').trim() || str(gd, 'name').trim()
  if (!name) return

  const groupType = str(pd, 'groupType').trim() || str(gd, 'groupType').trim()
  const handle = str(pd, 'handle').trim() || handleForDisplayGroup(gd) || ''
  const photoUrl = pickGroupPhotoUrl(gd, pd)
  const idxParent = str(gd, 'parentGroupId').trim()
  const joinPolicyRaw = str(gd, 'joinPolicy').trim() || joinPolicy

  const idxRef = adminDb.collection('users').doc(uid).collection(USER_GROUP_MEMBERSHIP_INDEX).doc(gid)
  batch.set(
    idxRef,
    {
      groupId: gid,
      groupType,
      role: 'member',
      status: 'active',
      name,
      handle,
      photoUrl: photoUrl ?? null,
      parentGroupId: idxParent ? idxParent : null,
      joinPolicy: joinPolicyRaw,
      membersMayShareContent: memberShareIdx,
      updatedAt: params.updatedAt,
    },
    { merge: true },
  )
}

function parseInviteTimestamp(data: Record<string, unknown>): string | null {
  const raw = data.invitedAt
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

export type OwnedGroupRow = Record<string, unknown> & {
  ownerUserId?: string
  deletedAt?: unknown
  parentGroupId?: string
}

export async function getOwnedGroupOrNull(
  ownerUserId: string,
  groupId: string,
): Promise<{ id: string; data: OwnedGroupRow } | null> {
  if (!adminDb) return null
  const ref = adminDb.collection(GROUPS).doc(groupId)
  const snap = await ref.get()
  if (!snap.exists) return null
  const d = snap.data() as OwnedGroupRow
  if (d.deletedAt != null) return null
  if (typeof d.ownerUserId !== 'string' || d.ownerUserId !== ownerUserId) return null
  return { id: snap.id, data: d }
}

export async function listGroupMemberUserIds(groupId: string): Promise<string[]> {
  if (!adminDb) return []
  const snap = await adminDb.collection(GROUPS).doc(groupId).collection('members').get()
  return snap.docs.map((doc) => doc.id)
}

export async function countGroupMembers(groupId: string): Promise<number> {
  if (!adminDb) return 0
  const agg = await adminDb.collection(GROUPS).doc(groupId).collection('members').count().get()
  return agg.data().count
}

export async function isUserMemberOfGroup(groupId: string, userId: string): Promise<boolean> {
  if (!adminDb) return false
  const snap = await adminDb.collection(GROUPS).doc(groupId).collection('members').doc(userId).get()
  if (!snap.exists) return false
  const st = (snap.data() as Record<string, unknown>)?.status
  if (typeof st === 'string' && st !== '' && st !== 'active') return false
  return true
}

export type MemberListItem = {
  userId: string
  displayName: string
  handle: string | null
}

export async function getPublicProfileSnippet(userId: string): Promise<MemberListItem> {
  if (!adminDb) {
    return { userId, displayName: '', handle: null }
  }
  const snap = await adminDb.collection('publicUserProfiles').doc(userId).get()
  if (!snap.exists) {
    return { userId, displayName: userId.slice(0, 8) + '…', handle: null }
  }
  const d = snap.data() as Record<string, unknown>
  const fullName = typeof d.fullName === 'string' ? d.fullName.trim() : ''
  const first = typeof d.firstName === 'string' ? d.firstName.trim() : ''
  const last = typeof d.lastName === 'string' ? d.lastName.trim() : ''
  const displayName = fullName || [first, last].filter(Boolean).join(' ').trim() || userId
  const handle = typeof d.handle === 'string' && d.handle.trim() ? d.handle.trim() : null
  return { userId, displayName, handle }
}

function memberDocIsActive(data: Record<string, unknown>): boolean {
  const st = data.status
  if (typeof st === 'string' && st !== '' && st !== 'active') return false
  return true
}

/** Active `members/{userId}` docs only, excluding `excludeUserId` (e.g. viewer). Sorted by display name. */
export type ActiveGroupMemberRow = MemberListItem & { role: string | null }

export async function listActiveGroupMembersExcluding(
  groupId: string,
  excludeUserId: string,
): Promise<ActiveGroupMemberRow[]> {
  if (!adminDb) return []
  const gid = groupId.trim()
  const exclude = excludeUserId.trim()
  if (!gid) return []
  const snap = await adminDb.collection(GROUPS).doc(gid).collection('members').get()
  const rows: { userId: string; role: string | null }[] = []
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>
    if (!memberDocIsActive(d)) continue
    const uid = doc.id
    if (exclude && uid === exclude) continue
    const roleRaw = d.role
    const role = typeof roleRaw === 'string' && roleRaw.trim() ? roleRaw.trim() : null
    rows.push({ userId: uid, role })
  }
  const profiles = await Promise.all(
    rows.map(async (r) => {
      const p = await getPublicProfileSnippet(r.userId)
      return { ...p, role: r.role }
    }),
  )
  profiles.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }))
  return profiles
}

export async function listGroupMembersWithProfiles(
  groupId: string,
  options?: { omitUserId?: string | null },
): Promise<MemberListItem[]> {
  const omit = typeof options?.omitUserId === 'string' ? options.omitUserId.trim() : ''
  const ids = (await listGroupMemberUserIds(groupId)).filter((id) => !omit || id !== omit)
  const out = await Promise.all(ids.map((id) => getPublicProfileSnippet(id)))
  out.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }))
  return out
}

/** Paginate members by Firestore document id (user id) for stable cursors. */
export async function listGroupMembersWithProfilesPage(
  groupId: string,
  pageSize: number,
  startAfterUserId: string | null,
  options?: { omitUserId?: string | null },
): Promise<{ members: MemberListItem[]; nextCursor: string | null }> {
  if (!adminDb) return { members: [], nextCursor: null }
  const omit = typeof options?.omitUserId === 'string' ? options.omitUserId.trim() : ''
  const col = adminDb.collection(GROUPS).doc(groupId).collection('members')
  let q = col.orderBy(FieldPath.documentId()).limit(pageSize + 1)
  if (startAfterUserId) {
    q = q.startAfter(startAfterUserId)
  }
  const snap = await q.get()
  const docs = snap.docs
  const hasMore = docs.length > pageSize
  const pageDocs = hasMore ? docs.slice(0, pageSize) : docs
  const ids = pageDocs.map((d) => d.id).filter((id) => !omit || id !== omit)
  const members = await Promise.all(ids.map((id) => getPublicProfileSnippet(id)))
  const nextCursor = hasMore ? (pageDocs[pageDocs.length - 1]?.id ?? null) : null
  return { members, nextCursor }
}

export type OutgoingInviteRow = {
  invitedUserId: string
  displayName: string
  handle: string | null
}

export async function listOutgoingPendingInvitesPage(
  groupId: string,
  invitedByUserId: string,
  pageSize: number,
  startAfterInvitedUserId: string | null,
): Promise<{ invites: OutgoingInviteRow[]; nextCursor: string | null }> {
  if (!adminDb) return { invites: [], nextCursor: null }
  const col = adminDb.collection(GROUPS).doc(groupId).collection('invites')
  let q = col.where('invitedByUserId', '==', invitedByUserId).orderBy(FieldPath.documentId()).limit(pageSize + 1)
  if (startAfterInvitedUserId) {
    q = q.startAfter(startAfterInvitedUserId)
  }
  const snap = await q.get()
  const docs = snap.docs
  const hasMore = docs.length > pageSize
  const pageDocs = hasMore ? docs.slice(0, pageSize) : docs
  const invites: OutgoingInviteRow[] = []
  for (const doc of pageDocs) {
    const uid = doc.id
    const profile = await getPublicProfileSnippet(uid)
    invites.push({
      invitedUserId: uid,
      displayName: profile.displayName,
      handle: profile.handle,
    })
  }
  const nextCursor = hasMore ? (pageDocs[pageDocs.length - 1]?.id ?? null) : null
  return { invites, nextCursor }
}

export async function countOutgoingPendingInvites(groupId: string, invitedByUserId: string): Promise<number> {
  if (!adminDb) return 0
  const agg = await adminDb
    .collection(GROUPS)
    .doc(groupId)
    .collection('invites')
    .where('invitedByUserId', '==', invitedByUserId)
    .count()
    .get()
  return agg.data().count
}

export async function cancelOutgoingInvite(params: {
  groupId: string
  invitedUserId: string
  cancelledByUserId: string
}): Promise<void> {
  if (!adminDb) throw new Error('Database not configured')
  const ref = adminDb.collection(GROUPS).doc(params.groupId).collection('invites').doc(params.invitedUserId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('Invite not found')
  const d = snap.data() as Record<string, unknown>
  const st = d.status
  if (typeof st === 'string' && st !== '' && st !== 'pending') {
    throw new Error('Invite is no longer pending')
  }
  if (typeof d.invitedByUserId !== 'string' || d.invitedByUserId !== params.cancelledByUserId) {
    throw new Error('You can only cancel invites you sent')
  }
  await ref.delete()
}

export type CreateInviteResult = 'created' | 'alreadyPending' | 'alreadyMember'

export async function createGroupInvite(params: {
  groupId: string
  invitedUserId: string
  invitedByUserId: string
  /** Sub hub: invited user must be in this parent group */
  parentGroupId: string | null
}): Promise<CreateInviteResult> {
  if (!adminDb) throw new Error('Database not configured')
  const { groupId, invitedUserId, invitedByUserId, parentGroupId } = params
  if (invitedUserId === invitedByUserId) {
    throw new Error('You cannot invite yourself')
  }

  if (await isUserMemberOfGroup(groupId, invitedUserId)) {
    return 'alreadyMember'
  }

  if (parentGroupId) {
    const inParent = await isUserMemberOfGroup(parentGroupId, invitedUserId)
    if (!inParent) {
      throw new Error('This user must be a member of the parent hub first')
    }
  }

  const inviteRef = adminDb.collection(GROUPS).doc(groupId).collection('invites').doc(invitedUserId)
  const existing = await inviteRef.get()
  if (existing.exists) {
    const st = (existing.data() as Record<string, unknown>)?.status
    if (st == null || st === 'pending') return 'alreadyPending'
  }

  // Match iOS `StorageManager._writeHubInviteDocument` + collectionGroup("invites").whereField("userId", …)
  await inviteRef.set(
    {
      userId: invitedUserId,
      invitedByUserId,
      invitedAt: FieldValue.serverTimestamp(),
      status: 'pending',
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  return 'created'
}

/**
 * Hub owner removes another user's `groups/{groupId}/members/{memberUserId}` document.
 * Cannot remove the hub owner or a member with role `owner`.
 */
export async function removeGroupMemberAsOwner(params: {
  ownerUserId: string
  groupId: string
  memberUserId: string
}): Promise<void> {
  if (!adminDb) throw new Error('Database not configured')
  const gid = params.groupId.trim()
  const mid = params.memberUserId.trim()
  if (!gid || !mid) throw new Error('Invalid request')

  const owned = await getOwnedGroupOrNull(params.ownerUserId, gid)
  if (!owned) throw new Error('Hub not found')

  const ownerId =
    typeof owned.data.ownerUserId === 'string' ? owned.data.ownerUserId.trim() : ''
  if (mid === ownerId) {
    throw new Error('Cannot remove the hub owner')
  }

  const mRef = adminDb.collection(GROUPS).doc(gid).collection('members').doc(mid)
  const mSnap = await mRef.get()
  if (!mSnap.exists) throw new Error('This user is not a member of this hub')

  const mData = mSnap.data() as Record<string, unknown>
  const st = mData.status
  if (typeof st === 'string' && st !== '' && st !== 'active') {
    throw new Error('This member is not active')
  }
  const roleRaw = typeof mData.role === 'string' ? mData.role.trim().toLowerCase() : ''
  if (roleRaw === 'owner') {
    throw new Error('Cannot remove another owner')
  }

  const idxRef = adminDb.collection('users').doc(mid).collection(USER_GROUP_MEMBERSHIP_INDEX).doc(gid)
  const batch = adminDb.batch()
  batch.delete(mRef)
  batch.delete(idxRef)
  await batch.commit()
}

export type IncomingHubInviteListItem = {
  groupId: string
  groupName: string
  handleDisplay: string | null
  groupType: AppGroupType | null
  joinPolicy: AppGroupJoinPolicy
  invitedAt: string | null
  invitedByUserId: string
  invitedByDisplayName: string
  invitedByHandle: string | null
}

export type GroupInvitePublicView = {
  groupId: string
  name: string
  handle: string | null
  bio: string | null
  joinPolicy: AppGroupJoinPolicy
  groupType: AppGroupType | null
  photoUrl: string | null
  country: string | null
  region: string | null
  city: string | null
  parentGroupId: string | null
  parentGroupName: string | null
}

/**
 * Pending hub invites addressed to this user (`collectionGroup("invites")` where `userId` matches).
 */
export async function listIncomingHubInvitesForUser(inviteeUserId: string): Promise<IncomingHubInviteListItem[]> {
  if (!adminDb) return []
  const uid = inviteeUserId.trim()
  if (!uid) return []

  // iOS writes `userId`, `invitedByUserId`, `invitedAt` only — no `status`. Firestore omits docs missing `status`
  // from `where('status','==','pending')`, so we query by `userId` only and treat missing status as pending.
  let snap
  try {
    snap = await adminDb.collectionGroup('invites').where('userId', '==', uid).get()
  } catch {
    return []
  }

  type RowAcc = IncomingHubInviteListItem & { sortTime: number }
  const acc: RowAcc[] = []

  for (const doc of snap.docs) {
    const groupDocRef = doc.ref.parent.parent
    if (!groupDocRef || groupDocRef.parent?.id !== GROUPS) continue
    const groupId = groupDocRef.id
    if (doc.id !== uid) continue

    const d = doc.data() as Record<string, unknown>
    const st = str(d, 'status').trim() || 'pending'
    if (st !== 'pending') continue
    const invitedUser = str(d, 'userId').trim()
    if (invitedUser && invitedUser !== uid) continue

    const gSnap = await adminDb.collection(GROUPS).doc(groupId).get()
    if (!gSnap.exists) continue
    const gd = gSnap.data() as Record<string, unknown>
    if (gd.deletedAt != null) continue
    const name = str(gd, 'name').trim()
    if (!name) continue

    const invitedBy = str(d, 'invitedByUserId').trim()
    if (!invitedBy) continue
    const inviter = await getPublicProfileSnippet(invitedBy)
    const invitedAt = parseInviteTimestamp(d)
    const sortTime = invitedAt ? new Date(invitedAt).getTime() : 0

    acc.push({
      groupId,
      groupName: name,
      handleDisplay: handleForDisplayGroup(gd),
      groupType: groupTypeFromData(gd),
      joinPolicy: joinPolicyFromData(gd),
      invitedAt,
      invitedByUserId: invitedBy,
      invitedByDisplayName: inviter.displayName,
      invitedByHandle: inviter.handle,
      sortTime,
    })
  }

  acc.sort((a, b) => {
    if (b.sortTime !== a.sortTime) return b.sortTime - a.sortTime
    return a.groupName.localeCompare(b.groupName, undefined, { sensitivity: 'base' })
  })

  return acc.map(({ sortTime: _t, ...row }) => row)
}

async function buildGroupInvitePublicViewFromGroupSnaps(
  gid: string,
  gSnap: DocumentSnapshot,
  pSnap: DocumentSnapshot,
): Promise<GroupInvitePublicView | null> {
  if (!adminDb || !gSnap.exists) return null
  const gd = gSnap.data() as Record<string, unknown>
  if (gd.deletedAt != null) return null
  const name = str(gd, 'name').trim()
  if (!name) return null

  const pd = pSnap.exists ? (pSnap.data() as Record<string, unknown>) : {}
  const parentId = str(gd, 'parentGroupId').trim()
  let parentGroupName: string | null = null
  if (parentId) {
    const parSnap = await adminDb.collection(GROUPS).doc(parentId).get()
    if (parSnap.exists) {
      parentGroupName = str(parSnap.data() as Record<string, unknown>, 'name').trim() || null
    }
  }

  return {
    groupId: gid,
    name,
    handle: handleForDisplayGroup(gd),
    bio: str(gd, 'bio').trim() || null,
    joinPolicy: joinPolicyFromData(gd),
    groupType: groupTypeFromData(gd),
    photoUrl: pickGroupPhotoUrl(gd, pd),
    country: str(gd, 'country').trim() || null,
    region: str(gd, 'region').trim() || null,
    city: str(gd, 'city').trim() || null,
    parentGroupId: parentId || null,
    parentGroupName,
  }
}

/**
 * Hub profile card for dialogs: pending invite, hub owner, active member, or
 * public/restricted join policy (same discoverability rule as hub search).
 * Private hubs stay hidden unless the viewer is owner, member, or has a pending invite.
 */
export async function loadGroupInvitePublicView(
  viewerUserId: string,
  groupId: string,
): Promise<GroupInvitePublicView | null> {
  if (!adminDb) return null
  const uid = viewerUserId.trim()
  const gid = groupId.trim()
  if (!uid || !gid) return null

  const inviteRef = adminDb.collection(GROUPS).doc(gid).collection('invites').doc(uid)
  const gRef = adminDb.collection(GROUPS).doc(gid)
  const pRef = adminDb.collection(PUBLIC_GROUP_PROFILES).doc(gid)
  const [invSnap, gSnap, pSnap] = await adminDb.getAll(inviteRef, gRef, pRef)

  if (!gSnap.exists) return null
  const gd = gSnap.data() as Record<string, unknown>
  if (gd.deletedAt != null) return null

  const inv = invSnap.exists ? (invSnap.data() as Record<string, unknown>) : null
  const hasPendingInvite =
    inv != null &&
    (str(inv, 'status').trim() || 'pending') === 'pending' &&
    (!str(inv, 'userId').trim() || str(inv, 'userId').trim() === uid)

  if (hasPendingInvite) {
    return buildGroupInvitePublicViewFromGroupSnaps(gid, gSnap, pSnap)
  }

  if (str(gd, 'ownerUserId').trim() === uid) {
    return buildGroupInvitePublicViewFromGroupSnaps(gid, gSnap, pSnap)
  }

  if (await isUserMemberOfGroup(gid, uid)) {
    return buildGroupInvitePublicViewFromGroupSnaps(gid, gSnap, pSnap)
  }

  const jp = joinPolicyFromData(gd)
  if (jp === 'public' || jp === 'restricted') {
    return buildGroupInvitePublicViewFromGroupSnaps(gid, gSnap, pSnap)
  }

  return null
}

export class RespondGroupInviteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'RespondGroupInviteError'
  }
}

/** Accept: add active member doc and delete pending invite. */
export async function acceptPendingHubInvite(inviteeUserId: string, groupId: string): Promise<void> {
  if (!adminDb) throw new RespondGroupInviteError('Database not configured', 503)
  const uid = inviteeUserId.trim()
  const gid = groupId.trim()
  if (!uid || !gid) throw new RespondGroupInviteError('Invalid request', 400)

  const inviteRef = adminDb.collection(GROUPS).doc(gid).collection('invites').doc(uid)
  const gRef = adminDb.collection(GROUPS).doc(gid)
  const invSnap = await inviteRef.get()
  if (!invSnap.exists) throw new RespondGroupInviteError('This invitation is no longer available', 404)
  const inv = invSnap.data() as Record<string, unknown>
  if ((str(inv, 'status').trim() || 'pending') !== 'pending') {
    throw new RespondGroupInviteError('This invitation is no longer pending', 409)
  }
  if (str(inv, 'userId').trim() && str(inv, 'userId').trim() !== uid) {
    throw new RespondGroupInviteError('Invalid invitation', 400)
  }

  const gSnap = await gRef.get()
  if (!gSnap.exists) throw new RespondGroupInviteError('Hub not found', 404)
  const gd = gSnap.data() as Record<string, unknown>
  if (gd.deletedAt != null) throw new RespondGroupInviteError('Hub not found', 404)

  if (await isUserMemberOfGroup(gid, uid)) {
    await inviteRef.delete()
    return
  }

  const parentRaw = str(gd, 'parentGroupId').trim()
  if (parentRaw) {
    const inParent = await isUserMemberOfGroup(parentRaw, uid)
    if (!inParent) {
      throw new RespondGroupInviteError(
        'Join the parent hub first before you can accept this sub hub invitation.',
        403,
      )
    }
  }

  const pRef = adminDb.collection(PUBLIC_GROUP_PROFILES).doc(gid)
  const pSnap = await pRef.get()
  const pd = pSnap.exists ? (pSnap.data() as Record<string, unknown>) : {}

  const now = FieldValue.serverTimestamp()
  const mRef = gRef.collection('members').doc(uid)
  const batch = adminDb.batch()
  batch.set(
    mRef,
    {
      userId: uid,
      role: 'member',
      status: 'active',
      updatedAt: now,
      joinedAt: now,
    },
    { merge: true },
  )
  setGroupMembershipIndexForMemberInBatch(batch, {
    memberUserId: uid,
    groupId: gid,
    groupData: gd,
    publicProfileData: pd,
    updatedAt: now,
  })
  const joinPolicy = parseFirestoreJoinPolicy(gd.joinPolicy)
  if (joinPolicy && joinPolicy !== 'public') {
    appendUserJoinGroupFeedItem(batch, gid, uid, now)
  }
  batch.delete(inviteRef)
  await batch.commit()
}

export async function rejectPendingHubInvite(inviteeUserId: string, groupId: string): Promise<void> {
  if (!adminDb) throw new RespondGroupInviteError('Database not configured', 503)
  const uid = inviteeUserId.trim()
  const gid = groupId.trim()
  if (!uid || !gid) throw new RespondGroupInviteError('Invalid request', 400)

  const inviteRef = adminDb.collection(GROUPS).doc(gid).collection('invites').doc(uid)
  const invSnap = await inviteRef.get()
  if (!invSnap.exists) throw new RespondGroupInviteError('This invitation is no longer available', 404)
  const inv = invSnap.data() as Record<string, unknown>
  if ((str(inv, 'status').trim() || 'pending') !== 'pending') {
    throw new RespondGroupInviteError('This invitation is no longer pending', 409)
  }
  if (str(inv, 'userId').trim() && str(inv, 'userId').trim() !== uid) {
    throw new RespondGroupInviteError('Invalid invitation', 400)
  }
  await inviteRef.delete()
}
