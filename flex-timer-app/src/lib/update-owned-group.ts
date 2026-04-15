import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import { refreshGroupMembershipIndexShareSettings } from '@/lib/group-invite'
import { isAppGroupType, type AppGroupJoinPolicy, type AppGroupType } from '@/types/group'
import {
  groupHandleDisplayForStore,
  normalizedGroupNameSearchKey,
  normalizeGroupHandleKey,
  stripAtPrefix,
} from '@/lib/group-handle'

const GROUPS_COLLECTION = 'groups'
const PUBLIC_GROUP_PROFILES = 'publicGroupProfiles'
const GROUP_HANDLE_INDEX = 'groupHandleIndex'

const TYPE_OPTIONAL_KEYS = [
  'organizationTypeId',
  'gymTypeId',
  'trainingModeId',
  'brandId',
  'sportId',
  'levelId',
  'competitionDisciplineId',
  'circleTypeId',
  'startDate',
  'endDate',
] as const

function trimOrNull(s: string | null | undefined): string | null {
  if (s == null) return null
  const t = s.trim()
  return t || null
}

function boolish(d: Record<string, unknown>, key: string): boolean {
  const v = d[key]
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  return false
}

function keysUsedByGroupType(gt: AppGroupType): Set<string> {
  switch (gt) {
    case 'organization':
      return new Set<string>(['organizationTypeId'])
    case 'gym':
      return new Set(['gymTypeId', 'trainingModeId', 'brandId'])
    case 'class':
      return new Set(['trainingModeId'])
    case 'team':
      return new Set(['sportId', 'levelId'])
    case 'series':
    case 'event':
      return new Set(['startDate', 'endDate', 'competitionDisciplineId'])
    case 'circle':
      return new Set(['circleTypeId'])
    default:
      return new Set()
  }
}

function applyTypeSpecific(
  groupType: AppGroupType,
  params: {
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
  },
  target: Record<string, unknown>,
) {
  const orgType = trimOrNull(params.organizationTypeId)
  const gymType = trimOrNull(params.gymTypeId)
  const trainingMode = trimOrNull(params.trainingModeId)
  const brand = trimOrNull(params.brandId)
  const sport = trimOrNull(params.sportId)
  const level = trimOrNull(params.levelId)
  const discipline = trimOrNull(params.competitionDisciplineId)
  const circleType = trimOrNull(params.circleTypeId)

  if (groupType === 'gym') {
    target.gymTypeId = gymType ?? FieldValue.delete()
    target.trainingModeId = trainingMode ?? FieldValue.delete()
    target.brandId = brand ?? FieldValue.delete()
  } else if (groupType === 'class') {
    target.trainingModeId = trainingMode ?? FieldValue.delete()
  } else if (groupType === 'organization') {
    target.organizationTypeId = orgType ?? FieldValue.delete()
  } else if (groupType === 'team') {
    target.sportId = sport ?? FieldValue.delete()
    target.levelId = level ?? FieldValue.delete()
  } else if (groupType === 'event' || groupType === 'series') {
    target.competitionDisciplineId = discipline ?? FieldValue.delete()
    target.startDate =
      params.startDate != null ? Timestamp.fromDate(params.startDate) : FieldValue.delete()
    target.endDate =
      params.endDate != null ? Timestamp.fromDate(params.endDate) : FieldValue.delete()
  } else if (groupType === 'circle') {
    target.circleTypeId = circleType ?? FieldValue.delete()
  }
}

export type UpdateOwnedGroupParams = {
  ownerUserId: string
  groupId: string
  name: string
  /** When omitted, existing handle and handle index are left unchanged. */
  handleInput?: string
  bio: string | null
  joinPolicy: AppGroupJoinPolicy
  country: string | null
  region: string | null
  city: string | null
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
  /** When set, updates `membersMayShareContent` on `groups` + `publicGroupProfiles` (forced false when join policy is public). */
  membersMayShareContent?: boolean
}

export async function updateOwnedGroup(params: UpdateOwnedGroupParams): Promise<void> {
  if (!adminDb) throw new Error('Database not configured')

  const gRef = adminDb.collection(GROUPS_COLLECTION).doc(params.groupId)
  const pRef = adminDb.collection(PUBLIC_GROUP_PROFILES).doc(params.groupId)
  const [snap, pSnap] = await adminDb.getAll(gRef, pRef)
  if (!snap.exists) throw new Error('Hub not found')
  const d = snap.data() as Record<string, unknown>
  const pd = pSnap.exists ? (pSnap.data() as Record<string, unknown>) : {}
  if (d.deletedAt != null) throw new Error('Hub is not available')
  if (d.ownerUserId !== params.ownerUserId) throw new Error('You do not own this hub')

  const parentRaw = d.parentGroupId
  const hasParent =
    typeof parentRaw === 'string' && parentRaw.trim() !== '' ? true : false
  if (hasParent && params.handleInput !== undefined) {
    throw new Error('Sub hubs do not use public handles')
  }

  const gtRaw = d.groupType
  if (typeof gtRaw !== 'string' || !isAppGroupType(gtRaw)) throw new Error('Invalid hub type')
  const groupType = gtRaw

  const name = params.name.trim()
  if (!name) throw new Error('Name is required')

  const updateHandle = params.handleInput !== undefined

  const oldHandleKey =
    typeof d.handleKey === 'string' && d.handleKey.trim() !== '' ? d.handleKey.trim() : null
  if (!oldHandleKey) throw new Error('Hub is missing handle data')

  let newHandleKey: string | undefined
  let newHandleForStore: string | undefined
  if (updateHandle) {
    const hk = normalizeGroupHandleKey(params.handleInput!)
    if (!hk) throw new Error('Invalid handle')
    newHandleKey = hk
    const strippedDisplay = stripAtPrefix(params.handleInput!)
    newHandleForStore = groupHandleDisplayForStore(strippedDisplay, hk)

    const idxRefNew = adminDb.collection(GROUP_HANDLE_INDEX).doc(hk)
    if (hk !== oldHandleKey) {
      const idxSnap = await idxRefNew.get()
      if (idxSnap.exists) {
        const existing = idxSnap.data() as Record<string, unknown>
        const gid = existing.groupId
        if (typeof gid === 'string' && gid !== params.groupId) {
          throw new Error('That handle is already taken')
        }
      }
    }
  }

  const bio = trimOrNull(params.bio)
  const country = trimOrNull(params.country)
  const region = trimOrNull(params.region)
  const city = trimOrNull(params.city)

  const now = FieldValue.serverTimestamp()
  const nameSearch = normalizedGroupNameSearchKey(name)

  const groupData: Record<string, unknown> = {
    name,
    joinPolicy: params.joinPolicy,
    updatedAt: now,
  }
  if (newHandleKey !== undefined && newHandleForStore !== undefined) {
    groupData.handle = newHandleForStore
    groupData.handleKey = newHandleKey
  }
  groupData.bio = bio ?? FieldValue.delete()
  groupData.country = country ?? FieldValue.delete()
  groupData.region = region ?? FieldValue.delete()
  groupData.city = city ?? FieldValue.delete()

  const used = keysUsedByGroupType(groupType)
  for (const k of TYPE_OPTIONAL_KEYS) {
    if (!used.has(k)) {
      groupData[k] = FieldValue.delete()
    }
  }
  applyTypeSpecific(groupType, params, groupData)

  const profileData: Record<string, unknown> = {
    name,
    nameSearch: nameSearch ?? null,
    joinPolicy: params.joinPolicy,
    updatedAt: now,
  }
  if (newHandleKey !== undefined && newHandleForStore !== undefined) {
    profileData.handle = newHandleForStore
    profileData.handleKey = newHandleKey
  }
  profileData.bio = bio ?? FieldValue.delete()
  profileData.country = country ?? FieldValue.delete()
  profileData.region = region ?? FieldValue.delete()
  profileData.city = city ?? FieldValue.delete()

  for (const k of TYPE_OPTIONAL_KEYS) {
    if (!used.has(k)) {
      profileData[k] = FieldValue.delete()
    }
  }
  applyTypeSpecific(groupType, params, profileData)

  if (params.joinPolicy === 'public') {
    groupData.membersMayShareContent = false
    profileData.membersMayShareContent = false
  } else if (params.membersMayShareContent !== undefined) {
    groupData.membersMayShareContent = Boolean(params.membersMayShareContent)
    profileData.membersMayShareContent = Boolean(params.membersMayShareContent)
  }

  const rawForIndex =
    params.joinPolicy === 'public'
      ? false
      : params.membersMayShareContent !== undefined
        ? Boolean(params.membersMayShareContent)
        : boolish(d, 'membersMayShareContent') || boolish(pd, 'membersMayShareContent')
  const effectiveIndex = params.joinPolicy === 'public' ? false : rawForIndex

  const batch = adminDb.batch()
  batch.set(gRef, groupData, { merge: true })
  batch.set(pRef, profileData, { merge: true })

  if (
    newHandleKey !== undefined &&
    newHandleForStore !== undefined &&
    newHandleKey !== oldHandleKey
  ) {
    const idxRefNew = adminDb.collection(GROUP_HANDLE_INDEX).doc(newHandleKey)
    batch.delete(adminDb.collection(GROUP_HANDLE_INDEX).doc(oldHandleKey))
    batch.set(idxRefNew, {
      groupId: params.groupId,
      ownerUserId: params.ownerUserId,
      handleKey: newHandleKey,
      handle: newHandleForStore,
      updatedAt: now,
    })
  }

  await batch.commit()

  await refreshGroupMembershipIndexShareSettings({
    groupId: params.groupId,
    ownerUserId: params.ownerUserId,
    joinPolicy: params.joinPolicy,
    effectiveMembersMayShareContent: effectiveIndex,
  })
}

export async function changeOwnedGroupHandle(params: {
  ownerUserId: string
  groupId: string
  handleInput: string
}): Promise<void> {
  if (!adminDb) throw new Error('Database not configured')

  const gRef = adminDb.collection(GROUPS_COLLECTION).doc(params.groupId)
  const snap = await gRef.get()
  if (!snap.exists) throw new Error('Hub not found')
  const d = snap.data() as Record<string, unknown>
  if (d.deletedAt != null) throw new Error('Hub is not available')
  if (d.ownerUserId !== params.ownerUserId) throw new Error('You do not own this hub')

  const parentRaw = d.parentGroupId
  if (typeof parentRaw === 'string' && parentRaw.trim() !== '') {
    throw new Error('Sub hubs do not use public handles')
  }

  const oldHandleKey =
    typeof d.handleKey === 'string' && d.handleKey.trim() !== '' ? d.handleKey.trim() : null
  if (!oldHandleKey) throw new Error('Hub is missing handle data')

  const handleKey = normalizeGroupHandleKey(params.handleInput)
  if (!handleKey) throw new Error('Invalid handle')
  const strippedDisplay = stripAtPrefix(params.handleInput)
  const handleForStore = groupHandleDisplayForStore(strippedDisplay, handleKey)

  const now = FieldValue.serverTimestamp()
  const idxRefNew = adminDb.collection(GROUP_HANDLE_INDEX).doc(handleKey)
  if (handleKey !== oldHandleKey) {
    const idxSnap = await idxRefNew.get()
    if (idxSnap.exists) {
      const existing = idxSnap.data() as Record<string, unknown>
      const gid = existing.groupId
      if (typeof gid === 'string' && gid !== params.groupId) {
        throw new Error('That handle is already taken')
      }
    }
  }

  const batch = adminDb.batch()
  batch.set(
    gRef,
    {
      handle: handleForStore,
      handleKey,
      updatedAt: now,
    },
    { merge: true },
  )
  batch.set(
    adminDb.collection(PUBLIC_GROUP_PROFILES).doc(params.groupId),
    {
      handle: handleForStore,
      handleKey,
      updatedAt: now,
    },
    { merge: true },
  )

  if (handleKey !== oldHandleKey) {
    batch.delete(adminDb.collection(GROUP_HANDLE_INDEX).doc(oldHandleKey))
    batch.set(idxRefNew, {
      groupId: params.groupId,
      ownerUserId: params.ownerUserId,
      handleKey,
      handle: handleForStore,
      updatedAt: now,
    })
  }

  await batch.commit()
}
