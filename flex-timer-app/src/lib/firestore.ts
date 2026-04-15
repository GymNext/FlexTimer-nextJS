import { randomUUID } from 'node:crypto'
import { normalizeBioDisplayText } from '@/lib/format-bio-display'
import { DocumentSnapshot, FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import type { OwnedGroupFlat } from '@/lib/build-owned-hub-tree'
import { isAppGroupType, parseFirestoreJoinPolicy } from '@/types/group'
import { USER_HUB_LOOKUP_ID_KEYS, userHubLookupIdsFromFirestore, type UserHubLookupIds } from '@/types/hub-profile'
import {
  bareWorkoutIdForGroupSharedMirror,
  deleteCollectionUserConnectionMirrors,
  deletePlanUserConnectionMirrors,
  deleteWorkoutHubMirrors,
  deleteWorkoutUserConnectionMirrors,
  syncCollectionUserConnectionMirrors,
  syncPlanShareMirrorsForOwner,
  syncWorkoutHubMirrors,
  syncWorkoutUserConnectionMirrors,
} from '@/lib/user-connection-mirrors'
import {
  purgeWorkoutMirrorsFromCollectionDerivedShares,
  syncCollectionHubWorkoutMirrors,
  syncCollectionUserWorkoutMirrors,
} from '@/lib/workout-collection-share'
import { normalizePlanTrainingIntentFromFirestore } from '@/lib/plan-training-intent'
import {
  addCalendarDays,
  isValidIanaTimeZone,
  pickTimeZoneIdFromRecord,
  utcMillisAtStartOfCalendarDayInTimeZone,
} from '@/lib/planned-workout-day-timestamp'
import { USER_COLLECTIONS, type UserDataCounts, type PlanDay, type PlanDayEntry, type PlannedWorkout, type Workout, type WorkoutCollection, type WorkoutPlan, type WorkoutSegment, type WorkoutType } from '@/types/user'

/** Matches iOS `StorageManager.USER_HANDLE_INDEX_COLLECTION`. */
const USER_HANDLE_INDEX_COLLECTION = 'userHandleIndex'
/** Older web builds; entries removed when handles change. */
const LEGACY_PUBLIC_HANDLE_INDEX_COLLECTION = 'publicHandleIndex'

/** Matches iOS `_normalizeUserHandle` (max length 64). */
const MAX_USER_HANDLE_KEY_LENGTH = 64

export type WorkoutPlanSubscriptionStatus = 'pending' | 'active' | 'blocked'

export interface WorkoutPlanSubscriptionRecord {
  subscriptionDocumentId: string
  subscriberUserId: string
  ownerUserId: string
  remotePlanId: string
  status: WorkoutPlanSubscriptionStatus
  remotePlanName: string | null
  remotePlanHandle: string | null
  /** From planDescriptionSnapshot or other denormalized copy when live plan is unavailable. */
  remotePlanDescription: string | null
  ordinal: number
  subscriberFullName: string | null
  /** Denormalized subscriber display handle (Firestore: subscriberHandle, legacy subscriberPublicHandle). */
  subscriberHandle: string | null
  /** e.g. `groupFeed` when following from hub activity (iOS parity). */
  followSource?: string | null
  /** Hub id the subscriber followed from, when `followSource` is group feed. */
  followContextGroupId?: string | null
  /** Denormalized from share at follow time or owner connection share doc. */
  shareAllowEditing?: boolean
  shareHideFutureWorkouts?: boolean
}

function mapSegmentFromEntry(seg: Record<string, unknown>, index: number, fallbackWorkoutId: string): WorkoutSegment {
  const workoutId = typeof seg.workoutId === 'string' ? seg.workoutId : `${fallbackWorkoutId}-seg-${index}`
  const decodeInt = (key: string, def: number) => {
    const v = seg[key]
    if (typeof v === 'number') return v
    if (typeof v === 'string') { const n = parseInt(v, 10); return Number.isNaN(n) ? def : n }
    return def
  }
  const decodeBool = (key: string, def: boolean) => {
    const v = seg[key]
    if (typeof v === 'boolean') return v
    if (typeof v === 'number') return v !== 0
    return def
  }
  const decodeIntArray = (key: string): number[] => {
    const v = seg[key]
    if (!Array.isArray(v)) return []
    const nums = v.filter((x): x is number => typeof x === 'number')
    if (nums.length > 0) return nums
    return (v as string[]).map((x) => parseInt(String(x), 10)).filter((n) => !Number.isNaN(n))
  }
  return {
    workoutId,
    workoutName: (seg.workoutName as string) ?? null,
    workoutDescription: (seg.workoutDescription as string) ?? null,
    workoutDetails: (seg.workoutDetails as string) ?? null,
    workoutImage: (seg.workoutImage as string) ?? null,
    workoutShareId: (seg.workoutShareId as string) ?? null,
    workoutSchedule: typeof seg.workoutSchedule === 'string' ? seg.workoutSchedule : null,
    prelude: decodeInt('prelude', -1),
    segue: decodeBool('segue', false),
    warnings: decodeIntArray('warnings'),
    metronome: decodeInt('metronome', 0),
    direction: decodeBool('direction', false),
    restDirection: decodeInt('restDirection', 0),
    warningStrategy: decodeInt('warningStrategy', 0),
    continuity: decodeBool('continuity', false),
  }
}

function parseDeletedAt(d: Record<string, unknown>): string | null {
  const deletedAtRaw = d.deletedAt
  if (deletedAtRaw == null) return null
  if (typeof deletedAtRaw === 'string') return deletedAtRaw
  if (typeof deletedAtRaw === 'object' && deletedAtRaw !== null && 'toDate' in deletedAtRaw && typeof (deletedAtRaw as { toDate: () => Date }).toDate === 'function')
    return (deletedAtRaw as { toDate: () => Date }).toDate().toISOString()
  return null
}

function parseTimestamp(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function')
    return (value as { toDate: () => Date }).toDate().toISOString()
  return String(value)
}

function normalizeWorkoutPlanHandle(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  let value = raw.trim().toLowerCase()
  if (value.startsWith('@')) value = value.slice(1)
  if (!value) return null
  if (value.length > 64) return null
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(value)) return null
  return value
}

function mapWorkoutPlanSubscriptionDoc(
  doc: DocumentSnapshot
): WorkoutPlanSubscriptionRecord | null {
  const d = doc.data() as Record<string, unknown> | undefined
  if (!d) return null
  const statusRaw = typeof d.status === 'string' ? d.status : ''
  const status: WorkoutPlanSubscriptionStatus =
    statusRaw === 'active' || statusRaw === 'blocked' ? statusRaw : 'pending'
  const ownerUserId = typeof d.ownerUserId === 'string' ? d.ownerUserId : ''
  const remotePlanId = typeof d.remotePlanId === 'string' ? d.remotePlanId : ''
  const subscriberUserId = typeof d.subscriberUserId === 'string' ? d.subscriberUserId : ''
  if (!ownerUserId || !remotePlanId || !subscriberUserId) return null
  const followSource =
    typeof d.followSource === 'string' && d.followSource.trim() !== '' ? d.followSource.trim() : null
  const followContextGroupId =
    typeof d.followContextGroupId === 'string' && d.followContextGroupId.trim() !== ''
      ? d.followContextGroupId.trim()
      : null
  const shareAllowEditing = typeof d.shareAllowEditing === 'boolean' ? d.shareAllowEditing : undefined
  const shareHideFutureWorkouts =
    typeof d.shareHideFutureWorkouts === 'boolean' ? d.shareHideFutureWorkouts : undefined

  return {
    subscriptionDocumentId: doc.id,
    subscriberUserId,
    ownerUserId,
    remotePlanId,
    status,
    remotePlanName:
      typeof d.remotePlanName === 'string'
        ? d.remotePlanName
        : typeof d.planNameSnapshot === 'string'
          ? d.planNameSnapshot
          : null,
    remotePlanHandle: typeof d.remotePlanHandle === 'string' ? d.remotePlanHandle : null,
    remotePlanDescription:
      typeof d.planDescriptionSnapshot === 'string' && d.planDescriptionSnapshot.trim() !== ''
        ? d.planDescriptionSnapshot.trim()
        : typeof d.remotePlanDescription === 'string' && d.remotePlanDescription.trim() !== ''
          ? d.remotePlanDescription.trim()
          : null,
    ordinal: typeof d.ordinal === 'number' ? d.ordinal : 0,
    subscriberFullName: typeof d.subscriberFullName === 'string' ? d.subscriberFullName : null,
    subscriberHandle:
      typeof d.subscriberHandle === 'string'
        ? d.subscriberHandle
        : typeof d.subscriberPublicHandle === 'string'
          ? d.subscriberPublicHandle
          : null,
    followSource,
    followContextGroupId,
    shareAllowEditing,
    shareHideFutureWorkouts,
  }
}

function isShareablePlanPrivacy(privacy: number | null | undefined): boolean {
  return privacy === 2 || privacy === 3
}

async function syncWorkoutPlanHandleIndex(
  userId: string,
  planId: string,
  workoutPlanName: string,
  previousHandle: string | null | undefined,
  nextHandle: string | null | undefined,
  privacy: number | null | undefined,
  planDeleted: boolean
): Promise<void> {
  if (!adminDb) return
  const indexRef = adminDb.collection('workoutPlanHandleIndex')
  const oldNorm = normalizeWorkoutPlanHandle(previousHandle)
  const newNorm = normalizeWorkoutPlanHandle(nextHandle)
  const shouldIndexNew = !!newNorm && isShareablePlanPrivacy(privacy) && !planDeleted

  if (oldNorm && (!shouldIndexNew || oldNorm !== newNorm)) {
    await indexRef.doc(oldNorm).delete().catch(() => {})
  }

  if (shouldIndexNew && newNorm) {
    await indexRef.doc(newNorm).set(
      {
        ownerUserId: userId,
        planId,
        privacy,
        handleKey: newNorm,
        workoutPlanName: workoutPlanName || null,
        planDeleted: false,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
  }

  // Best-effort cleanup: remove stale duplicate handle-index docs for this plan.
  const staleSnap = await indexRef
    .where('ownerUserId', '==', userId)
    .where('planId', '==', planId)
    .get()
  const cleanupBatch = adminDb.batch()
  staleSnap.docs.forEach((doc) => {
    if (!shouldIndexNew || doc.id !== newNorm) {
      cleanupBatch.delete(doc.ref)
    }
  })
  if (!staleSnap.empty) {
    await cleanupBatch.commit()
  }
}

/** Categories under users/<userId>/meta/ for user settings. */
const USER_META_CATEGORIES = ['AppBehaviour', 'Audio', 'Backup', 'HeartRates', 'Internal', 'MultiPeer', 'TimerDefaults', 'Visual'] as const

function toPlainValue(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function')
    return (value as { toDate: () => Date }).toDate().toISOString()
  if (Array.isArray(value)) return value.map(toPlainValue)
  if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    const o = value as Record<string, unknown>
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toPlainValue(v)]))
  }
  return value
}

function normalizeUserHandleKey(raw: string): string | null {
  let value = raw.trim().toLowerCase()
  if (value.startsWith('@')) value = value.slice(1)
  if (!value) return null
  if (value.length > MAX_USER_HANDLE_KEY_LENGTH) return null
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(value)) return null
  return value
}

function stripUserHandleInput(raw: string): string {
  let v = raw.trim()
  if (v.startsWith('@')) v = v.slice(1)
  return v
}

/** Swift `_userHandleDisplayString` — stored `handle` uses a leading `@`. */
function userHandleDisplayForFirestore(strippedNoAt: string, normalizedKey: string): string {
  const t = strippedNoAt.trim()
  if (t !== '') return t.startsWith('@') ? t : `@${t}`
  return `@${normalizedKey}`
}

/** Swift `_normalizedFullNameSearchKey` on composed display name. */
function normalizedFullNameSearchKey(fullName: string): string | null {
  let s = fullName.trim()
  if (s.startsWith('@')) s = s.slice(1).trim()
  if (!s) return null
  const folded = s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
  const parts = folded.split(/\s+/).filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

function effectiveUserHandleKeyFromUserData(d: Record<string, unknown>): string | null {
  const k = typeof d.handleKey === 'string' ? d.handleKey.trim().toLowerCase() : ''
  if (k) return k
  const h = typeof d.handle === 'string' ? d.handle : null
  if (h) return normalizeUserHandleKey(h)
  const legacy = typeof d.publicHandle === 'string' ? d.publicHandle : null
  return legacy ? normalizeUserHandleKey(legacy) : null
}

function trimmedBioFromUserData(d: Record<string, unknown>): string | null {
  const b = typeof d.bio === 'string' ? d.bio.trim() : ''
  if (b !== '') return normalizeBioDisplayText(b)
  const legacy = typeof d.basicBio === 'string' ? d.basicBio.trim() : ''
  return legacy !== '' ? normalizeBioDisplayText(legacy) : null
}

/**
 * `publicUserProfiles/{userId}` merge payload aligned with iOS `_syncPublicUserProfileAndHandleIndex`.
 */
function publicUserProfileMergePayload(userId: string, d: Record<string, unknown>): Record<string, unknown> {
  const firstName = typeof d.firstName === 'string' ? d.firstName : ''
  const lastName = typeof d.lastName === 'string' ? d.lastName : ''
  const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ')
  const nameSearch = normalizedFullNameSearchKey(fullName)

  const handleKey = effectiveUserHandleKeyFromUserData(d)
  let handle: string | null = null
  if (handleKey) {
    const rawHandle = typeof d.handle === 'string' ? d.handle : ''
    handle = userHandleDisplayForFirestore(stripUserHandleInput(rawHandle), handleKey)
  }

  const bio = trimmedBioFromUserData(d)

  const out: Record<string, unknown> = {
    userId,
    firstName,
    lastName,
    fullName,
    updatedAt: FieldValue.serverTimestamp(),
    fullNameSearch: nameSearch ?? null,
    handleKey: handleKey ?? null,
    handle: handleKey ? handle : null,
    bio: bio ?? null,
    publicHandle: FieldValue.delete(),
  }

  const photo = typeof d.profilePhotoUrl === 'string' ? d.profilePhotoUrl.trim() : ''
  if (photo !== '') out.profilePhotoUrl = photo

  const city = typeof d.city === 'string' ? d.city.trim() : ''
  out.city = city !== '' ? city : FieldValue.delete()

  const region = typeof d.region === 'string' ? d.region.trim() : ''
  out.region = region !== '' ? region : FieldValue.delete()

  const country = typeof d.country === 'string' ? d.country.trim() : ''
  out.country = country !== '' ? country : FieldValue.delete()

  const hubIds = userHubLookupIdsFromFirestore(d)
  for (const key of USER_HUB_LOOKUP_ID_KEYS) {
    out[key] = hubIds[key]
  }

  return out
}

/** User document at users/<userId> (top-level fields). Settings come from users/<userId>/meta/<category>. */
export async function getUserDocument(
  userId: string
): Promise<{
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  handle?: string | null
  handleKey?: string | null
  bio?: string | null
  profilePhotoUrl?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
  hubLookupIds: UserHubLookupIds
  /** From user doc (UserDetails) */
  hasConnectedToDisplay?: boolean
  connectedToDisplayType?: string | null
  /** Optional override; when set, classic eligibility = this. Else derived from effective/expiry dates. */
  classicEligibleOverride?: boolean
  classicEligibleEffectiveDate?: unknown
  classicEligibleExpiryDate?: unknown
  /** User IDs that have been merged into this user (UserDetails). */
  mergedUserIds?: string[]
  settings?: Record<string, unknown>
} | null> {
  if (!adminDb) return null
  const userRef = adminDb.collection('users').doc(userId)
  const [userSnap, ...metaSnaps] = await Promise.all([
    userRef.get(),
    ...USER_META_CATEGORIES.map((cat) => userRef.collection('meta').doc(cat).get()),
  ])
  if (!userSnap.exists) return null
  const d = userSnap.data()! as Record<string, unknown>
  const settings: Record<string, unknown> = {}
  for (const snap of metaSnaps) {
    if (!snap.exists) continue
    const data = snap.data() as Record<string, unknown>
    for (const [key, value] of Object.entries(data)) {
      settings[key] = toPlainValue(value)
    }
  }
  return {
    firstName: typeof d.firstName === 'string' ? d.firstName : null,
    lastName: typeof d.lastName === 'string' ? d.lastName : null,
    email: typeof d.email === 'string' ? d.email : null,
    handle: (() => {
      const h = typeof d.handle === 'string' ? d.handle.trim() : null
      if (h) return h
      const legacy = typeof d.publicHandle === 'string' ? d.publicHandle.trim() : null
      return legacy || null
    })(),
    handleKey: effectiveUserHandleKeyFromUserData(d),
    bio: trimmedBioFromUserData(d),
    profilePhotoUrl:
      typeof d.profilePhotoUrl === 'string' && d.profilePhotoUrl.trim() !== ''
        ? d.profilePhotoUrl.trim()
        : null,
    city: typeof d.city === 'string' && d.city.trim() !== '' ? d.city.trim() : null,
    region: typeof d.region === 'string' && d.region.trim() !== '' ? d.region.trim() : null,
    country: typeof d.country === 'string' && d.country.trim() !== '' ? d.country.trim() : null,
    hasConnectedToDisplay: typeof d.hasConnectedToDisplay === 'boolean' ? d.hasConnectedToDisplay : undefined,
    connectedToDisplayType: typeof d.connectedToDisplayType === 'string' ? d.connectedToDisplayType : null,
    classicEligibleOverride: typeof d.classicEligibleOverride === 'boolean' ? d.classicEligibleOverride : undefined,
    classicEligibleEffectiveDate: d.classicEligibleEffectiveDate,
    classicEligibleExpiryDate: d.classicEligibleExpiryDate,
    mergedUserIds: Array.isArray(d.mergedUserIds)
      ? (d.mergedUserIds as unknown[]).filter((id): id is string => typeof id === 'string')
      : undefined,
    settings: Object.keys(settings).length > 0 ? settings : undefined,
    hubLookupIds: userHubLookupIdsFromFirestore(d),
  }
}

export type UserProfileFieldUpdates = {
  bio?: string | null
  firstName?: string | null
  lastName?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
} & Partial<UserHubLookupIds>

export async function updateUserProfileFields(
  userId: string,
  updates: UserProfileFieldUpdates,
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const patch: Record<string, unknown> = {}
  if ('bio' in updates) {
    patch.bio =
      updates.bio != null && updates.bio.trim() !== '' ? updates.bio.trim() : null
    patch.basicBio = FieldValue.delete()
  }
  if ('firstName' in updates) {
    patch.firstName =
      updates.firstName != null && updates.firstName.trim() !== ''
        ? updates.firstName.trim()
        : null
  }
  if ('lastName' in updates) {
    patch.lastName =
      updates.lastName != null && updates.lastName.trim() !== '' ? updates.lastName.trim() : null
  }
  if ('city' in updates) {
    patch.city = updates.city != null && updates.city.trim() !== '' ? updates.city.trim() : null
  }
  if ('region' in updates) {
    patch.region =
      updates.region != null && updates.region.trim() !== '' ? updates.region.trim() : null
  }
  if ('country' in updates) {
    patch.country =
      updates.country != null && updates.country.trim() !== '' ? updates.country.trim() : null
  }
  for (const key of USER_HUB_LOOKUP_ID_KEYS) {
    if (!(key in updates)) continue
    const v = updates[key]
    patch[key] = v != null && String(v).trim() !== '' ? String(v).trim() : null
  }
  if (Object.keys(patch).length === 0) return
  await adminDb.collection('users').doc(userId).update(patch)
  await syncPublicUserProfileFromUserDocument(userId)
}

/** Rewrites `publicUserProfiles/{userId}` from the current `users/{userId}` document (iOS parity). */
export async function syncPublicUserProfileFromUserDocument(userId: string): Promise<void> {
  if (!adminDb) return
  const snap = await adminDb.collection('users').doc(userId).get()
  if (!snap.exists) return
  const d = snap.data() as Record<string, unknown>
  await adminDb
    .collection('publicUserProfiles')
    .doc(userId)
    .set(publicUserProfileMergePayload(userId, d), { merge: true })
}

export async function updateUserPublicHandle(userId: string, rawHandle: string | null): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const trimmed = rawHandle == null ? '' : rawHandle.trim()
  const normalized = trimmed === '' ? null : normalizeUserHandleKey(rawHandle!)
  const handleRuleErr = `Handle must be 1-${MAX_USER_HANDLE_KEY_LENGTH} characters and use letters, numbers, ".", "_" or "-"`
  if (trimmed !== '' && normalized == null) {
    throw new Error(handleRuleErr)
  }
  const strippedForDisplay = trimmed === '' ? '' : stripUserHandleInput(rawHandle!)
  if (normalized && strippedForDisplay !== '' && normalizeUserHandleKey(strippedForDisplay) !== normalized) {
    throw new Error(handleRuleErr)
  }

  const displayWithAt = normalized == null ? null : userHandleDisplayForFirestore(strippedForDisplay, normalized)

  const usersRef = adminDb.collection('users').doc(userId)
  const userHandleIndex = adminDb.collection(USER_HANDLE_INDEX_COLLECTION)
  const legacyHandleIndex = adminDb.collection(LEGACY_PUBLIC_HANDLE_INDEX_COLLECTION)
  const publicProfileRef = adminDb.collection('publicUserProfiles').doc(userId)

  const userSnap = await usersRef.get()
  const userData = (userSnap.data() as Record<string, unknown> | undefined) ?? {}
  const previousKey = effectiveUserHandleKeyFromUserData(userData)

  const mergedForProfile: Record<string, unknown> = {
    ...userData,
    handle: displayWithAt,
    handleKey: normalized,
  }
  delete mergedForProfile.publicHandle
  const profilePayload = publicUserProfileMergePayload(userId, mergedForProfile)

  await adminDb.runTransaction(async (tx) => {
    if (normalized) {
      const newRef = userHandleIndex.doc(normalized)
      const legRef = legacyHandleIndex.doc(normalized)
      const [snNew, snLeg] = await Promise.all([tx.get(newRef), tx.get(legRef)])
      for (const snap of [snNew, snLeg]) {
        if (!snap.exists) continue
        const ownerUserId = snap.get('ownerUserId')
        if (typeof ownerUserId === 'string' && ownerUserId !== userId) {
          throw new Error('That handle is already taken')
        }
      }
      tx.set(
        newRef,
        {
          ownerUserId: userId,
          handleKey: normalized,
          handle: displayWithAt,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
      if (snLeg.exists) {
        const legOwner = snLeg.get('ownerUserId')
        if (legOwner == null || legOwner === userId) {
          tx.delete(legRef)
        }
      }
    }

    tx.update(usersRef, {
      handle: displayWithAt,
      handleKey: normalized,
      publicHandle: FieldValue.delete(),
    })
    tx.set(publicProfileRef, profilePayload, { merge: true })

    if (previousKey && previousKey !== normalized) {
      tx.delete(userHandleIndex.doc(previousKey))
      tx.delete(legacyHandleIndex.doc(previousKey))
    }
  })
}

export async function getUserDataCounts(userId: string): Promise<UserDataCounts> {
  if (!adminDb) {
    return { workouts: 0, workoutCollections: 0, workoutPlans: 0 }
  }
  const userRef = adminDb.collection('users').doc(userId)
  const [workouts, workoutCollections, workoutPlans] = await Promise.all([
    userRef.collection(USER_COLLECTIONS.workouts).count().get(),
    userRef.collection(USER_COLLECTIONS.workoutCollections).count().get(),
    userRef.collection(USER_COLLECTIONS.workoutPlans).count().get(),
  ])
  return {
    workouts: workouts.data().count,
    workoutCollections: workoutCollections.data().count,
    workoutPlans: workoutPlans.data().count,
  }
}

/** Firestore `showInSchedule`: when false, plan is hidden from Today; missing/legacy treated as true. */
function normalizePlanShowInScheduleFromFirestore(raw: unknown): boolean | null {
  if (raw === false) return false
  if (raw === true) return true
  return null
}

export async function getUserWorkoutPlans(userId: string): Promise<WorkoutPlan[]> {
  if (!adminDb) return []
  const snapshot = await adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutPlans)
    .get()
  const plans = snapshot.docs.map((doc) => {
    const d = doc.data()
    return {
      id: doc.id,
      isPersonal: d.isPersonal === true,
      ordinal: typeof d.ordinal === 'number' ? d.ordinal : 0,
      userId: typeof d.userId === 'string' ? d.userId : '',
      workoutPlanDescription: d.workoutPlanDescription ?? null,
      workoutPlanId: typeof d.workoutPlanId === 'string' ? d.workoutPlanId : '',
      workoutPlanName: typeof d.workoutPlanName === 'string' ? d.workoutPlanName : '',
      trainingIntent: normalizePlanTrainingIntentFromFirestore(d.trainingIntent),
      privacy: typeof d.privacy === 'number' ? d.privacy : null,
      handle: typeof d.handle === 'string' ? d.handle : null,
      deletedAt: parseDeletedAt(d),
      showInSchedule: normalizePlanShowInScheduleFromFirestore(d.showInSchedule),
    }
  })
  plans.sort((a, b) => a.ordinal - b.ordinal)
  return plans
}

export async function getWorkoutPlanSubscriptionsForPlan(
  ownerUserId: string,
  remotePlanId: string,
  status: WorkoutPlanSubscriptionStatus,
  opts?: { pageSize?: number; cursor?: string | null; query?: string | null }
): Promise<{ items: WorkoutPlanSubscriptionRecord[]; nextCursor: string | null }> {
  if (!adminDb) return { items: [], nextCursor: null }
  const pageSize = Math.max(1, Math.min(opts?.pageSize ?? 25, 100))
  const cursor = opts?.cursor?.trim() || null
  const query = opts?.query?.trim().toLowerCase() || null

  const base = adminDb
    .collectionGroup('workoutPlanSubscriptions')
    .where('ownerUserId', '==', ownerUserId)
    .where('remotePlanId', '==', remotePlanId)
    .where('status', '==', status)
    .orderBy(FieldPath.documentId())

  const items: WorkoutPlanSubscriptionRecord[] = []
  let nextCursor: string | null = cursor
  let exhausted = false
  // Scan in chunks to support simple text filtering while still returning a paginated response.
  for (let i = 0; i < 6 && items.length < pageSize && !exhausted; i += 1) {
    let q = base.limit(pageSize * 2)
    if (nextCursor) q = q.startAfter(nextCursor)
    const snap = await q.get()
    if (snap.empty) {
      exhausted = true
      nextCursor = null
      break
    }
    for (const doc of snap.docs) {
      const item = mapWorkoutPlanSubscriptionDoc(doc)
      if (!item) continue
      if (query) {
        const hay = `${item.subscriberFullName ?? ''} ${item.subscriberHandle ?? ''} ${item.subscriberUserId}`.toLowerCase()
        if (!hay.includes(query)) continue
      }
      items.push(item)
      if (items.length >= pageSize) break
    }
    nextCursor = snap.docs[snap.docs.length - 1]?.id ?? null
    if (snap.size < pageSize * 2) {
      exhausted = true
      if (items.length < pageSize) nextCursor = null
    }
  }

  return { items, nextCursor: items.length >= pageSize ? nextCursor : null }
}

export async function getActiveWorkoutPlanSubscriptionsForUser(
  subscriberUserId: string
): Promise<WorkoutPlanSubscriptionRecord[]> {
  if (!adminDb) return []
  const snapshot = await adminDb
    .collection('users')
    .doc(subscriberUserId)
    .collection('workoutPlanSubscriptions')
    .where('status', '==', 'active')
    .get()
  const items = snapshot.docs
    .map((doc) => mapWorkoutPlanSubscriptionDoc(doc))
    .filter((item): item is WorkoutPlanSubscriptionRecord => item !== null)
  items.sort((a, b) => a.ordinal - b.ordinal)
  return items
}

export async function getActiveWorkoutPlanSubscriptionById(
  subscriberUserId: string,
  subscriptionDocumentId: string
): Promise<WorkoutPlanSubscriptionRecord | null> {
  if (!adminDb) return null
  const ref = adminDb
    .collection('users')
    .doc(subscriberUserId)
    .collection('workoutPlanSubscriptions')
    .doc(subscriptionDocumentId)
  const snap = await ref.get()
  if (!snap.exists) return null
  const item = mapWorkoutPlanSubscriptionDoc(snap)
  if (!item || item.status !== 'active') return null
  return item
}

export async function mutateWorkoutPlanSubscriptionForPlan(
  ownerUserId: string,
  remotePlanId: string,
  subscriberUserId: string,
  subscriptionDocumentId: string,
  action: 'approve' | 'reject' | 'revoke' | 'block' | 'unblock'
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const ref = adminDb
    .collection('users')
    .doc(subscriberUserId)
    .collection('workoutPlanSubscriptions')
    .doc(subscriptionDocumentId)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('Subscription not found')
  const data = snap.data() as Record<string, unknown>
  const owner = typeof data.ownerUserId === 'string' ? data.ownerUserId : ''
  const planId = typeof data.remotePlanId === 'string' ? data.remotePlanId : ''
  if (owner !== ownerUserId || planId !== remotePlanId) {
    throw new Error('Subscription does not belong to this plan')
  }
  if (action === 'approve' || action === 'unblock') {
    await ref.update({
      status: 'active',
      updatedAt: FieldValue.serverTimestamp(),
    })
    return
  }
  if (action === 'block') {
    await ref.update({
      status: 'blocked',
      updatedAt: FieldValue.serverTimestamp(),
    })
    return
  }
  // reject/revoke => remove subscription
  await ref.delete()
}

export async function getUserWorkoutCollections(userId: string): Promise<WorkoutCollection[]> {
  if (!adminDb) return []
  const snapshot = await adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutCollections)
    .get()
  const collections = snapshot.docs.map((doc) => {
    const d = doc.data()
    const workoutIdsRaw = d.workoutIds
    const workoutIds = Array.isArray(workoutIdsRaw)
      ? workoutIdsRaw.filter((x): x is string => typeof x === 'string')
      : []
    return {
      id: doc.id,
      ordinal: typeof d.ordinal === 'number' ? d.ordinal : 0,
      userId: typeof d.userId === 'string' ? d.userId : '',
      workoutCollectionDescription: d.workoutCollectionDescription ?? null,
      workoutCollectionId: typeof d.workoutCollectionId === 'string' ? d.workoutCollectionId : '',
      workoutCollectionName: typeof d.workoutCollectionName === 'string' ? d.workoutCollectionName : '',
      workoutCollectionShareId: typeof d.workoutCollectionShareId === 'string' ? d.workoutCollectionShareId : '',
      workoutIds,
      deletedAt: parseDeletedAt(d),
    }
  })
  collections.sort((a, b) => a.ordinal - b.ordinal)
  return collections
}

async function resyncCollectionMirrorsAfterWorkoutChange(userId: string, workoutId: string): Promise<void> {
  const cols = await getUserWorkoutCollections(userId)
  const w = workoutId.trim()
  if (!w) return
  const seen = new Set<string>()
  for (const c of cols) {
    if (c.deletedAt) continue
    const ids = c.workoutIds ?? []
    const has = ids.some(
      (id) => typeof id === 'string' && bareWorkoutIdForGroupSharedMirror(userId, id) === w
    )
    if (!has) continue
    const cid = (c.workoutCollectionId && c.workoutCollectionId.trim()) || c.id
    if (!cid || seen.has(cid)) continue
    seen.add(cid)
    await syncCollectionHubWorkoutMirrors(userId, cid)
    await syncCollectionUserWorkoutMirrors(userId, cid)
  }
}

async function pushWorkoutShareMirrors(userId: string, workoutId: string): Promise<void> {
  await syncWorkoutUserConnectionMirrors(userId, workoutId)
  await syncWorkoutHubMirrors(userId, workoutId)
  await resyncCollectionMirrorsAfterWorkoutChange(userId, workoutId)
}

async function pushCollectionShareMirrors(userId: string, collectionId: string): Promise<void> {
  await syncCollectionUserConnectionMirrors(userId, collectionId)
  await syncCollectionHubWorkoutMirrors(userId, collectionId)
  await syncCollectionUserWorkoutMirrors(userId, collectionId)
}

/** Map collection fields (owner doc or share mirror `payload`) to `WorkoutCollection`. */
export function mapCollectionFromFirestore(docId: string, d: Record<string, unknown>): WorkoutCollection {
  const workoutIdsRaw = d.workoutIds
  const workoutIds = Array.isArray(workoutIdsRaw)
    ? workoutIdsRaw.filter((x): x is string => typeof x === 'string')
    : []
  return {
    id: docId,
    ordinal: typeof d.ordinal === 'number' ? d.ordinal : 0,
    userId: typeof d.userId === 'string' ? d.userId : '',
    workoutCollectionDescription:
      typeof d.workoutCollectionDescription === 'string' ? d.workoutCollectionDescription : null,
    workoutCollectionId:
      typeof d.workoutCollectionId === 'string' && d.workoutCollectionId.trim() !== ''
        ? d.workoutCollectionId
        : docId,
    workoutCollectionName: typeof d.workoutCollectionName === 'string' ? d.workoutCollectionName : '',
    workoutCollectionShareId: typeof d.workoutCollectionShareId === 'string' ? d.workoutCollectionShareId : '',
    workoutIds,
    deletedAt: parseDeletedAt(d),
  }
}

/** Fetch a single workout collection by doc id from users/<userId>/workoutCollections. */
export async function getCollectionById(userId: string, collectionId: string): Promise<WorkoutCollection | null> {
  if (!adminDb) return null
  const doc = await adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutCollections)
    .doc(collectionId)
    .get()
  if (!doc.exists) return null
  return mapCollectionFromFirestore(doc.id, doc.data() as Record<string, unknown>)
}

/** Every workout id listed on a non-deleted collection (including `favorite`). */
export function getWorkoutIdsReferencedByActiveCollections(collections: WorkoutCollection[]): Set<string> {
  const ids = new Set<string>()
  for (const c of collections) {
    if (c.deletedAt) continue
    for (const id of c.workoutIds ?? []) {
      if (typeof id === 'string' && id.trim() !== '') ids.add(id.trim())
    }
  }
  return ids
}

/** Fetch all workout documents from users/<userId>/workouts (for profile list). Uses full mapping so display name/description work. */
export async function getUserWorkouts(userId: string): Promise<Workout[]> {
  if (!adminDb) return []
  const snapshot = await adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workouts)
    .get()
  const workouts: Workout[] = []
  for (const doc of snapshot.docs) {
    const w = mapWorkoutDoc(doc)
    if (w) workouts.push(w)
  }
  workouts.sort((a, b) => (a.workoutName ?? a.workoutId).localeCompare(b.workoutName ?? b.workoutId))
  return workouts
}

/** Map workout fields (owner doc or share mirror `payload`) to `Workout`. `docId` is the Firestore document id under `users/.../workouts`. */
export function mapWorkoutFromFirestore(docId: string, d: Record<string, unknown>): Workout | null {
  const type = d.type === 'MultiSegmentWorkout' ? 'MultiSegmentWorkout' : 'SingleSegmentWorkout'
  const raw = d as Record<string, unknown>
  const decodeInt = (key: string, def: number) => {
    const v = raw[key]
    if (typeof v === 'number') return v
    if (typeof v === 'string') { const n = parseInt(v, 10); return Number.isNaN(n) ? def : n }
    return def
  }
  const decodeBool = (key: string, def: boolean) => {
    const v = raw[key]
    if (typeof v === 'boolean') return v
    if (typeof v === 'number') return v !== 0
    return def
  }
  const decodeIntArray = (key: string): number[] => {
    const v = raw[key]
    if (Array.isArray(v)) return v.filter((x): x is number => typeof x === 'number')
    return []
  }
  const base: Workout = {
    id: docId,
    type,
    userId: typeof d.userId === 'string' ? d.userId : '',
    workoutId: typeof d.workoutId === 'string' ? d.workoutId : docId,
    workoutShareId: typeof d.workoutShareId === 'string' ? d.workoutShareId : '',
    workoutName: typeof d.workoutName === 'string' ? d.workoutName : null,
    workoutDescription: typeof d.workoutDescription === 'string' ? d.workoutDescription : null,
    workoutDetails: (type === 'SingleSegmentWorkout' ? (raw.workoutDetails as string) : undefined) ?? null,
    workoutImage: typeof d.workoutImage === 'string' ? d.workoutImage : null,
    timerMode: raw.timerMode,
    timerModes: raw.timerModes,
    deletedAt: parseDeletedAt(raw),
  }
  if (type === 'SingleSegmentWorkout') {
    const workoutSchedule = typeof raw.workoutSchedule === 'string' ? raw.workoutSchedule : null
    return {
      ...base,
      workoutSchedule: workoutSchedule ?? undefined,
      prelude: decodeInt('prelude', -1),
      segue: decodeBool('segue', false),
      warnings: decodeIntArray('warnings'),
      metronome: decodeInt('metronome', 0),
      direction: decodeBool('direction', false),
      restDirection: decodeInt('restDirection', 0),
      warningStrategy: decodeInt('warningStrategy', 0),
      continuity: decodeBool('continuity', false),
    }
  }
  const segmentDicts = Array.isArray(raw.segments) ? (raw.segments as Record<string, unknown>[]) : []
  const segments: WorkoutSegment[] = segmentDicts.map((seg, i) => parseSegment(seg, i, base.workoutId))
  return {
    ...base,
    autoProgress: raw.autoProgress === true,
    segments,
  }
}

function mapWorkoutDoc(doc: DocumentSnapshot): Workout | null {
  if (!doc.exists) return null
  return mapWorkoutFromFirestore(doc.id, doc.data() as Record<string, unknown>)
}

/** Fetch workout documents by id from users/<userId>/workouts (doc id = workoutId). Includes workoutSchedule, direction, segments for display names. */
export async function getWorkoutsByIds(userId: string, workoutIds: string[]): Promise<Workout[]> {
  if (!adminDb || workoutIds.length === 0) return []
  const userRef = adminDb.collection('users').doc(userId)
  const workoutsRef = userRef.collection(USER_COLLECTIONS.workouts)
  const uniqueIds = [...new Set(workoutIds)]
  const snaps = await Promise.all(uniqueIds.map((id) => workoutsRef.doc(id).get()))
  const results: Workout[] = []
  for (let i = 0; i < uniqueIds.length; i++) {
    const doc = snaps[i]
    const workout = doc ? mapWorkoutDoc(doc) : null
    if (workout) results.push(workout)
  }
  return results
}

function parseSegment(raw: Record<string, unknown>, index: number, fallbackWorkoutId: string): WorkoutSegment {
  const workoutId = typeof raw.workoutId === 'string' ? raw.workoutId : `${fallbackWorkoutId}-seg-${index}`
  const workoutSchedule = typeof raw.workoutSchedule === 'string' ? raw.workoutSchedule : null
  const decodeInt = (key: string, def: number) => {
    const v = raw[key]
    if (typeof v === 'number') return v
    if (typeof v === 'string') { const n = parseInt(v, 10); return Number.isNaN(n) ? def : n }
    return def
  }
  const decodeBool = (key: string, def: boolean) => {
    const v = raw[key]
    if (typeof v === 'boolean') return v
    if (typeof v === 'number') return v !== 0
    return def
  }
  const decodeIntArray = (key: string): number[] => {
    const v = raw[key]
    if (!Array.isArray(v)) return []
    const nums = v.filter((x): x is number => typeof x === 'number')
    if (nums.length > 0) return nums
    return (v as string[]).map((x) => parseInt(String(x), 10)).filter((n) => !Number.isNaN(n))
  }
  return {
    workoutId,
    workoutName: (raw.workoutName as string) ?? null,
    workoutDescription: (raw.workoutDescription as string) ?? null,
    workoutDetails: (raw.workoutDetails as string) ?? null,
    workoutImage: (raw.workoutImage as string) ?? null,
    workoutShareId: (raw.workoutShareId as string) ?? null,
    workoutSchedule: workoutSchedule ?? undefined,
    prelude: decodeInt('prelude', -1),
    segue: decodeBool('segue', false),
    warnings: decodeIntArray('warnings'),
    metronome: decodeInt('metronome', 0),
    direction: decodeBool('direction', false),
    restDirection: decodeInt('restDirection', 0),
    warningStrategy: decodeInt('warningStrategy', 0),
    continuity: decodeBool('continuity', false),
  }
}

/** Soft-delete a workout: set deletedAt to now. */
export async function setWorkoutDeletedAt(userId: string, workoutId: string, deletedAt: Date = new Date()): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workouts)
    .doc(workoutId)
  await ref.update({ deletedAt: Timestamp.fromDate(deletedAt) })
  await pushWorkoutShareMirrors(userId, workoutId)
}

/** Clear deletedAt on a workout (recover). */
export async function clearWorkoutDeletedAt(userId: string, workoutId: string): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workouts)
    .doc(workoutId)
  await ref.update({ deletedAt: FieldValue.delete() })
  await pushWorkoutShareMirrors(userId, workoutId)
}

/** Permanently delete a workout document from users/<userId>/workouts/<workoutId>. */
export async function deleteWorkout(userId: string, workoutId: string): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  await deleteWorkoutUserConnectionMirrors(userId, workoutId)
  await deleteWorkoutHubMirrors(userId, workoutId)
  await purgeWorkoutMirrorsFromCollectionDerivedShares(userId, workoutId)
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workouts)
    .doc(workoutId)
  await ref.delete()
}

/** Soft-delete a collection: set deletedAt to now. */
export async function setCollectionDeletedAt(userId: string, collectionId: string, deletedAt: Date = new Date()): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutCollections)
    .doc(collectionId)
  await ref.update({ deletedAt: Timestamp.fromDate(deletedAt) })
  await pushCollectionShareMirrors(userId, collectionId)
}

/** Clear deletedAt on a collection (recover). */
export async function clearCollectionDeletedAt(userId: string, collectionId: string): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutCollections)
    .doc(collectionId)
  await ref.update({ deletedAt: FieldValue.delete() })
  await pushCollectionShareMirrors(userId, collectionId)
}

/** Permanently delete a workout collection document from users/<userId>/workoutCollections/<collectionId>. */
export async function deleteCollection(userId: string, collectionId: string): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  await deleteCollectionUserConnectionMirrors(userId, collectionId)
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutCollections)
    .doc(collectionId)
  await ref.delete()
}

/** Create a SingleSegmentWorkout in users/<userId>/workouts. data: { timerMode, workoutSchedule (string), direction?, restDirection? }. */
export async function createWorkout(
  userId: string,
  data: {
    timerMode: number
    workoutSchedule: string
    direction?: boolean
    restDirection?: number
  }
): Promise<Workout> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const id = randomUUID()
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workouts)
    .doc(id)
  const restDirection =
    typeof data.restDirection === 'number' ? data.restDirection : 0
  await ref.set({
    type: 'SingleSegmentWorkout',
    userId,
    workoutId: id,
    workoutShareId: '',
    workoutName: null,
    workoutDescription: null,
    workoutDetails: null,
    workoutImage: null,
    timerMode: data.timerMode,
    workoutSchedule: data.workoutSchedule,
    direction: data.direction === true,
    prelude: -1,
    segue: false,
    warnings: [],
    metronome: 0,
    restDirection,
    warningStrategy: 0,
    continuity: false,
  })
  const created = await getWorkoutById(userId, id)
  if (!created) throw new Error('Failed to read created workout')
  await pushWorkoutShareMirrors(userId, id)
  return created
}

/** Create an empty MultiSegmentWorkout in users/<userId>/workouts. */
export async function createMultiSegmentWorkout(userId: string): Promise<Workout> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const id = randomUUID()
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workouts)
    .doc(id)
  await ref.set({
    type: 'MultiSegmentWorkout',
    userId,
    workoutId: id,
    workoutShareId: '',
    workoutName: null,
    workoutDescription: null,
    workoutImage: null,
    autoProgress: false,
    segments: [],
  })
  const created = await getWorkoutById(userId, id)
  if (!created) throw new Error('Failed to read created workout')
  await pushWorkoutShareMirrors(userId, id)
  return created
}

/** Append a workout id to a collection's workoutIds. */
export async function addWorkoutToCollection(
  userId: string,
  collectionId: string,
  workoutId: string
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const coll = await getCollectionById(userId, collectionId)
  if (!coll) throw new Error('Collection not found')
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutCollections)
    .doc(collectionId)
  await ref.update({ workoutIds: [...coll.workoutIds, workoutId] })
  await pushCollectionShareMirrors(userId, collectionId)
}

/**
 * Deep-copy another user's workout document into `targetUserId`'s `workouts` with new root (and segment) ids.
 * Used when duplicating a shared / feed-visible workout into the viewer's library.
 */
export async function cloneWorkoutToUserLibrary(
  sourceOwnerUserId: string,
  sourceWorkoutId: string,
  targetUserId: string
): Promise<string> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const owner = sourceOwnerUserId.trim()
  const sid = sourceWorkoutId.trim()
  const uid = targetUserId.trim()
  if (!owner || !sid || !uid) throw new Error('Invalid ids')

  const srcRef = adminDb
    .collection('users')
    .doc(owner)
    .collection(USER_COLLECTIONS.workouts)
    .doc(sid)
  const snap = await srcRef.get()
  if (!snap.exists) throw new Error('Source workout not found')
  const raw = snap.data() as Record<string, unknown>
  if (raw.deletedAt != null) throw new Error('Source workout not found')

  const newRootId = randomUUID()
  const type = raw.type === 'MultiSegmentWorkout' ? 'MultiSegmentWorkout' : 'SingleSegmentWorkout'
  const payload: Record<string, unknown> = {
    ...raw,
    userId: uid,
    workoutId: newRootId,
    workoutShareId: '',
  }
  delete payload.deletedAt

  if (type === 'MultiSegmentWorkout' && Array.isArray(raw.segments)) {
    payload.segments = (raw.segments as Record<string, unknown>[]).map((seg) => ({
      ...seg,
      workoutId: randomUUID(),
    }))
  }

  const targetRef = adminDb
    .collection('users')
    .doc(uid)
    .collection(USER_COLLECTIONS.workouts)
    .doc(newRootId)
  await targetRef.set(payload)
  await pushWorkoutShareMirrors(uid, newRootId)
  return newRootId
}

/**
 * Deep-copy another user's workout collection and each listed workout into `targetUserId`'s library.
 * Preserves order from `workoutIds`. Skips source workouts that are missing or soft-deleted.
 */
export async function cloneSharedCollectionToUserLibrary(
  sourceOwnerUserId: string,
  sourceCollectionId: string,
  targetUserId: string
): Promise<{
  newCollectionId: string
  clonedWorkoutCount: number
  skippedWorkoutCount: number
}> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const owner = sourceOwnerUserId.trim()
  const scid = sourceCollectionId.trim()
  const uid = targetUserId.trim()
  if (!owner || !scid || !uid) throw new Error('Invalid ids')

  const sourceColl = await getCollectionById(owner, scid)
  if (!sourceColl || sourceColl.deletedAt) throw new Error('Source collection not found')

  const orderedSourceIds = sourceColl.workoutIds.filter((id) => typeof id === 'string' && id.trim() !== '')
  const newWorkoutIds: string[] = []
  let skippedWorkoutCount = 0
  for (const wid of orderedSourceIds) {
    const w = await getWorkoutById(owner, wid.trim())
    if (!w || w.deletedAt) {
      skippedWorkoutCount += 1
      continue
    }
    const clonedId = await cloneWorkoutToUserLibrary(owner, wid.trim(), uid)
    newWorkoutIds.push(clonedId)
  }

  const existing = await getUserWorkoutCollections(uid)
  const nextOrdinal =
    existing.length === 0 ? 0 : Math.max(...existing.map((c) => c.ordinal), 0) + 1

  const newCollectionId = randomUUID()
  const colRef = adminDb
    .collection('users')
    .doc(uid)
    .collection(USER_COLLECTIONS.workoutCollections)
    .doc(newCollectionId)

  await colRef.set({
    ordinal: nextOrdinal,
    userId: uid,
    workoutCollectionId: newCollectionId,
    workoutCollectionName: sourceColl.workoutCollectionName?.trim() || 'Untitled collection',
    workoutCollectionDescription: sourceColl.workoutCollectionDescription?.trim() || null,
    workoutCollectionShareId: '',
    workoutIds: newWorkoutIds,
  })
  await pushCollectionShareMirrors(uid, newCollectionId)

  return {
    newCollectionId,
    clonedWorkoutCount: newWorkoutIds.length,
    skippedWorkoutCount,
  }
}

/**
 * Replace the workoutIds array for a collection.
 * Used for reordering workouts within favorites and user-created collections.
 */
export async function updateCollectionWorkoutIds(
  userId: string,
  collectionId: string,
  workoutIds: string[]
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const uniqueIds = [...new Set(workoutIds)].filter(
    (id): id is string => typeof id === 'string' && id.trim() !== ''
  )
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutCollections)
    .doc(collectionId)
  await ref.update({ workoutIds: uniqueIds })
  await pushCollectionShareMirrors(userId, collectionId)
}

/**
 * Update collection ordinals to match the order of collectionIds. Each collection's ordinal is set to its index.
 * Used for reordering collections in the app. Pass all collection IDs in desired order (including 'favorite' if present).
 */
export async function updateCollectionOrdinals(
  userId: string,
  collectionIds: string[]
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const colRef = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutCollections)
  const batch = adminDb.batch()
  collectionIds.forEach((collectionId, index) => {
    const ref = colRef.doc(collectionId)
    batch.update(ref, { ordinal: index })
  })
  await batch.commit()
  for (const collectionId of collectionIds) {
    await pushCollectionShareMirrors(userId, collectionId)
  }
}

/** Update a collection's name and/or description. */
export async function updateCollectionMetadata(
  userId: string,
  collectionId: string,
  data: { name: string; description?: string | null }
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutCollections)
    .doc(collectionId)
  await ref.update({
    workoutCollectionName: data.name.trim() || 'Untitled collection',
    workoutCollectionDescription: data.description?.trim() || null,
  })
  await pushCollectionShareMirrors(userId, collectionId)
}

const FIRESTORE_BATCH_SIZE = 500

/** Soft-delete a plan: set deletedAt to now. */
export async function setPlanDeletedAt(userId: string, planId: string, deletedAt: Date = new Date()): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutPlans)
    .doc(planId)
  await ref.update({ deletedAt: Timestamp.fromDate(deletedAt) })
  await syncPlanShareMirrorsForOwner(userId, planId)
}

/** Clear deletedAt on a plan (recover). */
export async function clearPlanDeletedAt(userId: string, planId: string): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutPlans)
    .doc(planId)
  await ref.update({ deletedAt: FieldValue.delete() })
  await syncPlanShareMirrorsForOwner(userId, planId)
}

/** Update a plan's name and/or description. */
export async function updatePlanMetadata(
  userId: string,
  planId: string,
  data: {
    name?: string
    description?: string | null
    privacy?: number
    handle?: string | null
    trainingIntent?: 0 | 1
    showInSchedule?: boolean
  }
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutPlans)
    .doc(planId)
  const before = await ref.get()
  const beforeData = before.exists ? (before.data() as Record<string, unknown>) : {}
  const patch: Record<string, unknown> = {}
  if (typeof data.name === 'string') {
    patch.workoutPlanName = data.name.trim() || 'Untitled plan'
    patch.workoutPlanDescription = data.description?.trim() || null
  }
  if (data.trainingIntent === 0 || data.trainingIntent === 1) {
    patch.trainingIntent = data.trainingIntent === 1 ? 1 : 0
  }
  if (typeof data.privacy === 'number') {
    patch.privacy = data.privacy
  }
  if ('handle' in data) {
    patch.handle = typeof data.handle === 'string' ? data.handle.trim() || null : null
    patch.handleNormalized = normalizeWorkoutPlanHandle(
      typeof data.handle === 'string' ? data.handle : null
    )
  }
  if (typeof data.showInSchedule === 'boolean') {
    patch.showInSchedule = data.showInSchedule
  }
  // Rewrite legacy string trainingIntent on the canonical plan doc to numeric 0|1.
  if (beforeData.isPersonal !== true) {
    const resolved = normalizePlanTrainingIntentFromFirestore(beforeData.trainingIntent)
    if (resolved === 0 || resolved === 1) {
      const raw = beforeData.trainingIntent
      const alreadyCleanNumber = raw === 0 || raw === 1
      const patchAlreadySetsTi = patch.trainingIntent === 0 || patch.trainingIntent === 1
      if (!alreadyCleanNumber && !patchAlreadySetsTi) {
        patch.trainingIntent = resolved
      }
    }
  }
  if (Object.keys(patch).length === 0) return
  await ref.update(patch)

  const previousHandle =
    typeof beforeData.handle === 'string' ? beforeData.handle : null
  const previousName =
    typeof beforeData.workoutPlanName === 'string' ? beforeData.workoutPlanName : 'Untitled plan'
  const previousPrivacy =
    typeof beforeData.privacy === 'number' ? beforeData.privacy : null
  const planDeleted = parseDeletedAt(beforeData) !== null
  const nextHandle =
    typeof patch.handle === 'string'
      ? patch.handle
      : patch.handle === null
        ? null
        : previousHandle
  const nextName =
    typeof patch.workoutPlanName === 'string' ? patch.workoutPlanName : previousName
  const nextPrivacy =
    typeof patch.privacy === 'number' ? patch.privacy : previousPrivacy

  await syncWorkoutPlanHandleIndex(
    userId,
    planId,
    nextName,
    previousHandle,
    nextHandle,
    nextPrivacy,
    planDeleted
  )
  await syncPlanShareMirrorsForOwner(userId, planId)
}

/** Permanently delete a workout plan: deletes all planDays subcollection docs, then the plan document. */
export async function deletePlan(userId: string, planId: string): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  await deletePlanUserConnectionMirrors(userId, planId)
  const planRef = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutPlans)
    .doc(planId)
  const planDaysSnap = await planRef.collection('planDays').get()
  for (let i = 0; i < planDaysSnap.docs.length; i += FIRESTORE_BATCH_SIZE) {
    const batch = adminDb.batch()
    planDaysSnap.docs.slice(i, i + FIRESTORE_BATCH_SIZE).forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
  await planRef.delete()
}

/** Create a new workout collection under users/<userId>/workoutCollections. Returns the created collection. */
export async function createWorkoutCollection(
  userId: string,
  data: { name: string; description?: string | null }
): Promise<WorkoutCollection> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const colRef = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutCollections)
  const id = randomUUID()
  const newRef = colRef.doc(id)
  await newRef.set({
    ordinal: 0,
    userId,
    workoutCollectionId: id,
    workoutCollectionName: data.name.trim() || 'Untitled collection',
    workoutCollectionDescription: data.description?.trim() || null,
    workoutCollectionShareId: '',
    workoutIds: [],
  })
  const created = await getCollectionById(userId, id)
  if (!created) throw new Error('Failed to read created collection')
  await pushCollectionShareMirrors(userId, id)
  return created
}

/** Create a new workout plan under users/<userId>/workoutPlans. Returns the created plan. */
export async function createWorkoutPlan(
  userId: string,
  data: {
    name: string
    description?: string | null
    isPersonal?: boolean
    trainingIntent?: 0 | 1
  }
): Promise<WorkoutPlan> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const colRef = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutPlans)
  const id = randomUUID()
  const newRef = colRef.doc(id)
  const isPersonal = data.isPersonal ?? true
  const doc: Record<string, unknown> = {
    ordinal: 0,
    userId,
    isPersonal,
    workoutPlanId: id,
    workoutPlanName: data.name.trim() || 'Untitled plan',
    workoutPlanDescription: data.description?.trim() || null,
    privacy: 1, // private by default
    handle: null,
    showInSchedule: true,
  }
  if (!isPersonal) {
    doc.trainingIntent = data.trainingIntent === 1 ? 1 : 0
  }
  await newRef.set(doc)
  const created = await getPlanById(userId, id)
  if (!created) throw new Error('Failed to read created plan')
  await syncPlanShareMirrorsForOwner(userId, id)
  return created
}

/** Fetch a single workout by id from users/<userId>/workouts. Includes workoutSchedule (string), options, and segments for detail view. */
export async function getWorkoutById(userId: string, workoutId: string): Promise<Workout | null> {
  if (!adminDb) return null
  const doc = await adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workouts)
    .doc(workoutId)
    .get()
  return mapWorkoutDoc(doc)
}

/**
 * Update plan ordinals to match the order of planIds. Each plan's ordinal is set to its index.
 * Used for reordering plans in the app.
 */
export async function updatePlanOrdinals(userId: string, planIds: string[]): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const colRef = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutPlans)
  const batch = adminDb.batch()
  planIds.forEach((planId, index) => {
    const ref = colRef.doc(planId)
    batch.update(ref, { ordinal: index })
  })
  await batch.commit()
}

/** Buckets for plan list ordinals (each bucket uses ordinals 0..n-1 independently). */
export type OwnedPlanOrdinalSection = 'personal' | 'privateTraining' | 'groupTraining'

export function ownedPlanOrdinalSection(plan: WorkoutPlan): OwnedPlanOrdinalSection {
  if (plan.isPersonal) return 'personal'
  if (plan.trainingIntent === 1) return 'groupTraining'
  return 'privateTraining'
}

/**
 * Set ordinals 0..n-1 for the given owned plans only (same training bucket).
 * `planIdsInOrder` must list every active plan in that bucket exactly once.
 */
export async function updatePlanOrdinalsForSection(
  userId: string,
  section: OwnedPlanOrdinalSection,
  planIdsInOrder: string[]
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const allPlans = await getUserWorkoutPlans(userId)
  const active = allPlans.filter((p) => !p.deletedAt)
  const inSection = active.filter((p) => ownedPlanOrdinalSection(p) === section)
  const expected = new Set(inSection.map((p) => p.id))
  const received = new Set(planIdsInOrder)
  if (expected.size !== planIdsInOrder.length || ![...expected].every((id) => received.has(id))) {
    throw new Error('planIds must list every plan in this section exactly once')
  }
  const colRef = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutPlans)
  const batch = adminDb.batch()
  planIdsInOrder.forEach((planId, index) => {
    batch.update(colRef.doc(planId), { ordinal: index })
  })
  await batch.commit()
}

/**
 * Set ordinals 0..n-1 for active workout plan subscriptions for the subscriber.
 * `subscriptionDocumentIdsInOrder` must list every active subscription doc id exactly once.
 */
export async function updateWorkoutPlanSubscriptionOrdinals(
  subscriberUserId: string,
  subscriptionDocumentIdsInOrder: string[]
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const subs = await getActiveWorkoutPlanSubscriptionsForUser(subscriberUserId)
  const expected = new Set(subs.map((s) => s.subscriptionDocumentId))
  const received = new Set(subscriptionDocumentIdsInOrder)
  if (
    expected.size !== subscriptionDocumentIdsInOrder.length ||
    ![...expected].every((id) => received.has(id))
  ) {
    throw new Error('subscriptionDocumentIds must list every active subscription exactly once')
  }
  const base = adminDb
    .collection('users')
    .doc(subscriberUserId)
    .collection('workoutPlanSubscriptions')
  const batch = adminDb.batch()
  subscriptionDocumentIdsInOrder.forEach((id, index) => {
    batch.update(base.doc(id), { ordinal: index, updatedAt: FieldValue.serverTimestamp() })
  })
  await batch.commit()
}

/** Map plan fields (owner doc or share mirror `payload`) to `WorkoutPlan`. */
export function mapPlanFromFirestore(docId: string, d: Record<string, unknown>): WorkoutPlan {
  const dayTz = pickTimeZoneIdFromRecord(d)
  return {
    id: docId,
    isPersonal: d.isPersonal === true,
    ordinal: typeof d.ordinal === 'number' ? d.ordinal : 0,
    userId: typeof d.userId === 'string' ? d.userId : '',
    workoutPlanDescription: typeof d.workoutPlanDescription === 'string' ? d.workoutPlanDescription : null,
    workoutPlanId:
      typeof d.workoutPlanId === 'string' && d.workoutPlanId.trim() !== '' ? d.workoutPlanId : docId,
    workoutPlanName: typeof d.workoutPlanName === 'string' ? d.workoutPlanName : '',
    trainingIntent: normalizePlanTrainingIntentFromFirestore(d.trainingIntent),
    privacy: typeof d.privacy === 'number' ? d.privacy : null,
    handle: typeof d.handle === 'string' ? d.handle : null,
    deletedAt: parseDeletedAt(d),
    showInSchedule: normalizePlanShowInScheduleFromFirestore(d.showInSchedule),
    dayTimeZoneId: dayTz,
  }
}

/** Fetch a single workout plan by doc id from users/<userId>/workoutPlans. */
export async function getPlanById(userId: string, planId: string): Promise<WorkoutPlan | null> {
  if (!adminDb) return null
  const doc = await adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutPlans)
    .doc(planId)
    .get()
  if (!doc.exists) return null
  return mapPlanFromFirestore(doc.id, doc.data() as Record<string, unknown>)
}

/** IANA id for interpreting planned-workout calendar days (plan doc, then user doc, then preferred hint). */
export async function resolvePlanDayTimeZoneId(
  userId: string,
  planId: string,
  preferred?: string | null,
): Promise<string> {
  const hint = typeof preferred === 'string' ? preferred.trim() : ''
  if (hint && isValidIanaTimeZone(hint)) return hint
  const plan = await getPlanById(userId, planId)
  if (plan?.dayTimeZoneId && isValidIanaTimeZone(plan.dayTimeZoneId)) return plan.dayTimeZoneId
  if (!adminDb) return 'UTC'
  const userSnap = await adminDb.collection('users').doc(userId).get()
  if (userSnap.exists) {
    const fromUser = pickTimeZoneIdFromRecord(userSnap.data() as Record<string, unknown>)
    if (fromUser) return fromUser
  }
  return 'UTC'
}

/** True when `planId` is a non-deleted document under users/<userId>/workoutPlans (not a followed coach plan id alone). */
export async function userOwnsActiveWorkoutPlan(userId: string, planId: string): Promise<boolean> {
  const plan = await getPlanById(userId, planId)
  return Boolean(plan && !plan.deletedAt)
}

/** Fetch plan days in date range from users/<userId>/workoutPlans/<planId>/planDays. Document IDs are date strings (e.g. YYYY-MM-DD). */
export async function getPlanDays(userId: string, planId: string, fromDate: string, toDate: string): Promise<PlanDay[]> {
  if (!adminDb) return []
  const planDaysRef = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutPlans)
    .doc(planId)
    .collection('planDays')
  const snapshot = await planDaysRef
    .where(FieldPath.documentId(), '>=', fromDate)
    .where(FieldPath.documentId(), '<=', toDate)
    .orderBy(FieldPath.documentId())
    .get()
  return snapshot.docs.map((doc) => {
    const d = doc.data() as Record<string, unknown>
    const entriesRaw = d.entries
    const entries: PlanDayEntry[] = Array.isArray(entriesRaw)
      ? (entriesRaw as Record<string, unknown>[]).map((e) => mapPlanDayEntry(e))
      : []
    const sourceWorkoutIdsRaw = d.sourceWorkoutIds
    const sourceWorkoutIds = Array.isArray(sourceWorkoutIdsRaw)
      ? (sourceWorkoutIdsRaw as unknown[]).map((s) => (typeof s === 'string' ? s : null))
      : []
    return {
      id: doc.id,
      day: parseTimestamp(d.day),
      entries,
      planId: typeof d.planId === 'string' ? d.planId : '',
      sourceWorkoutIds,
      userId: typeof d.userId === 'string' ? d.userId : '',
    }
  })
}

const PLANNED_WORKOUTS_COLLECTION = 'plannedWorkouts'

/** Fetch planned workouts for a plan in date range from users/<userId>/plannedWorkouts. Excludes soft-deleted (deletedAt set). */
export async function getPlannedWorkouts(
  userId: string,
  planId: string,
  fromDate: string,
  toDate: string,
  options?: { planDayTimeZoneId?: string | null },
): Promise<PlannedWorkout[]> {
  if (!adminDb) return []
  const tz = await resolvePlanDayTimeZoneId(userId, planId, options?.planDayTimeZoneId ?? null)
  const startMs = utcMillisAtStartOfCalendarDayInTimeZone(fromDate, tz)
  const endExclusiveMs = utcMillisAtStartOfCalendarDayInTimeZone(addCalendarDays(toDate, 1), tz)
  const startTs = Timestamp.fromMillis(startMs)
  const endExclusiveTs = Timestamp.fromMillis(endExclusiveMs)
  const snapshot = await adminDb
    .collection('users')
    .doc(userId)
    .collection(PLANNED_WORKOUTS_COLLECTION)
    .where('planId', '==', planId)
    .where('day', '>=', startTs)
    .where('day', '<', endExclusiveTs)
    .orderBy('day')
    .get()
  const results: PlannedWorkout[] = []
  for (const doc of snapshot.docs) {
    const d = doc.data() as Record<string, unknown>
    if (parseDeletedAt(d)) continue
    const workoutRaw = d.workout
    const workout = mapPlanDayEntry(
      typeof workoutRaw === 'object' && workoutRaw !== null ? (workoutRaw as Record<string, unknown>) : {}
    )
    results.push({
      id: doc.id,
      day: parseTimestamp(d.day),
      ordinal: typeof d.ordinal === 'number' ? d.ordinal : 0,
      planId: typeof d.planId === 'string' ? d.planId : '',
      plannedWorkoutId:
        typeof d.plannedWorkoutId === 'string' ? d.plannedWorkoutId : doc.id,
      sourceWorkoutId:
        d.sourceWorkoutId != null && typeof d.sourceWorkoutId === 'string'
          ? d.sourceWorkoutId
          : null,
      userId: typeof d.userId === 'string' ? d.userId : '',
      workout,
      deletedAt: parseDeletedAt(d),
    })
  }
  results.sort((a, b) => a.ordinal - b.ordinal || a.day.localeCompare(b.day))
  return results
}

/** Fetch a single planned workout by id from users/<userId>/plannedWorkouts/<plannedWorkoutId>. */
export async function getPlannedWorkout(
  userId: string,
  plannedWorkoutId: string
): Promise<PlannedWorkout | null> {
  if (!adminDb) return null
  const docRef = adminDb
    .collection('users')
    .doc(userId)
    .collection(PLANNED_WORKOUTS_COLLECTION)
    .doc(plannedWorkoutId)
  const snap = await docRef.get()
  if (!snap.exists) return null
  const d = snap.data() as Record<string, unknown>
  const workoutRaw = d.workout
  const workout = mapPlanDayEntry(
    typeof workoutRaw === 'object' && workoutRaw !== null ? (workoutRaw as Record<string, unknown>) : {}
  )
  return {
    id: snap.id,
    day: parseTimestamp(d.day),
    ordinal: typeof d.ordinal === 'number' ? d.ordinal : 0,
    planId: typeof d.planId === 'string' ? d.planId : '',
    plannedWorkoutId: typeof d.plannedWorkoutId === 'string' ? d.plannedWorkoutId : snap.id,
    sourceWorkoutId:
      d.sourceWorkoutId != null && typeof d.sourceWorkoutId === 'string' ? d.sourceWorkoutId : null,
    userId: typeof d.userId === 'string' ? d.userId : '',
    workout,
    deletedAt: parseDeletedAt(d),
  }
}

/** Create a new planned workout. day is YYYY-MM-DD; ordinal defaults to 0; workout is the PlanDayEntry-shaped object (timerMode, workoutSchedule JSON string, direction, etc.). sourceWorkoutId optional. */
export async function createPlannedWorkout(
  userId: string,
  planId: string,
  params: {
    day: string
    ordinal?: number
    workout: Record<string, unknown>
    sourceWorkoutId?: string | null
    /** IANA zone for `day` (local midnight); when omitted, resolved from plan + user docs. */
    planDayTimeZoneId?: string | null
  },
): Promise<PlannedWorkout> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const id = randomUUID()
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(PLANNED_WORKOUTS_COLLECTION)
    .doc(id)
  const dayYmd = params.day.slice(0, 10)
  const tz = await resolvePlanDayTimeZoneId(userId, planId, params.planDayTimeZoneId ?? null)
  const dayTs = Timestamp.fromMillis(utcMillisAtStartOfCalendarDayInTimeZone(dayYmd, tz))
  await ref.set({
    day: dayTs,
    ordinal: typeof params.ordinal === 'number' ? params.ordinal : 0,
    planId,
    plannedWorkoutId: id,
    sourceWorkoutId:
      params.sourceWorkoutId != null && params.sourceWorkoutId !== ''
        ? params.sourceWorkoutId
        : null,
    userId,
    workout: stripUndefined(params.workout),
  })
  const created = await getPlannedWorkout(userId, id)
  if (!created) throw new Error('Failed to read created planned workout')
  return created
}

/** Update a planned workout's day and/or ordinal and optionally move it to another owned plan. day is YYYY-MM-DD; ordinal is a number (can be fractional for insert-between). */
export async function updatePlannedWorkoutDayAndOrdinal(
  userId: string,
  plannedWorkoutId: string,
  updates: { day?: string; ordinal?: number; planId?: string; planDayTimeZoneId?: string | null },
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(PLANNED_WORKOUTS_COLLECTION)
    .doc(plannedWorkoutId)
  const data: Record<string, unknown> = {}
  if (updates.day !== undefined) {
    const snap = await ref.get()
    if (!snap.exists) throw new Error('Planned workout not found')
    const cur = snap.data() as Record<string, unknown>
    const curPlanId = typeof cur.planId === 'string' ? cur.planId : ''
    const targetPlanId =
      updates.planId !== undefined && String(updates.planId).trim() !== ''
        ? String(updates.planId).trim()
        : curPlanId
    const dayYmd = updates.day.slice(0, 10)
    const tz = await resolvePlanDayTimeZoneId(userId, targetPlanId, updates.planDayTimeZoneId ?? null)
    data.day = Timestamp.fromMillis(utcMillisAtStartOfCalendarDayInTimeZone(dayYmd, tz))
  }
  if (updates.ordinal !== undefined) {
    data.ordinal = updates.ordinal
  }
  if (updates.planId !== undefined) {
    data.planId = updates.planId
  }
  if (Object.keys(data).length === 0) return
  await ref.update(data)
}

/** Update a planned workout's embedded workout name, description, and/or details. */
export async function updatePlannedWorkoutWorkoutMetadata(
  userId: string,
  plannedWorkoutId: string,
  updates: { workoutName?: string | null; workoutDescription?: string | null; workoutDetails?: string | null }
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(PLANNED_WORKOUTS_COLLECTION)
    .doc(plannedWorkoutId)
  const data: Record<string, unknown> = {}
  if (updates.workoutName !== undefined) {
    data['workout.workoutName'] = updates.workoutName
  }
  if (updates.workoutDescription !== undefined) {
    data['workout.workoutDescription'] = updates.workoutDescription
  }
  if (updates.workoutDetails !== undefined) {
    data['workout.workoutDetails'] = updates.workoutDetails
  }
  if (Object.keys(data).length === 0) return
  await ref.update(data)
}

/** Remove undefined values from an object (and nested objects) so Firestore update() does not receive undefined. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as Record<string, unknown>
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = stripUndefined(v as Record<string, unknown>)
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? stripUndefined(item as Record<string, unknown>)
          : item
      )
    } else {
      out[k] = v
    }
  }
  return out as T
}

/** Replace the entire embedded workout object on a planned workout (e.g. after editing schedule). */
export async function updatePlannedWorkoutWorkout(
  userId: string,
  plannedWorkoutId: string,
  workout: Record<string, unknown>
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(PLANNED_WORKOUTS_COLLECTION)
    .doc(plannedWorkoutId)
  await ref.update({ workout: stripUndefined(workout) })
}

/** Permanently delete a planned workout document from users/<userId>/plannedWorkouts/<plannedWorkoutId>. */
export async function deletePlannedWorkout(userId: string, plannedWorkoutId: string): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(PLANNED_WORKOUTS_COLLECTION)
    .doc(plannedWorkoutId)
  await ref.delete()
}

/**
 * Update basic metadata on a workout (name / description only).
 * Does not touch timer configuration, schedule JSON, or any meta settings.
 */
export async function updateWorkoutMetadata(
  userId: string,
  workoutId: string,
  updates: { workoutName?: string | null; workoutDescription?: string | null; workoutDetails?: string | null }
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const data: Record<string, unknown> = {}
  if ('workoutName' in updates) {
    data.workoutName =
      updates.workoutName != null && updates.workoutName.trim() !== ''
        ? updates.workoutName.trim()
        : null
  }
  if ('workoutDescription' in updates) {
    data.workoutDescription =
      updates.workoutDescription != null && updates.workoutDescription.trim() !== ''
        ? updates.workoutDescription.trim()
        : null
  }
  if ('workoutDetails' in updates) {
    data.workoutDetails =
      updates.workoutDetails != null && updates.workoutDetails.trim() !== ''
        ? updates.workoutDetails.trim()
        : null
  }
  if (Object.keys(data).length === 0) return
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workouts)
    .doc(workoutId)
  await ref.update(data)
  await pushWorkoutShareMirrors(userId, workoutId)
}

/** Allowed fields when updating a SingleSegmentWorkout (no meta settings). */
export type SingleSegmentUpdate = {
  workoutName?: string | null
  workoutDescription?: string | null
  workoutDetails?: string | null
  timerMode?: number
  workoutSchedule?: string | null
  direction?: boolean
  prelude?: number
  segue?: boolean
  warnings?: number[]
  metronome?: number
  restDirection?: number
  warningStrategy?: number
  continuity?: boolean
}

/** Update a SingleSegmentWorkout document with schedule and options. */
export async function updateWorkoutSingleSegment(
  userId: string,
  workoutId: string,
  updates: SingleSegmentUpdate
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workouts)
    .doc(workoutId)
  const data: Record<string, unknown> = {}
  if ('workoutName' in updates) data.workoutName = updates.workoutName ?? null
  if ('workoutDescription' in updates) data.workoutDescription = updates.workoutDescription ?? null
  if ('workoutDetails' in updates) data.workoutDetails = updates.workoutDetails ?? null
  if ('timerMode' in updates && typeof updates.timerMode === 'number') data.timerMode = updates.timerMode
  if ('workoutSchedule' in updates) data.workoutSchedule = updates.workoutSchedule ?? null
  if ('direction' in updates) data.direction = updates.direction === true
  if ('prelude' in updates) data.prelude = updates.prelude ?? -1
  if ('segue' in updates) data.segue = updates.segue === true
  if ('warnings' in updates) data.warnings = Array.isArray(updates.warnings) ? updates.warnings : []
  if ('metronome' in updates) data.metronome = typeof updates.metronome === 'number' ? updates.metronome : 0
  if ('restDirection' in updates) data.restDirection = typeof updates.restDirection === 'number' ? updates.restDirection : 0
  if ('warningStrategy' in updates) data.warningStrategy = typeof updates.warningStrategy === 'number' ? updates.warningStrategy : 0
  if ('continuity' in updates) data.continuity = updates.continuity === true
  if (Object.keys(data).length === 0) return
  await ref.update(data)
  await pushWorkoutShareMirrors(userId, workoutId)
}

/** Allowed fields when updating a MultiSegmentWorkout (no meta settings). */
export type MultiSegmentUpdate = {
  workoutName?: string | null
  workoutDescription?: string | null
  segments?: WorkoutSegment[]
  autoProgress?: boolean
  timerModes?: number[]
}

/** Update a MultiSegmentWorkout document (segments and options). */
export async function updateWorkoutMultiSegment(
  userId: string,
  workoutId: string,
  updates: MultiSegmentUpdate
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workouts)
    .doc(workoutId)
  const data: Record<string, unknown> = {}
  if ('workoutName' in updates) data.workoutName = updates.workoutName ?? null
  if ('workoutDescription' in updates) data.workoutDescription = updates.workoutDescription ?? null
  if ('segments' in updates && Array.isArray(updates.segments)) {
    data.segments = updates.segments.map((seg) => ({
      workoutId: seg.workoutId,
      workoutName: seg.workoutName ?? null,
      workoutDescription: seg.workoutDescription ?? null,
      workoutDetails: seg.workoutDetails ?? null,
      workoutImage: seg.workoutImage ?? null,
      workoutShareId: seg.workoutShareId ?? null,
      workoutSchedule: seg.workoutSchedule ?? null,
      prelude: typeof seg.prelude === 'number' ? seg.prelude : -1,
      segue: seg.segue === true,
      warnings: Array.isArray(seg.warnings) ? seg.warnings : [],
      metronome: typeof seg.metronome === 'number' ? seg.metronome : 0,
      direction: seg.direction === true,
      restDirection: typeof seg.restDirection === 'number' ? seg.restDirection : 0,
      warningStrategy: typeof seg.warningStrategy === 'number' ? seg.warningStrategy : 0,
      continuity: seg.continuity === true,
    }))
  }
  if ('autoProgress' in updates) data.autoProgress = updates.autoProgress === true
  if ('timerModes' in updates) data.timerModes = Array.isArray(updates.timerModes) ? updates.timerModes : []
  if (Object.keys(data).length === 0) return
  await ref.update(data)
  await pushWorkoutShareMirrors(userId, workoutId)
}

function mapPlanDayEntry(e: Record<string, unknown>): PlanDayEntry {
  const entryWorkoutId = typeof e.workoutId === 'string' ? e.workoutId : 'entry'
  const segmentsRaw = e.segments
  const segments: WorkoutSegment[] = Array.isArray(segmentsRaw)
    ? (segmentsRaw as Record<string, unknown>[]).map((seg, i) => mapSegmentFromEntry(seg, i, entryWorkoutId))
    : []
  const timerModes = Array.isArray(e.timerModes) ? (e.timerModes as number[]) : undefined
  return {
    continuity: e.continuity === true,
    direction: e.direction === true,
    metronome: typeof e.metronome === 'number' ? e.metronome : undefined,
    prelude: typeof e.prelude === 'number' ? e.prelude : undefined,
    restDirection: typeof e.restDirection === 'number' ? e.restDirection : undefined,
    segue: e.segue === true,
    timerMode: typeof e.timerMode === 'number' ? e.timerMode : undefined,
    type: typeof e.type === 'string' ? e.type : undefined,
    userId: typeof e.userId === 'string' ? e.userId : undefined,
    warningStrategy: typeof e.warningStrategy === 'number' ? e.warningStrategy : undefined,
    warnings: Array.isArray(e.warnings) ? (e.warnings as number[]) : undefined,
    workoutDescription: e.workoutDescription != null ? String(e.workoutDescription) : null,
    workoutDetails: e.workoutDetails != null ? String(e.workoutDetails) : null,
    workoutId: typeof e.workoutId === 'string' ? e.workoutId : undefined,
    workoutImage: e.workoutImage != null ? String(e.workoutImage) : null,
    workoutName: e.workoutName != null ? String(e.workoutName) : null,
    workoutSchedule: typeof e.workoutSchedule === 'string' ? e.workoutSchedule : undefined,
    workoutShareId: e.workoutShareId != null ? String(e.workoutShareId) : null,
    planId: typeof e.planId === 'string' ? e.planId : undefined,
    segments: segments.length > 0 ? segments : undefined,
    autoProgress: e.autoProgress === true,
    timerModes: timerModes?.length ? timerModes : undefined,
  }
}

function optionalParentGroupId(data: Record<string, unknown>): string | null {
  const v = data.parentGroupId
  if (v == null) return null
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t || null
}

/**
 * Owned hubs: `groups` where `ownerUserId` matches (iOS StorageManager `_ownedGroupsListener` query).
 * Excludes soft-deleted documents (`deletedAt`).
 */
export async function getOwnedGroupsForUser(userId: string): Promise<OwnedGroupFlat[]> {
  if (!adminDb) return []
  const snap = await adminDb.collection('groups').where('ownerUserId', '==', userId).get()
  const out: OwnedGroupFlat[] = []
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>
    if (parseDeletedAt(d)) continue
    const name = typeof d.name === 'string' ? d.name.trim() : ''
    if (!name) continue
    const handleRaw = d.handle
    const handleTrim = typeof handleRaw === 'string' ? handleRaw.trim() : ''
    const handle = handleTrim !== '' ? handleTrim : null
    const joinPolicy = parseFirestoreJoinPolicy(d.joinPolicy)
    const gtRaw = d.groupType
    const gt = typeof gtRaw === 'string' ? gtRaw.trim() : ''
    const groupType = gt && isAppGroupType(gt) ? gt : null
    out.push({
      groupId: doc.id,
      name,
      parentGroupId: optionalParentGroupId(d),
      groupType,
      handle,
      joinPolicy,
    })
  }
  return out
}

export type SoftDeletedOwnedGroupRow = {
  groupId: string
  name: string
  groupType: string | null
  deletedAt: string | null
}

/**
 * Owned hubs that are soft-deleted (`deletedAt` set), for recovery UI.
 */
export async function getSoftDeletedOwnedGroupsForUser(userId: string): Promise<SoftDeletedOwnedGroupRow[]> {
  if (!adminDb) return []
  const snap = await adminDb.collection('groups').where('ownerUserId', '==', userId).get()
  const out: SoftDeletedOwnedGroupRow[] = []
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>
    const deletedAt = parseDeletedAt(d)
    if (!deletedAt) continue
    const name = typeof d.name === 'string' ? d.name.trim() : ''
    const gtRaw = d.groupType
    const gt = typeof gtRaw === 'string' ? gtRaw.trim() : ''
    const groupType = gt && isAppGroupType(gt) ? gt : null
    out.push({
      groupId: doc.id,
      name: name || doc.id,
      groupType,
      deletedAt,
    })
  }
  out.sort((a, b) => {
    const ta = a.deletedAt ? Date.parse(a.deletedAt) : 0
    const tb = b.deletedAt ? Date.parse(b.deletedAt) : 0
    return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta)
  })
  return out
}
