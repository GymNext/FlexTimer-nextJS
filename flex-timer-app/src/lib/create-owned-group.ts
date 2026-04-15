import { randomUUID } from 'node:crypto'
import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import type { AppGroupJoinPolicy, AppGroupType } from '@/types/group'
import {
  groupHandleDisplayForStore,
  normalizedGroupNameSearchKey,
  normalizeGroupHandleKey,
  stripAtPrefix,
  subgroupInternalHandleKey,
} from '@/lib/group-handle'

const GROUPS_COLLECTION = 'groups'
const PUBLIC_GROUP_PROFILES = 'publicGroupProfiles'
const GROUP_HANDLE_INDEX = 'groupHandleIndex'
/** Hub activity under `groups/{groupId}/feed` (iOS `actionType: createGroup`, …). */
const GROUP_FEED_SUBCOLLECTION = 'feed'

export type CreateOwnedGroupParams = {
  ownerUserId: string
  groupType: AppGroupType
  name: string
  /** Raw handle input (normalized server-side). Omitted for sub hubs (no public handle). */
  handleInput?: string
  bio: string | null
  joinPolicy: AppGroupJoinPolicy
  country: string | null
  region: string | null
  city: string | null
  /** When set, creates a subgroup under this owned group id (also written to `publicGroupProfiles`). */
  parentGroupId?: string | null
  /** When true (default false), non-owner members may share library content for private/restricted hubs. Ignored for public. */
  membersMayShareContent?: boolean
  organizationTypeId?: string | null
  gymTypeId?: string | null
  trainingModeId?: string | null
  brandId?: string | null
  sportId?: string | null
  levelId?: string | null
  competitionDisciplineId?: string | null
  circleTypeId?: string | null
  startDate?: Date | null
  endDate?: Date | null
}

function trimOrNull(s: string | null | undefined): string | null {
  if (s == null) return null
  const t = s.trim()
  return t || null
}

/**
 * Creates an owned hub: `groups/{id}`, `publicGroupProfiles/{id}`,
 * `groupHandleIndex/{handleKey}` (root hubs only), `groups/{id}/members/{owner}`.
 * Root hubs omit `parentGroupId`; subgroups set it on both `groups` and `publicGroupProfiles`.
 * Sub hubs have no public handle and are not written to `groupHandleIndex`.
 * Matches iOS `upsertGroup` shape.
 */
export async function createOwnedGroup(params: CreateOwnedGroupParams): Promise<{ groupId: string }> {
  if (!adminDb) throw new Error('Database not configured')

  const name = params.name.trim()
  if (!name) throw new Error('Name is required')

  const parentGroupId = trimOrNull(params.parentGroupId ?? null)
  const isSubgroup = Boolean(parentGroupId)

  const groupId = randomUUID()
  const now = FieldValue.serverTimestamp()
  const nameSearch = normalizedGroupNameSearchKey(name)

  let handleKey: string
  let handleForStore: string
  let idxRef: DocumentReference | null = null

  if (isSubgroup) {
    handleKey = subgroupInternalHandleKey(groupId)
    handleForStore = ''
  } else {
    const handleKeyNorm = normalizeGroupHandleKey(params.handleInput ?? '')
    if (!handleKeyNorm) throw new Error('Invalid handle')
    handleKey = handleKeyNorm
    const strippedDisplay = stripAtPrefix(params.handleInput ?? '')
    handleForStore = groupHandleDisplayForStore(strippedDisplay, handleKey)
    idxRef = adminDb.collection(GROUP_HANDLE_INDEX).doc(handleKey)
    const idxSnap = await idxRef.get()
    if (idxSnap.exists) {
      throw new Error('That handle is already taken')
    }
  }

  const bio = trimOrNull(params.bio)
  const country = trimOrNull(params.country)
  const region = trimOrNull(params.region)
  const city = trimOrNull(params.city)

  const membersMayShareStored =
    params.joinPolicy === 'public' ? false : Boolean(params.membersMayShareContent)

  const groupData: Record<string, unknown> = {
    groupId,
    ownerUserId: params.ownerUserId,
    groupType: params.groupType,
    joinPolicy: params.joinPolicy,
    handle: handleForStore,
    handleKey,
    name,
    membersMayShareContent: membersMayShareStored,
    updatedAt: now,
  }

  if (parentGroupId) groupData.parentGroupId = parentGroupId

  if (bio) groupData.bio = bio
  if (country) groupData.country = country
  if (region) groupData.region = region
  if (city) groupData.city = city

  const orgType = trimOrNull(params.organizationTypeId)
  const gymType = trimOrNull(params.gymTypeId)
  const trainingMode = trimOrNull(params.trainingModeId)
  const brand = trimOrNull(params.brandId)
  const sport = trimOrNull(params.sportId)
  const level = trimOrNull(params.levelId)
  const discipline = trimOrNull(params.competitionDisciplineId)
  const circleType = trimOrNull(params.circleTypeId)

  if (params.groupType === 'gym') {
    if (gymType) groupData.gymTypeId = gymType
    if (trainingMode) groupData.trainingModeId = trainingMode
    if (brand) groupData.brandId = brand
  } else if (params.groupType === 'class') {
    if (trainingMode) groupData.trainingModeId = trainingMode
  } else if (params.groupType === 'organization') {
    if (orgType) groupData.organizationTypeId = orgType
  } else if (params.groupType === 'team') {
    if (sport) groupData.sportId = sport
    if (level) groupData.levelId = level
  } else if (params.groupType === 'event' || params.groupType === 'series') {
    if (params.startDate) groupData.startDate = Timestamp.fromDate(params.startDate)
    if (params.endDate) groupData.endDate = Timestamp.fromDate(params.endDate)
    if (discipline) groupData.competitionDisciplineId = discipline
  } else if (params.groupType === 'circle') {
    if (circleType) groupData.circleTypeId = circleType
  }

  const profileData: Record<string, unknown> = {
    groupId,
    ownerUserId: params.ownerUserId,
    groupType: params.groupType,
    joinPolicy: params.joinPolicy,
    parentGroupId: parentGroupId ?? null,
    name,
    nameSearch: nameSearch ?? null,
    handle: handleForStore,
    handleKey,
    membersMayShareContent: membersMayShareStored,
    updatedAt: now,
  }

  if (bio) profileData.bio = bio
  if (country) profileData.country = country
  if (region) profileData.region = region
  if (city) profileData.city = city

  if (params.groupType === 'gym') {
    if (gymType) profileData.gymTypeId = gymType
    if (trainingMode) profileData.trainingModeId = trainingMode
    if (brand) profileData.brandId = brand
  } else if (params.groupType === 'class') {
    if (trainingMode) profileData.trainingModeId = trainingMode
  } else if (params.groupType === 'organization') {
    if (orgType) profileData.organizationTypeId = orgType
  } else if (params.groupType === 'team') {
    if (sport) profileData.sportId = sport
    if (level) profileData.levelId = level
  } else if (params.groupType === 'event' || params.groupType === 'series') {
    if (params.startDate) profileData.startDate = Timestamp.fromDate(params.startDate)
    if (params.endDate) profileData.endDate = Timestamp.fromDate(params.endDate)
    if (discipline) profileData.competitionDisciplineId = discipline
  } else if (params.groupType === 'circle') {
    if (circleType) profileData.circleTypeId = circleType
  }

  const gRef = adminDb.collection(GROUPS_COLLECTION).doc(groupId)
  const pRef = adminDb.collection(PUBLIC_GROUP_PROFILES).doc(groupId)
  const mRef = gRef.collection('members').doc(params.ownerUserId)

  const batch = adminDb.batch()
  batch.set(gRef, groupData, { merge: true })
  batch.set(pRef, profileData, { merge: true })
  if (idxRef) {
    const indexData: Record<string, unknown> = {
      groupId,
      ownerUserId: params.ownerUserId,
      handleKey,
      handle: handleForStore,
      updatedAt: now,
    }
    batch.set(idxRef, indexData, { merge: true })
  }
  batch.set(
    mRef,
    {
      userId: params.ownerUserId,
      role: 'owner',
      status: 'active',
      updatedAt: now,
      joinedAt: now,
    },
    { merge: true }
  )

  const groupFeedRef = gRef.collection(GROUP_FEED_SUBCOLLECTION).doc()
  batch.set(groupFeedRef, {
    actionType: 'createGroup',
    actorUserId: params.ownerUserId,
    createdAt: now,
    groupId,
    objectId: groupId,
  })

  await batch.commit()
  return { groupId }
}
