import type { DocumentReference } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import { isAppGroupType, parseFirestoreJoinPolicy, type AppGroupJoinPolicy, type AppGroupType } from '@/types/group'
import { stripAtPrefix } from '@/lib/group-handle'

const GROUPS = 'groups'
const PUBLIC_GROUP_PROFILES = 'publicGroupProfiles'

function isGroupsDocRef(ref: DocumentReference): boolean {
  return ref.parent?.id === GROUPS
}

/**
 * Member docs: `groups/{groupId}/members/{userId}` with a `userId` field (iOS / create-owned-group).
 * Collection-group `FieldPath.documentId() == uid` is invalid here: Firestore requires a full path
 * (even segment count), not a bare uid. So we filter on `userId` and enable COLLECTION_GROUP via
 * `firestore.indexes.json` fieldOverrides for `members.userId`.
 */
export async function listActiveMembershipGroupIds(userId: string): Promise<string[]> {
  if (!adminDb) return []
  const snap = await adminDb.collectionGroup('members').where('userId', '==', userId).get()
  const ids = new Set<string>()
  for (const doc of snap.docs) {
    const groupRef = doc.ref.parent?.parent
    if (!groupRef || !isGroupsDocRef(groupRef)) continue
    if (doc.id !== userId) continue
    const st = (doc.data() as Record<string, unknown>).status
    if (typeof st === 'string' && st !== 'active') continue
    ids.add(groupRef.id)
  }
  return [...ids]
}

function deleted(d: Record<string, unknown>): boolean {
  return d.deletedAt != null
}

export function pickGroupPhotoUrl(...sources: Record<string, unknown>[]): string | null {
  const keys = [
    'profilePhotoUrl',
    'profileImageUrl',
    'photoURL',
    'photoUrl',
    'imageUrl',
    'avatarUrl',
    'coverImageUrl',
    'bannerImageUrl',
  ]
  for (const obj of sources) {
    for (const k of keys) {
      const v = obj[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
  }
  return null
}

function str(d: Record<string, unknown>, key: string): string {
  const v = d[key]
  return typeof v === 'string' ? v : ''
}

export type MembershipGroupListItem = {
  groupId: string
  name: string
  groupType: AppGroupType | null
  /** Public handle for top-level hubs only (`null` for sub-hubs under a parent). */
  handle: string | null
  joinPolicy: AppGroupJoinPolicy
  /** Whether non-owner members may share library items to the hub (`groups` + `publicGroupProfiles`). */
  membersMayShareContent: boolean
}

export type MembershipGroupDetail = MembershipGroupListItem & {
  bio: string | null
  country: string | null
  region: string | null
  city: string | null
  photoUrl: string | null
  memberRole: string | null
  /** Group document `ownerUserId` (for hub owner card when member list is empty, e.g. public hubs). */
  ownerUserId: string | null
}

function joinPolicyFromData(d: Record<string, unknown>): AppGroupJoinPolicy {
  return parseFirestoreJoinPolicy(d.joinPolicy) ?? 'private'
}

/** Same semantics as membership index (`group-invite`): public hubs never get member share. */
function boolishField(d: Record<string, unknown>, key: string): boolean {
  const v = d[key]
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  return false
}

/** Effective member-share flag (public hubs always false). Used by GET hub and membership detail. */
export function membersMayShareContentFromGroupDocs(
  groupDoc: Record<string, unknown>,
  publicProfileDoc: Record<string, unknown>,
): boolean {
  if (joinPolicyFromData(groupDoc) === 'public') return false
  return (
    boolishField(publicProfileDoc, 'membersMayShareContent') ||
    boolishField(groupDoc, 'membersMayShareContent')
  )
}

function groupTypeFromData(d: Record<string, unknown>): AppGroupType | null {
  const gt = str(d, 'groupType').trim()
  return gt && isAppGroupType(gt) ? gt : null
}

function handleForDisplay(groupDoc: Record<string, unknown>): string | null {
  if (str(groupDoc, 'parentGroupId').trim()) return null
  const raw = str(groupDoc, 'handle').trim()
  if (!raw) return null
  const display = stripAtPrefix(raw.startsWith('@') ? raw : `@${raw}`)
  return display || null
}

/** Load list rows for the memberships sidebar (skips deleted groups). */
export async function loadMembershipListItems(
  groupIds: string[],
  options?: { excludeOwnerUserId?: string },
): Promise<MembershipGroupListItem[]> {
  const db = adminDb
  if (!db || groupIds.length === 0) return []
  const excludeOwner = options?.excludeOwnerUserId?.trim() || ''
  const out: MembershipGroupListItem[] = []
  for (let i = 0; i < groupIds.length; i += 10) {
    const slice = groupIds.slice(i, i + 10)
    const gRefs = slice.map((id) => db.collection(GROUPS).doc(id))
    const pRefs = slice.map((id) => db.collection(PUBLIC_GROUP_PROFILES).doc(id))
    const [gSnaps, pSnaps] = await Promise.all([db.getAll(...gRefs), db.getAll(...pRefs)])
    for (let j = 0; j < gSnaps.length; j += 1) {
      const snap = gSnaps[j]
      if (!snap.exists) continue
      const d = snap.data() as Record<string, unknown>
      if (deleted(d)) continue
      if (excludeOwner && str(d, 'ownerUserId').trim() === excludeOwner) continue
      const name = str(d, 'name').trim()
      if (!name) continue
      const pSnap = pSnaps[j]
      const pd = pSnap?.exists ? (pSnap.data() as Record<string, unknown>) : {}
      out.push({
        groupId: snap.id,
        name,
        groupType: groupTypeFromData(d),
        handle: handleForDisplay(d),
        joinPolicy: joinPolicyFromData(d),
        membersMayShareContent: membersMayShareContentFromGroupDocs(d, pd),
      })
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return out
}

/** Full detail for one group if it exists and is not deleted (caller must verify membership). */
export async function loadMembershipGroupDetail(
  groupId: string,
  memberRole: string | null,
): Promise<MembershipGroupDetail | null> {
  if (!adminDb) return null
  const gRef = adminDb.collection(GROUPS).doc(groupId)
  const pRef = adminDb.collection(PUBLIC_GROUP_PROFILES).doc(groupId)
  const [gSnap, pSnap] = await adminDb.getAll(gRef, pRef)
  if (!gSnap.exists) return null
  const gd = gSnap.data() as Record<string, unknown>
  if (deleted(gd)) return null
  const name = str(gd, 'name').trim()
  if (!name) return null
  const pd = pSnap.exists ? (pSnap.data() as Record<string, unknown>) : {}
  const bioRaw = str(gd, 'bio').trim()
  const ownerUserIdRaw = str(gd, 'ownerUserId').trim()
  return {
    groupId: gSnap.id,
    name,
    groupType: groupTypeFromData(gd),
    handle: handleForDisplay(gd),
    joinPolicy: joinPolicyFromData(gd),
    bio: bioRaw || null,
    country: str(gd, 'country').trim() || null,
    region: str(gd, 'region').trim() || null,
    city: str(gd, 'city').trim() || null,
    photoUrl: pickGroupPhotoUrl(gd, pd as Record<string, unknown>),
    memberRole,
    ownerUserId: ownerUserIdRaw || null,
    membersMayShareContent: membersMayShareContentFromGroupDocs(gd, pd as Record<string, unknown>),
  }
}
