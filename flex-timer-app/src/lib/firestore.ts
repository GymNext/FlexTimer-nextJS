import { randomUUID } from 'node:crypto'
import { DocumentSnapshot, FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import { USER_COLLECTIONS, type UserDataCounts, type PlanDay, type PlanDayEntry, type PlannedWorkout, type Workout, type WorkoutCollection, type WorkoutPlan, type WorkoutSegment, type WorkoutType } from '@/types/user'

export type WorkoutPlanSubscriptionStatus = 'pending' | 'active' | 'blocked'

export interface WorkoutPlanSubscriptionRecord {
  subscriptionDocumentId: string
  subscriberUserId: string
  ownerUserId: string
  remotePlanId: string
  status: WorkoutPlanSubscriptionStatus
  remotePlanName: string | null
  remotePlanHandle: string | null
  ordinal: number
  subscriberFullName: string | null
  subscriberPublicHandle: string | null
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
  return {
    subscriptionDocumentId: doc.id,
    subscriberUserId,
    ownerUserId,
    remotePlanId,
    status,
    remotePlanName: typeof d.remotePlanName === 'string' ? d.remotePlanName : null,
    remotePlanHandle: typeof d.remotePlanHandle === 'string' ? d.remotePlanHandle : null,
    ordinal: typeof d.ordinal === 'number' ? d.ordinal : 0,
    subscriberFullName: typeof d.subscriberFullName === 'string' ? d.subscriberFullName : null,
    subscriberPublicHandle: typeof d.subscriberPublicHandle === 'string' ? d.subscriberPublicHandle : null,
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

/** User document at users/<userId> (top-level fields). Settings come from users/<userId>/meta/<category>. */
export async function getUserDocument(
  userId: string
): Promise<{
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  publicHandle?: string | null
  basicBio?: string | null
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
    publicHandle: typeof d.publicHandle === 'string' ? d.publicHandle : null,
    basicBio: typeof d.basicBio === 'string' ? d.basicBio : null,
    hasConnectedToDisplay: typeof d.hasConnectedToDisplay === 'boolean' ? d.hasConnectedToDisplay : undefined,
    connectedToDisplayType: typeof d.connectedToDisplayType === 'string' ? d.connectedToDisplayType : null,
    classicEligibleOverride: typeof d.classicEligibleOverride === 'boolean' ? d.classicEligibleOverride : undefined,
    classicEligibleEffectiveDate: d.classicEligibleEffectiveDate,
    classicEligibleExpiryDate: d.classicEligibleExpiryDate,
    mergedUserIds: Array.isArray(d.mergedUserIds)
      ? (d.mergedUserIds as unknown[]).filter((id): id is string => typeof id === 'string')
      : undefined,
    settings: Object.keys(settings).length > 0 ? settings : undefined,
  }
}

export async function updateUserProfileFields(
  userId: string,
  updates: { publicHandle?: string | null; basicBio?: string | null }
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const patch: Record<string, unknown> = {}
  if ('publicHandle' in updates) {
    patch.publicHandle =
      updates.publicHandle != null && updates.publicHandle.trim() !== ''
        ? updates.publicHandle.trim()
        : null
  }
  if ('basicBio' in updates) {
    patch.basicBio =
      updates.basicBio != null && updates.basicBio.trim() !== ''
        ? updates.basicBio.trim()
        : null
  }
  if (Object.keys(patch).length === 0) return
  await adminDb.collection('users').doc(userId).update(patch)
}

function normalizePublicHandle(raw: string): string | null {
  let value = raw.trim().toLowerCase()
  if (value.startsWith('@')) value = value.slice(1)
  if (!value) return null
  if (value.length > 32) return null
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(value)) return null
  return value
}

export async function updateUserPublicHandle(userId: string, rawHandle: string | null): Promise<string | null> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const normalized = rawHandle == null ? null : normalizePublicHandle(rawHandle)
  if (rawHandle != null && normalized == null) {
    throw new Error('Handle must be 1-32 characters and use letters, numbers, ".", "_" or "-"')
  }
  const usersRef = adminDb.collection('users').doc(userId)
  const handleIndexRef = adminDb.collection('publicHandleIndex')
  const publicProfileRef = adminDb.collection('publicUserProfiles').doc(userId)
  const userSnap = await usersRef.get()
  const userData = userSnap.data() as Record<string, unknown> | undefined
  const previousRaw = typeof userData?.publicHandle === 'string' ? userData.publicHandle : null
  const previousNormalized = previousRaw ? normalizePublicHandle(previousRaw) : null

  await adminDb.runTransaction(async (tx) => {
    if (normalized) {
      const targetRef = handleIndexRef.doc(normalized)
      const targetSnap = await tx.get(targetRef)
      if (targetSnap.exists) {
        const ownerUserId = targetSnap.get('ownerUserId')
        if (typeof ownerUserId === 'string' && ownerUserId !== userId) {
          throw new Error('That handle is already taken')
        }
      }
      tx.set(
        targetRef,
        {
          ownerUserId: userId,
          handleKey: normalized,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    }

    tx.update(usersRef, { publicHandle: normalized })
    tx.set(
      publicProfileRef,
      {
        userId,
        publicHandle: normalized,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    if (previousNormalized && previousNormalized !== normalized) {
      tx.delete(handleIndexRef.doc(previousNormalized))
    }
  })

  return normalized
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
      privacy: typeof d.privacy === 'number' ? d.privacy : null,
      handle: typeof d.handle === 'string' ? d.handle : null,
      deletedAt: parseDeletedAt(d),
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
        const hay = `${item.subscriberFullName ?? ''} ${item.subscriberPublicHandle ?? ''} ${item.subscriberUserId}`.toLowerCase()
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
  const d = doc.data()!
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

/** Map a workout document snapshot to Workout (includes workoutSchedule, direction, segments for UIHelper-style display). */
function mapWorkoutDoc(doc: DocumentSnapshot): Workout | null {
  if (!doc.exists) return null
  const d = doc.data()!
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
    id: doc.id,
    type,
    userId: typeof d.userId === 'string' ? d.userId : '',
    workoutId: typeof d.workoutId === 'string' ? d.workoutId : doc.id,
    workoutShareId: typeof d.workoutShareId === 'string' ? d.workoutShareId : '',
    workoutName: d.workoutName ?? null,
    workoutDescription: d.workoutDescription ?? null,
    workoutDetails: (type === 'SingleSegmentWorkout' ? (raw.workoutDetails as string) : undefined) ?? null,
    workoutImage: d.workoutImage ?? null,
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
}

/** Permanently delete a workout document from users/<userId>/workouts/<workoutId>. */
export async function deleteWorkout(userId: string, workoutId: string): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
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
}

/** Permanently delete a workout collection document from users/<userId>/workoutCollections/<collectionId>. */
export async function deleteCollection(userId: string, collectionId: string): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
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
  if (typeof data.privacy === 'number') {
    patch.privacy = data.privacy
  }
  if ('handle' in data) {
    patch.handle = typeof data.handle === 'string' ? data.handle.trim() || null : null
    patch.handleNormalized = normalizeWorkoutPlanHandle(
      typeof data.handle === 'string' ? data.handle : null
    )
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
}

/** Permanently delete a workout plan: deletes all planDays subcollection docs, then the plan document. */
export async function deletePlan(userId: string, planId: string): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
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
  return created
}

/** Create a new workout plan under users/<userId>/workoutPlans. Returns the created plan. */
export async function createWorkoutPlan(
  userId: string,
  data: { name: string; description?: string | null; isPersonal?: boolean }
): Promise<WorkoutPlan> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const colRef = adminDb
    .collection('users')
    .doc(userId)
    .collection(USER_COLLECTIONS.workoutPlans)
  const id = randomUUID()
  const newRef = colRef.doc(id)
  await newRef.set({
    ordinal: 0,
    userId,
    isPersonal: data.isPersonal ?? true,
    workoutPlanId: id,
    workoutPlanName: data.name.trim() || 'Untitled plan',
    workoutPlanDescription: data.description?.trim() || null,
    privacy: 1, // private by default
    handle: null,
  })
  const created = await getPlanById(userId, id)
  if (!created) throw new Error('Failed to read created plan')
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
  const d = doc.data()!
  return {
    id: doc.id,
    isPersonal: d.isPersonal === true,
    ordinal: typeof d.ordinal === 'number' ? d.ordinal : 0,
    userId: typeof d.userId === 'string' ? d.userId : '',
    workoutPlanDescription: d.workoutPlanDescription ?? null,
    workoutPlanId: typeof d.workoutPlanId === 'string' ? d.workoutPlanId : '',
    workoutPlanName: typeof d.workoutPlanName === 'string' ? d.workoutPlanName : '',
    privacy: typeof d.privacy === 'number' ? d.privacy : null,
    handle: typeof d.handle === 'string' ? d.handle : null,
    deletedAt: parseDeletedAt(d),
  }
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
  toDate: string
): Promise<PlannedWorkout[]> {
  if (!adminDb) return []
  const startTs = Timestamp.fromDate(new Date(fromDate + 'T00:00:00.000Z'))
  const endTs = Timestamp.fromDate(new Date(toDate + 'T23:59:59.999Z'))
  const snapshot = await adminDb
    .collection('users')
    .doc(userId)
    .collection(PLANNED_WORKOUTS_COLLECTION)
    .where('planId', '==', planId)
    .where('day', '>=', startTs)
    .where('day', '<=', endTs)
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
  }
): Promise<PlannedWorkout> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const id = randomUUID()
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(PLANNED_WORKOUTS_COLLECTION)
    .doc(id)
  const dayTs = Timestamp.fromDate(new Date(params.day + 'T12:00:00.000Z'))
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

/** Update a planned workout's day and/or ordinal. day is YYYY-MM-DD; ordinal is a number (can be fractional for insert-between). */
export async function updatePlannedWorkoutDayAndOrdinal(
  userId: string,
  plannedWorkoutId: string,
  updates: { day?: string; ordinal?: number }
): Promise<void> {
  if (!adminDb) throw new Error('Firebase Admin not configured')
  const ref = adminDb
    .collection('users')
    .doc(userId)
    .collection(PLANNED_WORKOUTS_COLLECTION)
    .doc(plannedWorkoutId)
  const data: Record<string, unknown> = {}
  if (updates.day !== undefined) {
    data.day = Timestamp.fromDate(new Date(updates.day + 'T12:00:00.000Z'))
  }
  if (updates.ordinal !== undefined) {
    data.ordinal = updates.ordinal
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
