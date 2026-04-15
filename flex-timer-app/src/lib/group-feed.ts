import type { DocumentSnapshot, QueryDocumentSnapshot, QuerySnapshot } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import { canonicalSharedItemLive } from '@/lib/canonical-shared-item-live'
import {
  getCollectionById,
  getOwnedGroupsForUser,
  getPlanById,
  getWorkoutById,
} from '@/lib/firestore'
import {
  getCollectionDisplayDescription,
  getWorkoutBarColor,
  getWorkoutDetailDescription,
  getWorkoutDisplayName,
} from '@/lib/json-workout-format'
import type { WorkoutPlan } from '@/types/user'
import { listActiveMembershipGroupIds } from '@/lib/group-memberships'
import { workoutHasDirectGroupShareInHub } from '@/lib/shared-content-direct-workout-share'
import type {
  AppFeedGroupShareHeadline,
  AppFeedItemResponse,
  AppFeedItemType,
  AppFeedSharedResource,
  AppFeedSharePlanPersonalPresentation,
  AppFeedUserConnectPersonalPresentation,
} from '@/types/feed'

const GROUPS = 'groups'
/** Firestore `in` queries allow at most 30 values. */
const MAX_GROUP_IDS_PER_QUERY = 30
const FEED_SUBCOLLECTION = 'feed'
/** Personal feed rows under `users/{uid}/feed/*` (matches iOS `USER_FEED_OWNER_FIELD`). */
const USER_FEED_OWNER_FIELD = 'userFeedOwnerId'
/** Matches iOS `USER_FEED_SHARE_RECIPIENT_USER_ID_FIELD` on connection share feed rows. */
const SHARE_RECIPIENT_USER_ID_FIELD = 'shareRecipientUserId'
/** `orderBy('createdAt')` omits docs without that field; hub library reads must include all shares. */
const HUB_SHARED_LIBRARY_FEED_LIMIT = 800

function str(d: Record<string, unknown>, key: string): string {
  const v = d[key]
  return typeof v === 'string' ? v : ''
}

function parseCreatedAt(d: Record<string, unknown>): Date | null {
  const v = d.createdAt
  if (v == null) return null
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function')
    return (v as { toDate: () => Date }).toDate()
  if (typeof v === 'string' && v.trim()) {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : new Date(t)
  }
  return null
}

/** Map Firestore / iOS values to a canonical feed type (strings, ints, common enum names). */
function normalizeFeedTypeString(raw: string): AppFeedItemType {
  const t = raw.trim()
  if (!t) return 'unknown'
  const lower = t.toLowerCase()
  const alnum = lower.replace(/[\s_\-./]+/g, '')

  if (
    raw === 'sharePlan' ||
    raw === 'shareCollection' ||
    raw === 'shareWorkout' ||
    raw === 'joinGroup' ||
    raw === 'userJoin' ||
    raw === 'userLeave' ||
    raw === 'leaveGroup' ||
    raw === 'userConnect' ||
    raw === 'createGroup'
  ) {
    if (raw === 'userJoin') return 'joinGroup'
    if (raw === 'userLeave') return 'leaveGroup'
    return raw
  }
  if (alnum === 'shareplan' || alnum === 'planshared' || alnum === 'sharedplan') return 'sharePlan'
  if (
    alnum === 'sharecollection' ||
    alnum === 'collectionshared' ||
    alnum === 'sharedcollection' ||
    alnum === 'workoutcollectionshared'
  ) {
    return 'shareCollection'
  }
  if (alnum === 'shareworkout' || alnum === 'workoutshared' || alnum === 'sharedworkout') {
    return 'shareWorkout'
  }
  if (
    alnum === 'userjoin' ||
    alnum === 'joingroup' ||
    alnum === 'groupjoin' ||
    alnum === 'memberjoin' ||
    alnum === 'joinedgroup' ||
    alnum === 'hubjoin' ||
    alnum === 'joinhub'
  ) {
    return 'joinGroup'
  }
  if (
    alnum === 'userleave' ||
    alnum === 'leavegroup' ||
    alnum === 'groupleave' ||
    alnum === 'memberleave' ||
    alnum === 'leftgroup' ||
    alnum === 'hubbleave' ||
    alnum === 'leavehub' ||
    alnum === 'memberleft' ||
    alnum === 'userleft'
  ) {
    return 'leaveGroup'
  }
  if (
    alnum === 'userconnect' ||
    alnum === 'connectionmade' ||
    alnum === 'connected' ||
    alnum === 'connect'
  ) {
    return 'userConnect'
  }
  if (alnum === 'creategroup' || alnum === 'groupcreated' || alnum === 'hubcreated') {
    return 'createGroup'
  }

  if (lower.includes('share') && lower.includes('collection')) return 'shareCollection'
  if (lower.includes('share') && lower.includes('workout')) return 'shareWorkout'
  if (lower.includes('share') && lower.includes('plan')) return 'sharePlan'

  if (
    /\bleft\b/.test(lower) ||
    /\bleave\b/.test(lower) ||
    lower.includes('leavegroup') ||
    lower.includes('leftgroup') ||
    lower.includes('removedfromgroup')
  ) {
    return 'leaveGroup'
  }

  if (
    /\bjoined\b/.test(lower) ||
    /\bjoin\b/.test(lower) ||
    lower.includes('joingroup') ||
    lower.includes('newmember') ||
    lower.includes('becamemember')
  ) {
    return 'joinGroup'
  }

  return 'unknown'
}

function normalizeFeedTypeFromUnknown(v: unknown): AppFeedItemType {
  if (typeof v === 'string') return normalizeFeedTypeString(v)
  return 'unknown'
}

const FEED_TYPE_STRING_KEYS = [
  'actionType',
  'type',
  'feedType',
  'kind',
  'event',
  'eventType',
  'action',
  'itemType',
  'feedItemType',
  'activity',
  'category',
  'updateType',
  'feed_event',
] as const

function feedTypeFromBooleans(d: Record<string, unknown>): AppFeedItemType {
  const leaveish =
    d.isLeave === true ||
    d.didLeave === true ||
    d.leaveEvent === true ||
    d.memberLeft === true ||
    d.hasLeft === true
  const joinish =
    d.isJoin === true ||
    d.didJoin === true ||
    d.joinEvent === true ||
    d.memberJoined === true ||
    d.hasJoined === true
  if (leaveish && !joinish) return 'leaveGroup'
  if (joinish && !leaveish) return 'joinGroup'
  return 'unknown'
}

function feedTypeFromStatusStrings(d: Record<string, unknown>): AppFeedItemType {
  const keys = ['membershipStatus', 'memberStatus', 'membershipChange', 'change'] as const
  for (const k of keys) {
    const s = str(d, k).trim().toLowerCase()
    if (!s) continue
    if (s === 'left' || s === 'removed' || s === 'resigned' || s.includes('leave')) return 'leaveGroup'
    if (s === 'joined' || s === 'active' || s === 'added' || s.includes('join')) return 'joinGroup'
  }
  return 'unknown'
}

function feedTypeFromData(d: Record<string, unknown>, depth = 0): AppFeedItemType {
  if (depth > 2) return 'unknown'

  for (const k of FEED_TYPE_STRING_KEYS) {
    if (!(k in d)) continue
    const parsed = normalizeFeedTypeFromUnknown(d[k])
    if (parsed !== 'unknown') return parsed
  }

  const fromBool = feedTypeFromBooleans(d)
  if (fromBool !== 'unknown') return fromBool

  const fromStatus = feedTypeFromStatusStrings(d)
  if (fromStatus !== 'unknown') return fromStatus

  const nestedKeys = ['payload', 'feedItem', 'data', 'item', 'body'] as const
  for (const nk of nestedKeys) {
    const inner = d[nk]
    if (inner && typeof inner === 'object' && inner !== null && !Array.isArray(inner)) {
      const t = feedTypeFromData(inner as Record<string, unknown>, depth + 1)
      if (t !== 'unknown') return t
    }
  }

  return 'unknown'
}

function actorUserIdFromData(d: Record<string, unknown>): string {
  const keys = ['actorUserId', 'userId', 'createdByUserId', 'authorUserId', 'actorId'] as const
  for (const k of keys) {
    const v = str(d, k).trim()
    if (v) return v
  }
  return ''
}

function planNameFromData(d: Record<string, unknown>): string | null {
  const keys = [
    'planName',
    'workoutPlanName',
    'remotePlanName',
    'sharedPlanName',
  ] as const
  for (const k of keys) {
    const v = str(d, k).trim()
    if (v) return v
  }
  return null
}

function collectionNameFromData(d: Record<string, unknown>): string | null {
  const keys = [
    'collectionName',
    'workoutCollectionName',
    'sharedCollectionName',
    'remoteCollectionName',
  ] as const
  for (const k of keys) {
    const v = str(d, k).trim()
    if (v) return v
  }
  return null
}

function workoutNameFromData(d: Record<string, unknown>): string | null {
  const keys = ['workoutName', 'sharedWorkoutName', 'remoteWorkoutName', 'workoutTitle'] as const
  for (const k of keys) {
    const v = str(d, k).trim()
    if (v) return v
  }
  return null
}

const FEED_NESTED_OBJECT_KEYS = [
  'payload',
  'data',
  'feedItem',
  'item',
  'body',
  'sharedWorkoutPlan',
  'workoutPlan',
  'plan',
  'sharedWorkoutCollection',
  'workoutCollection',
  'sharedWorkout',
  'workout',
] as const

function collectFeedLayers(d: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [d]
  for (const nk of FEED_NESTED_OBJECT_KEYS) {
    const inner = d[nk]
    if (inner && typeof inner === 'object' && inner !== null && !Array.isArray(inner)) {
      out.push(inner as Record<string, unknown>)
    }
  }
  return out
}

function planNameFromFeedLayers(d: Record<string, unknown>): string | null {
  for (const layer of collectFeedLayers(d)) {
    const pn = planNameFromData(layer)
    if (pn?.trim()) return pn.trim()
  }
  return null
}

function collectionNameFromFeedLayers(d: Record<string, unknown>): string | null {
  for (const layer of collectFeedLayers(d)) {
    const n = collectionNameFromData(layer)
    if (n?.trim()) return n.trim()
  }
  return null
}

function workoutNameFromFeedLayers(d: Record<string, unknown>): string | null {
  for (const layer of collectFeedLayers(d)) {
    const n = workoutNameFromData(layer)
    if (n?.trim()) return n.trim()
  }
  return null
}

/** Plan document id under users/<owner>/workoutPlans/<id>. */
function planIdFromFeedDoc(d: Record<string, unknown>): string {
  const keys = [
    'remotePlanId',
    'planId',
    'planID',
    'workoutPlanId',
    'workoutPlanID',
    'sharedPlanId',
    'workoutPlanDocumentId',
    'workoutPlanUUID',
    'planUUID',
    'uuid',
    'workout_plan_id',
    'plan_id',
    'objectId',
    'sharedObjectId',
    'resourceId',
  ] as const
  for (const k of keys) {
    const v = str(d, k).trim()
    if (v) return v
  }
  return ''
}

/** Workout collection document id under users/<owner>/workoutCollections/<id>. */
function collectionIdFromFeedDoc(d: Record<string, unknown>): string {
  const keys = [
    'collectionId',
    'workoutCollectionId',
    'remoteCollectionId',
    'sharedCollectionId',
    'workoutCollectionDocumentId',
    'collection_id',
    'workout_collection_id',
    'objectId',
    'sharedObjectId',
    'resourceId',
  ] as const
  for (const k of keys) {
    const v = str(d, k).trim()
    if (v) return v
  }
  return ''
}

/** Workout document id under users/<owner>/workouts/<id>. */
function workoutIdFromFeedDoc(d: Record<string, unknown>): string {
  const keys = [
    'workoutId',
    'remoteWorkoutId',
    'sharedWorkoutId',
    'workoutDocumentId',
    'workoutUUID',
    'workout_id',
    'objectId',
    'sharedObjectId',
    'resourceId',
  ] as const
  for (const k of keys) {
    const v = str(d, k).trim()
    if (v) return v
  }
  return ''
}

function extractFirestoreRefPath(v: unknown): string {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (v && typeof v === 'object' && v !== null && 'path' in v) {
    const p = (v as { path?: unknown }).path
    if (typeof p === 'string' && p.trim()) return p.trim()
  }
  return ''
}

/** Parses users/<uid>/workoutPlans/<planDocId> from a reference path (with or without project prefix). */
function parseUserWorkoutPlanPath(raw: string): { ownerId: string; planId: string } | null {
  if (!raw) return null
  const relative = raw.includes('/documents/')
    ? raw.replace(/^.*\/documents\//, '')
    : raw
  const m = relative.match(/users\/([^/]+)\/workoutPlans\/([^/]+)/i)
  if (!m?.[1] || !m?.[2]) return null
  return { ownerId: m[1], planId: m[2] }
}

/** Parses users/<uid>/workoutCollections/<collectionDocId> from a reference path. */
function parseUserWorkoutCollectionPath(raw: string): { ownerId: string; collectionId: string } | null {
  if (!raw) return null
  const relative = raw.includes('/documents/')
    ? raw.replace(/^.*\/documents\//, '')
    : raw
  const m = relative.match(/users\/([^/]+)\/workoutCollections\/([^/]+)/i)
  if (!m?.[1] || !m?.[2]) return null
  return { ownerId: m[1], collectionId: m[2] }
}

/** Parses users/<uid>/workouts/<workoutDocId> from a reference path. */
function parseUserWorkoutPath(raw: string): { ownerId: string; workoutId: string } | null {
  if (!raw) return null
  const relative = raw.includes('/documents/')
    ? raw.replace(/^.*\/documents\//, '')
    : raw
  const m = relative.match(/users\/([^/]+)\/workouts\/([^/]+)/i)
  if (!m?.[1] || !m?.[2]) return null
  return { ownerId: m[1], workoutId: m[2] }
}

const WORKOUT_PLAN_REF_KEYS = [
  'workoutPlanRef',
  'planRef',
  'workoutPlanReference',
  'resourceRef',
  'planDocumentRef',
  'workoutPlanDocumentRef',
  'documentRef',
  'objectRef',
] as const

const WORKOUT_COLLECTION_REF_KEYS = [
  'workoutCollectionRef',
  'collectionRef',
  'workoutCollectionReference',
  'collectionDocumentRef',
  'workoutCollectionDocumentRef',
  'resourceRef',
  'documentRef',
  'objectRef',
] as const

const WORKOUT_DOC_REF_KEYS = [
  'workoutRef',
  'sharedWorkoutRef',
  'workoutReference',
  'workoutDocumentRef',
  'resourceRef',
  'documentRef',
  'objectRef',
] as const

/** User id of the plan owner (may differ from the actor who posted the feed item). */
function planOwnerUserIdFromFeedDoc(d: Record<string, unknown>): string | null {
  const keys = [
    'ownerUserId',
    'planOwnerUserId',
    'workoutPlanOwnerUserId',
    'workoutPlanUserId',
    'planUserId',
    'remoteOwnerUserId',
    'sourceUserId',
    'sharedFromUserId',
    'profileUserId',
  ] as const
  for (const k of keys) {
    const v = str(d, k).trim()
    if (v) return v
  }
  return null
}

/**
 * UIDs that might own the shared resource, collected from root + nested feed payload layers.
 * iOS/other clients often put the library owner only under nested keys, or use `userId` for the owner not the actor.
 */
const RESOURCE_OWNER_CANDIDATE_KEYS = [
  'ownerUserId',
  'workoutOwnerUserId',
  'workoutUserId',
  'sourceWorkoutUserId',
  'planOwnerUserId',
  'workoutPlanOwnerUserId',
  'workoutPlanUserId',
  'planUserId',
  'remoteOwnerUserId',
  'sourceUserId',
  'sharedFromUserId',
  'profileUserId',
  'actorUserId',
  'actorId',
  'authorUserId',
  'createdByUserId',
  'publisherUserId',
  'sharerUserId',
  'sharedByUserId',
  'fromUserId',
  'senderUserId',
  'memberUserId',
  'userId',
] as const

/**
 * Walk into nested maps for feed parsing. Reject arrays, Timestamps, GeoPoint, DocumentReference, etc.
 * (Swift/Firestore sometimes uses class instances that are not `Object.create(null)`.)
 */
function shouldWalkIntoNestedMap(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const r = v as Record<string, unknown>
  if (typeof r.toDate === 'function') return false
  const ctor = (v as { constructor?: { name?: string } }).constructor?.name ?? ''
  if (
    ctor === 'DocumentReference' ||
    ctor === 'GeoPoint' ||
    ctor === 'VectorValue' ||
    ctor === 'Timestamp'
  ) {
    return false
  }
  return true
}

/**
 * Recursively walk feed payloads so nested `payload.user.workoutRef`-style fields are visible.
 * Shallow `collectFeedLayers` misses most iOS-structured share events.
 */
function collectFeedLayersDeep(root: Record<string, unknown>, maxDepth = 8): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const seen = new WeakSet<object>()
  function walk(node: Record<string, unknown>, depth: number) {
    if (depth > maxDepth || seen.has(node)) return
    seen.add(node)
    out.push(node)
    for (const v of Object.values(node)) {
      if (!shouldWalkIntoNestedMap(v)) continue
      walk(v, depth + 1)
    }
  }
  walk(root, 0)
  return out
}

function scanFirestorePathsFromLayers(layers: readonly Record<string, unknown>[]): string[] {
  const paths: string[] = []
  for (const layer of layers) {
    for (const v of Object.values(layer)) {
      if (typeof v === 'string' && v.trim()) paths.push(v.trim())
      else {
        const p = extractFirestoreRefPath(v)
        if (p) paths.push(p)
      }
    }
  }
  return paths
}

function collectResourceOwnerCandidates(d: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const layer of collectFeedLayersDeep(d)) {
    for (const k of RESOURCE_OWNER_CANDIDATE_KEYS) {
      const v = str(layer, k).trim()
      if (v) out.push(v)
    }
  }
  return [...new Set(out)]
}

function planNameFromFeedLayersDeep(d: Record<string, unknown>): string | null {
  for (const layer of collectFeedLayersDeep(d)) {
    const pn = planNameFromData(layer)
    if (pn?.trim()) return pn.trim()
  }
  return null
}

function collectionNameFromFeedLayersDeep(d: Record<string, unknown>): string | null {
  for (const layer of collectFeedLayersDeep(d)) {
    const n = collectionNameFromData(layer)
    if (n?.trim()) return n.trim()
  }
  return null
}

function workoutNameFromFeedLayersDeep(d: Record<string, unknown>): string | null {
  for (const layer of collectFeedLayersDeep(d)) {
    const n = workoutNameFromData(layer)
    if (n?.trim()) return n.trim()
  }
  return null
}

/**
 * Infer share kind from refs, serialized paths, and id fields. Used for hub shared library only.
 * Workout refs/paths are checked before plan/collection so mixed payloads classify as workout shares when appropriate.
 */
function inferShareKindFromRefsAndIdsDeep(d: Record<string, unknown>): AppFeedItemType {
  const layers = collectFeedLayersDeep(d)
  for (const layer of layers) {
    for (const k of WORKOUT_DOC_REF_KEYS) {
      const p = extractFirestoreRefPath(layer[k])
      if (parseUserWorkoutPath(p)) return 'shareWorkout'
    }
    for (const k of WORKOUT_COLLECTION_REF_KEYS) {
      if (parseUserWorkoutCollectionPath(extractFirestoreRefPath(layer[k]))) return 'shareCollection'
    }
    for (const k of WORKOUT_PLAN_REF_KEYS) {
      if (parseUserWorkoutPlanPath(extractFirestoreRefPath(layer[k]))) return 'sharePlan'
    }
  }
  for (const path of scanFirestorePathsFromLayers(layers)) {
    if (parseUserWorkoutPath(path)) return 'shareWorkout'
    if (parseUserWorkoutCollectionPath(path)) return 'shareCollection'
    if (parseUserWorkoutPlanPath(path)) return 'sharePlan'
  }

  let hasPlanId = false
  let hasCollId = false
  let hasWorkoutId = false
  for (const layer of layers) {
    if (planIdFromFeedDoc(layer)) hasPlanId = true
    if (collectionIdFromFeedDoc(layer)) hasCollId = true
    if (workoutIdFromFeedDoc(layer)) hasWorkoutId = true
  }
  if (hasWorkoutId && !hasPlanId && !hasCollId) return 'shareWorkout'
  if (hasCollId && !hasPlanId && !hasWorkoutId) return 'shareCollection'
  if (hasPlanId && !hasCollId && !hasWorkoutId) return 'sharePlan'
  if (hasWorkoutId && hasPlanId) {
    const wn = workoutNameFromFeedLayersDeep(d)
    const pn = planNameFromFeedLayersDeep(d)
    if (wn && !pn) return 'shareWorkout'
    if (pn && !wn) return 'sharePlan'
    return 'shareWorkout'
  }
  if (hasWorkoutId && hasCollId) return 'shareWorkout'
  if (hasPlanId && hasCollId && !hasWorkoutId) {
    const cn = collectionNameFromFeedLayersDeep(d)
    const pn = planNameFromFeedLayersDeep(d)
    if (cn && !pn) return 'shareCollection'
    if (pn && !cn) return 'sharePlan'
    return 'shareCollection'
  }
  return 'unknown'
}

/** First users/{uid}/workouts/{id} pair found on ref keys or string paths (most reliable owner for shares). */
function firstUserWorkoutPathFromFeedDoc(d: Record<string, unknown>): { ownerId: string; workoutId: string } | null {
  const layers = collectFeedLayersDeep(d)
  for (const layer of layers) {
    for (const k of WORKOUT_DOC_REF_KEYS) {
      const loc = parseUserWorkoutPath(extractFirestoreRefPath(layer[k]))
      if (loc) return { ownerId: loc.ownerId, workoutId: loc.workoutId }
    }
  }
  for (const path of scanFirestorePathsFromLayers(layers)) {
    const loc = parseUserWorkoutPath(path)
    if (loc) return { ownerId: loc.ownerId, workoutId: loc.workoutId }
  }
  return null
}

function firstUserWorkoutPlanPathFromFeedDoc(d: Record<string, unknown>): { ownerId: string; planId: string } | null {
  const layers = collectFeedLayersDeep(d)
  for (const layer of layers) {
    for (const k of WORKOUT_PLAN_REF_KEYS) {
      const loc = parseUserWorkoutPlanPath(extractFirestoreRefPath(layer[k]))
      if (loc) return { ownerId: loc.ownerId, planId: loc.planId }
    }
  }
  for (const path of scanFirestorePathsFromLayers(layers)) {
    const loc = parseUserWorkoutPlanPath(path)
    if (loc) return { ownerId: loc.ownerId, planId: loc.planId }
  }
  return null
}

function firstUserWorkoutCollectionPathFromFeedDoc(
  d: Record<string, unknown>,
): { ownerId: string; collectionId: string } | null {
  const layers = collectFeedLayersDeep(d)
  for (const layer of layers) {
    for (const k of WORKOUT_COLLECTION_REF_KEYS) {
      const loc = parseUserWorkoutCollectionPath(extractFirestoreRefPath(layer[k]))
      if (loc) return { ownerId: loc.ownerId, collectionId: loc.collectionId }
    }
  }
  for (const path of scanFirestorePathsFromLayers(layers)) {
    const loc = parseUserWorkoutCollectionPath(path)
    if (loc) return { ownerId: loc.ownerId, collectionId: loc.collectionId }
  }
  return null
}

/**
 * Classify feed rows for hub shared library. Share payloads often embed `memberStatus: 'active'` or similar;
 * `feedTypeFromData` would mislabel those as joinGroup unless we detect share structure first.
 */
function inferShareTypeForHubLibrary(d: Record<string, unknown>): AppFeedItemType {
  const t = feedTypeFromData(d)
  if (t === 'sharePlan' || t === 'shareCollection' || t === 'shareWorkout') return t
  if (t === 'createGroup' || t === 'joinGroup' || t === 'leaveGroup' || t === 'userConnect') return t

  const inferred = inferShareKindFromRefsAndIdsDeep(d)
  if (inferred !== 'unknown') return inferred

  return t
}

function actorNameFromFeedDoc(d: Record<string, unknown>): string | null {
  const keys = [
    'actorDisplayName',
    'actorName',
    'userDisplayName',
    'userName',
    'displayName',
    'fullName',
  ] as const
  for (const k of keys) {
    const v = str(d, k).trim()
    if (v) return v
  }
  return null
}

const MAX_SHARE_COMMENT_LENGTH = 4000

const SHARE_FEED_TYPES: ReadonlySet<AppFeedItemType> = new Set([
  'sharePlan',
  'shareCollection',
  'shareWorkout',
])

function commentFromFeedDoc(d: Record<string, unknown>): string | null {
  const keys = [
    'shareComment',
    'comment',
    'comments',
    'message',
    'shareMessage',
    'caption',
    'body',
    'note',
    'text',
    'content',
    'userComment',
    'remarks',
    'details',
  ] as const
  for (const k of keys) {
    const top = str(d, k).trim()
    if (top) {
      return top.length > MAX_SHARE_COMMENT_LENGTH ? `${top.slice(0, MAX_SHARE_COMMENT_LENGTH)}…` : top
    }
  }
  for (const layer of collectFeedLayersDeep(d)) {
    for (const k of keys) {
      const v = str(layer, k).trim()
      if (v) {
        return v.length > MAX_SHARE_COMMENT_LENGTH ? `${v.slice(0, MAX_SHARE_COMMENT_LENGTH)}…` : v
      }
    }
  }
  const cm = d.comments as unknown
  if (Array.isArray(cm)) {
    for (const item of cm) {
      if (typeof item === 'string' && item.trim()) {
        const t = item.trim()
        return t.length > MAX_SHARE_COMMENT_LENGTH ? `${t.slice(0, MAX_SHARE_COMMENT_LENGTH)}…` : t
      }
      if (shouldWalkIntoNestedMap(item)) {
        const o = item as Record<string, unknown>
        const t = str(o, 'text').trim() || str(o, 'body').trim()
        if (t) return t.length > MAX_SHARE_COMMENT_LENGTH ? `${t.slice(0, MAX_SHARE_COMMENT_LENGTH)}…` : t
      }
    }
  }
  return null
}

function displayNameFromUserDoc(
  userId: string,
  u: {
    firstName?: string | null
    lastName?: string | null
    handle?: string | null
    email?: string | null
  } | null
): string {
  if (!u) return 'Someone'
  const first = (u.firstName ?? '').trim()
  const last = (u.lastName ?? '').trim()
  const combined = [first, last].filter(Boolean).join(' ').trim()
  if (combined) return combined
  const h = (u.handle ?? '').trim()
  if (h) return h.startsWith('@') ? h : `@${h}`
  const em = (u.email ?? '').trim()
  if (em && em.includes('@')) return em.split('@')[0] ?? 'Someone'
  return 'Someone'
}

function shareResourceKindFromType(type: AppFeedItemType): 'plan' | 'collection' | 'workout' | null {
  if (type === 'sharePlan') return 'plan'
  if (type === 'shareCollection') return 'collection'
  if (type === 'shareWorkout') return 'workout'
  return null
}

function shareObjectNoun(kind: 'plan' | 'collection' | 'workout'): string {
  if (kind === 'collection') return 'collection'
  if (kind === 'workout') return 'workout'
  return 'plan'
}

function buildSharePlanPersonalPresentation(
  viewerUid: string,
  d: Record<string, unknown>,
  users: Map<string, { displayName: string; profilePhotoUrl: string | null }>,
  type: AppFeedItemType
): AppFeedSharePlanPersonalPresentation | null {
  const resourceKind = shareResourceKindFromType(type)
  if (!resourceKind) return null
  const actorId = actorUserIdFromData(d)
  if (!actorId) return null
  const shareRecipient = str(d, SHARE_RECIPIENT_USER_ID_FIELD).trim()
  const legacyPeer = str(d, 'peerUserId').trim()
  const peerRaw =
    shareRecipient && shareRecipient !== viewerUid
      ? shareRecipient
      : legacyPeer && legacyPeer !== viewerUid
        ? legacyPeer
        : ''

  if (actorId === viewerUid) {
    const otherId = peerRaw
    if (!otherId) return null
    const profileDisplayName = users.get(otherId)?.displayName ?? 'Someone'
    return {
      variant: 'you_shared_with',
      profileUserId: otherId,
      profileDisplayName,
      resourceKind,
    }
  }
  const profileDisplayName = users.get(actorId)?.displayName ?? 'Someone'
  return {
    variant: 'peer_shared',
    profileUserId: actorId,
    profileDisplayName,
    resourceKind,
  }
}

function buildFeedTitle(
  type: AppFeedItemType,
  actorName: string,
  scope: 'group' | 'personal' = 'group',
  hubDisplayName?: string | null,
): string {
  const hub = hubDisplayName?.trim()
  switch (type) {
    case 'sharePlan':
      return `${actorName} shared a plan`
    case 'shareCollection':
      return `${actorName} shared a collection`
    case 'shareWorkout':
      return `${actorName} shared a workout`
    case 'joinGroup':
      return hub ? `${actorName} joined ${hub}` : `${actorName} joined this hub`
    case 'leaveGroup':
      return hub ? `${actorName} left ${hub}` : `${actorName} left this hub`
    case 'userConnect':
      return `${actorName} connected`
    case 'createGroup':
      return `${actorName} created this hub`
    default:
      return scope === 'personal' ? `${actorName} had activity` : `${actorName} updated the Hub`
  }
}

/** Hub feed: when the signed-in user is the sharer, use second person instead of repeating their name. */
function buildGroupFeedTitleForViewer(
  type: AppFeedItemType,
  actorName: string,
  viewerUserId: string,
  actorUserId: string,
  hubDisplayName: string,
): string {
  const hub = hubDisplayName.trim() || 'this hub'
  if (
    actorUserId === viewerUserId &&
    (type === 'sharePlan' || type === 'shareCollection' || type === 'shareWorkout')
  ) {
    if (type === 'sharePlan') return 'You shared a plan'
    if (type === 'shareCollection') return 'You shared a collection'
    if (type === 'shareWorkout') return 'You shared a workout'
  }
  if (type === 'createGroup' && actorUserId === viewerUserId) {
    return 'You created this hub'
  }
  if (type === 'joinGroup' && actorUserId === viewerUserId) {
    return `You joined ${hub}`
  }
  if (type === 'leaveGroup' && actorUserId === viewerUserId) {
    return `You left ${hub}`
  }
  return buildFeedTitle(type, actorName, 'group', hub)
}

function deletedGroup(data: Record<string, unknown>): boolean {
  return data.deletedAt != null
}

/** v1: single group-feed doc path (legacy). v2: optional `g` + `p` last-seen paths for merged hub + personal feeds. */
export type FeedCursorPayload =
  | { v: 1; p: string }
  | { v: 2; g?: string; p?: string }

export type DecodedFeedCursor = {
  groupPath: string | null
  personalPath: string | null
}

/**
 * Decode pagination cursor. Missing/empty cursor → start both streams from the top.
 * Invalid payload when `raw` is non-empty → null (caller should treat as bad cursor).
 */
export function decodeFeedCursor(raw: string | null): DecodedFeedCursor | null {
  if (raw == null || raw === '') {
    return { groupPath: null, personalPath: null }
  }
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8')
    const o = JSON.parse(json) as FeedCursorPayload & { v?: number; p?: string; g?: string }
    if (o?.v === 1 && typeof o.p === 'string' && o.p.trim()) {
      return { groupPath: o.p.trim(), personalPath: null }
    }
    if (o?.v === 2) {
      return {
        groupPath: typeof o.g === 'string' && o.g.trim() ? o.g.trim() : null,
        personalPath: typeof o.p === 'string' && o.p.trim() ? o.p.trim() : null,
      }
    }
    return null
  } catch {
    return null
  }
}

export function encodeCombinedFeedCursor(groupPath: string | null, personalPath: string | null): string {
  const payload: { v: 2; g?: string; p?: string } = { v: 2 }
  const g = groupPath?.trim()
  const p = personalPath?.trim()
  if (g) payload.g = g
  if (p) payload.p = p
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function isFeedDocPath(path: string, allowedGroupIds: Set<string>): boolean {
  const parts = path.split('/')
  // groups/{groupId}/feed/{docId}
  if (parts.length !== 4 || parts[0] !== GROUPS || parts[2] !== FEED_SUBCOLLECTION) return false
  return allowedGroupIds.has(parts[1])
}

/**
 * Union of owned hub IDs and active membership group IDs, sorted, capped for Firestore `in` queries.
 */
export async function getFeedQueryGroupIds(userId: string): Promise<{
  queriedIds: string[]
  eligibleGroupCount: number
  truncatedGroups: boolean
}> {
  const [owned, memberIds] = await Promise.all([
    getOwnedGroupsForUser(userId),
    listActiveMembershipGroupIds(userId),
  ])
  const set = new Set<string>()
  for (const o of owned) set.add(o.groupId)
  for (const m of memberIds) set.add(m)
  const sorted = [...set].sort()
  const eligibleGroupCount = sorted.length
  const truncatedGroups = sorted.length > MAX_GROUP_IDS_PER_QUERY
  const queriedIds = sorted.slice(0, MAX_GROUP_IDS_PER_QUERY)
  return { queriedIds, eligibleGroupCount, truncatedGroups }
}

async function batchGetGroupNames(groupIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const db = adminDb
  if (!db || groupIds.length === 0) return out
  const unique = [...new Set(groupIds)]
  for (let i = 0; i < unique.length; i += 10) {
    const slice = unique.slice(i, i + 10)
    const refs = slice.map((id) => db.collection(GROUPS).doc(id))
    const snaps = await db.getAll(...refs)
    for (const snap of snaps) {
      if (!snap.exists) continue
      const d = snap.data() as Record<string, unknown>
      if (deletedGroup(d)) continue
      const name = str(d, 'name').trim()
      out.set(snap.id, name || 'Hub')
    }
  }
  return out
}

async function batchGetUserSummaries(
  userIds: string[]
): Promise<Map<string, { displayName: string; profilePhotoUrl: string | null }>> {
  const out = new Map<string, { displayName: string; profilePhotoUrl: string | null }>()
  const db = adminDb
  if (!db || userIds.length === 0) return out
  const unique = [...new Set(userIds)]
  for (let i = 0; i < unique.length; i += 10) {
    const slice = unique.slice(i, i + 10)
    const refs = slice.map((id) => db.collection('users').doc(id))
    const snaps = await db.getAll(...refs)
    for (const snap of snaps) {
      if (!snap.exists) continue
      const d = snap.data() as Record<string, unknown>
      const firstName = typeof d.firstName === 'string' ? d.firstName : null
      const lastName = typeof d.lastName === 'string' ? d.lastName : null
      const handle = typeof d.handle === 'string' ? d.handle : null
      const email = typeof d.email === 'string' ? d.email : null
      const profilePhotoUrl =
        typeof d.profilePhotoUrl === 'string' && d.profilePhotoUrl.trim() !== ''
          ? d.profilePhotoUrl.trim()
          : null
      const displayName = displayNameFromUserDoc(snap.id, { firstName, lastName, handle, email })
      out.set(snap.id, { displayName, profilePhotoUrl })
    }
  }
  return out
}

function mapDocToItem(
  doc: QueryDocumentSnapshot,
  viewerUserId: string,
  groupNames: Map<string, string>,
  users: Map<string, { displayName: string; profilePhotoUrl: string | null }>
): AppFeedItemResponse | null {
  const d = doc.data() as Record<string, unknown>
  const groupId = str(d, 'groupId').trim() || doc.ref.parent.parent?.id || ''
  if (!groupId) return null
  const createdAt = parseCreatedAt(d)
  if (!createdAt) return null
  const type = feedTypeFromData(d)
  const actorId = actorUserIdFromData(d)
  if (!actorId) return null
  const groupName = groupNames.get(groupId) ?? 'Hub'
  const fromDoc = actorNameFromFeedDoc(d)
  const fromUser = users.get(actorId)
  const actorDisplayName = fromDoc && fromDoc.length > 0 ? fromDoc : (fromUser?.displayName ?? 'Someone')
  const actorPhotoUrl = fromUser?.profilePhotoUrl ?? null
  const title = buildGroupFeedTitleForViewer(type, actorDisplayName, viewerUserId, actorId, groupName)
  const resourceKind = shareResourceKindFromType(type)
  const groupShareHeadline: AppFeedGroupShareHeadline | undefined =
    resourceKind && actorId !== viewerUserId
      ? {
          profileUserId: actorId,
          profileDisplayName: actorDisplayName,
          resourceKind,
        }
      : undefined
  return {
    id: doc.id,
    groupId,
    groupName,
    type,
    createdAt: createdAt.toISOString(),
    title,
    actorUserId: actorId,
    actorDisplayName,
    actorPhotoUrl: actorPhotoUrl,
    ...(groupShareHeadline ? { groupShareHeadline } : {}),
    planName: null,
    collectionName: null,
    workoutName: null,
  }
}

function isPersonalFeedDocPath(path: string, userId: string): boolean {
  const parts = path.split('/')
  return (
    parts.length === 4 &&
    parts[0] === 'users' &&
    parts[1] === userId &&
    parts[2] === FEED_SUBCOLLECTION
  )
}

/** Descending merge order: newer (larger time) first; tie-break by document path. */
function compareFeedDocsDesc(a: QueryDocumentSnapshot, b: QueryDocumentSnapshot): number {
  const ta = parseCreatedAt(a.data() as Record<string, unknown>)?.getTime() ?? -1
  const tb = parseCreatedAt(b.data() as Record<string, unknown>)?.getTime() ?? -1
  if (ta !== tb) return tb - ta
  return a.ref.path.localeCompare(b.ref.path)
}

function mapPersonalFeedDocToItem(
  doc: QueryDocumentSnapshot,
  userId: string,
  users: Map<string, { displayName: string; profilePhotoUrl: string | null }>
): AppFeedItemResponse | null {
  if (!isPersonalFeedDocPath(doc.ref.path, userId)) return null
  const d = doc.data() as Record<string, unknown>
  const owner = str(d, USER_FEED_OWNER_FIELD).trim()
  if (owner && owner !== userId) return null
  const createdAt = parseCreatedAt(d)
  if (!createdAt) return null
  const type = feedTypeFromData(d)
  const actorId = actorUserIdFromData(d)
  if (!actorId) return null
  const fromDoc = actorNameFromFeedDoc(d)
  const fromUser = users.get(actorId)
  let actorDisplayName = fromDoc && fromDoc.length > 0 ? fromDoc : (fromUser?.displayName ?? 'Someone')
  let actorPhotoUrl = fromUser?.profilePhotoUrl ?? null
  const sharePlanPersonal = buildSharePlanPersonalPresentation(userId, d, users, type)

  let userConnectPersonal: AppFeedUserConnectPersonalPresentation | null = null
  let title: string
  if (sharePlanPersonal) {
    const noun = shareObjectNoun(sharePlanPersonal.resourceKind)
    title =
      sharePlanPersonal.variant === 'you_shared_with'
        ? `You shared a ${noun} with ${sharePlanPersonal.profileDisplayName}`
        : `${sharePlanPersonal.profileDisplayName} shared a ${noun} with you`
  } else if (type === 'userConnect') {
    /** Same headline for inviter / accepter / iOS-shaped rows: always the other person “connected with you”. */
    const otherUserId = actorId !== userId ? actorId : str(d, 'peerUserId').trim() || str(d, 'objectId').trim()
    if (!otherUserId) {
      title = 'You connected'
    } else {
      const otherSummary = users.get(otherUserId)
      const otherName =
        actorId !== userId && fromDoc && fromDoc.length > 0
          ? fromDoc
          : otherSummary?.displayName?.trim() || 'Someone'
      userConnectPersonal = {
        variant: 'peer_connected_with_you',
        profileUserId: otherUserId,
        profileDisplayName: otherName,
      }
      title = `${otherName} connected with you`
    }
  } else {
    const personalHubName = str(d, 'groupName').trim()
    title = buildFeedTitle(type, actorDisplayName, 'personal', personalHubName || null)
  }
  /** Connect rows: avatar / initial always reflect the other person (iOS uses owner as actor on both sides). */
  if (type === 'userConnect' && userConnectPersonal) {
    const otherUser = users.get(userConnectPersonal.profileUserId)
    actorPhotoUrl = otherUser?.profilePhotoUrl ?? null
    actorDisplayName =
      userConnectPersonal.profileDisplayName?.trim() ||
      otherUser?.displayName?.trim() ||
      actorDisplayName
  }
  return {
    id: doc.id,
    groupId: '',
    groupName: 'Connection',
    type,
    createdAt: createdAt.toISOString(),
    title,
    actorUserId: actorId,
    actorDisplayName,
    actorPhotoUrl,
    ...(sharePlanPersonal ? { sharePlanPersonalPresentation: sharePlanPersonal } : {}),
    ...(userConnectPersonal ? { userConnectPersonalPresentation: userConnectPersonal } : {}),
    planName: null,
    collectionName: null,
    workoutName: null,
  }
}

function mapMergedFeedDoc(
  doc: QueryDocumentSnapshot,
  userId: string,
  allowed: Set<string>,
  groupNames: Map<string, string>,
  users: Map<string, { displayName: string; profilePhotoUrl: string | null }>
): AppFeedItemResponse | null {
  if (isPersonalFeedDocPath(doc.ref.path, userId)) {
    return mapPersonalFeedDocToItem(doc, userId, users)
  }
  const d = doc.data() as Record<string, unknown>
  const gid = str(d, 'groupId').trim() || doc.ref.parent.parent?.id || ''
  if (!gid || !allowed.has(gid)) return null
  if (!groupNames.has(gid)) return null
  return mapDocToItem(doc, userId, groupNames, users)
}

/**
 * Hub activity from `groups/{id}/feed` (membership scope) merged with personal `users/{uid}/feed`
 * (direct shares, connection events), newest first — aligned with iOS `fetchCommunityGroupFeedBatch` +
 * `fetchCommunityUserFeedBatch`.
 */
export async function loadAppFeedPage(options: {
  userId: string
  cursor: string | null
  pageSize: number
}): Promise<{
  items: AppFeedItemResponse[]
  nextCursor: string | null
  hasMore: boolean
  truncatedGroups: boolean
  eligibleGroupCount: number
  queriedGroupCount: number
}> {
  const db = adminDb
  const pageSize = Math.min(50, Math.max(1, options.pageSize))
  const uid = options.userId
  if (!db) {
    return {
      items: [],
      nextCursor: null,
      hasMore: false,
      truncatedGroups: false,
      eligibleGroupCount: 0,
      queriedGroupCount: 0,
    }
  }

  const decoded = decodeFeedCursor(options.cursor)
  if (options.cursor && decoded === null) {
    return {
      items: [],
      nextCursor: null,
      hasMore: false,
      truncatedGroups: false,
      eligibleGroupCount: 0,
      queriedGroupCount: 0,
    }
  }
  const cursorGroupPath = decoded?.groupPath ?? null
  const cursorPersonalPath = decoded?.personalPath ?? null

  const { queriedIds, eligibleGroupCount, truncatedGroups } = await getFeedQueryGroupIds(uid)
  const allowed = new Set(queriedIds)

  let groupStartSnap: DocumentSnapshot | null = null
  if (cursorGroupPath && queriedIds.length > 0 && isFeedDocPath(cursorGroupPath, allowed)) {
    const cur = await db.doc(cursorGroupPath).get()
    if (cur.exists) groupStartSnap = cur
  }

  let personalStartSnap: DocumentSnapshot | null = null
  if (cursorPersonalPath && isPersonalFeedDocPath(cursorPersonalPath, uid)) {
    const cur = await db.doc(cursorPersonalPath).get()
    if (cur.exists) personalStartSnap = cur
  }

  const fetchLimit = pageSize + 1

  const [groupDocs, personalDocs] = await Promise.all([
    queriedIds.length > 0
      ? (async () => {
          let q = db
            .collectionGroup(FEED_SUBCOLLECTION)
            .where('groupId', 'in', queriedIds)
            .orderBy('createdAt', 'desc')
            .limit(fetchLimit)
          if (groupStartSnap) q = q.startAfter(groupStartSnap)
          const s = await q.get()
          return s.docs
        })()
      : Promise.resolve([] as QueryDocumentSnapshot[]),
    (async () => {
      let q = db.collection('users').doc(uid).collection(FEED_SUBCOLLECTION).orderBy('createdAt', 'desc').limit(fetchLimit)
      if (personalStartSnap) q = q.startAfter(personalStartSnap)
      const s = await q.get()
      return s.docs
    })(),
  ])

  let gi = 0
  let pi = 0
  const mergedDocs: QueryDocumentSnapshot[] = []
  let lastGroupEmitted: QueryDocumentSnapshot | null = null
  let lastPersonalEmitted: QueryDocumentSnapshot | null = null

  while (mergedDocs.length < pageSize) {
    const g = groupDocs[gi]
    const p = personalDocs[pi]
    if (!g && !p) break
    if (!g) {
      mergedDocs.push(p!)
      lastPersonalEmitted = p!
      pi++
      continue
    }
    if (!p) {
      mergedDocs.push(g)
      lastGroupEmitted = g
      gi++
      continue
    }
    if (compareFeedDocsDesc(g, p) <= 0) {
      mergedDocs.push(g)
      lastGroupEmitted = g
      gi++
    } else {
      mergedDocs.push(p)
      lastPersonalEmitted = p
      pi++
    }
  }

  const groupIdsInPage: string[] = []
  const actorIds: string[] = []
  for (const doc of mergedDocs) {
    if (isPersonalFeedDocPath(doc.ref.path, uid)) {
      const pd = doc.data() as Record<string, unknown>
      const aid = actorUserIdFromData(pd)
      if (aid) actorIds.push(aid)
      const personalFeedType = feedTypeFromData(pd)
      if (personalFeedType === 'sharePlan' || personalFeedType === 'shareCollection' || personalFeedType === 'shareWorkout') {
        const recipientId = str(pd, SHARE_RECIPIENT_USER_ID_FIELD).trim()
        const legacyPeerId = str(pd, 'peerUserId').trim()
        const extra = recipientId || legacyPeerId
        if (extra) actorIds.push(extra)
      } else if (personalFeedType === 'userConnect') {
        const legacyPeerId = str(pd, 'peerUserId').trim()
        const objectPeerId = str(pd, 'objectId').trim()
        if (legacyPeerId) actorIds.push(legacyPeerId)
        if (objectPeerId) actorIds.push(objectPeerId)
      }
      continue
    }
    const d = doc.data() as Record<string, unknown>
    const gid = str(d, 'groupId').trim() || doc.ref.parent.parent?.id || ''
    if (gid && allowed.has(gid)) groupIdsInPage.push(gid)
    const aid = actorUserIdFromData(d)
    if (aid) actorIds.push(aid)
  }

  const [groupNames, users] = await Promise.all([
    batchGetGroupNames([...new Set(groupIdsInPage)]),
    batchGetUserSummaries([...new Set(actorIds)]),
  ])

  const feedPairs: { doc: QueryDocumentSnapshot; row: AppFeedItemResponse }[] = []
  for (const doc of mergedDocs) {
    const row = mapMergedFeedDoc(doc, uid, allowed, groupNames, users)
    if (row) feedPairs.push({ doc, row })
  }

  await Promise.all(
    feedPairs.map(async ({ doc, row }) => {
      const extra = await enrichShareFieldsForFeedItem(doc.data() as Record<string, unknown>, row.type)
      row.shareComment = extra.shareComment
      row.sharedResource = extra.sharedResource
      if (extra.planName) row.planName = extra.planName
      if (extra.collectionName) row.collectionName = extra.collectionName
      if (extra.workoutName) row.workoutName = extra.workoutName
    })
  )

  const items = feedPairs.map((p) => p.row)

  const nextGroupPath = lastGroupEmitted?.ref.path ?? cursorGroupPath ?? null
  const nextPersonalPath = lastPersonalEmitted?.ref.path ?? cursorPersonalPath ?? null

  const moreGroup = gi < groupDocs.length || groupDocs.length >= fetchLimit
  const morePersonal = pi < personalDocs.length || personalDocs.length >= fetchLimit
  const hasMore = mergedDocs.length === pageSize && (moreGroup || morePersonal)
  const nextCursor = hasMore ? encodeCombinedFeedCursor(nextGroupPath, nextPersonalPath) : null

  return {
    items,
    nextCursor,
    hasMore,
    truncatedGroups,
    eligibleGroupCount,
    queriedGroupCount: queriedIds.length,
  }
}

/** @deprecated Use `loadAppFeedPage` */
export const loadGroupFeedPage = loadAppFeedPage

export type HubSharedLibraryItem = {
  kind: 'plan' | 'collection' | 'workout'
  ownerUserId: string
  resourceId: string
  label: string
  /** Second line: workout detail, plan description, or synthesized plan tagline */
  subtitle?: string | null
  /** Workout list stripe color (CSS color string) */
  workoutBarColor?: string
  /** Collection list: number of workouts */
  collectionWorkoutCount?: number
  /** Plan list: icon + subtitle (with subtitle) */
  planIsPersonal?: boolean
  planTrainingIntent?: number
}

function planSubtitleFromEntity(plan: WorkoutPlan): string {
  const raw = plan.workoutPlanDescription?.trim()
  if (raw) return raw
  if (plan.isPersonal) return 'A personal plan.'
  return plan.trainingIntent === 1 ? 'A group training plan.' : 'A private training plan.'
}

/** Firestore inspection for debugging empty shared libraries (local / support). */
export type HubSharedLibraryDiagnosis = {
  groupId: string
  /** Subcollections under `groups/{groupId}` with doc counts (capped read). */
  subcollections: { id: string; approximateDocCount: number }[]
  feedSamples: Array<{
    docId: string
    topLevelKeys: string[]
    feedTypeFromData: AppFeedItemType
    inferredShareKind: AppFeedItemType
    resolvedPlan: boolean
    resolvedCollection: boolean
    resolvedWorkout: boolean
  }>
}

const DIAGNOSE_FEED_SAMPLE = 6

export async function diagnoseHubSharedLibrary(groupId: string): Promise<HubSharedLibraryDiagnosis | null> {
  const db = adminDb
  const gid = groupId.trim()
  if (!db || !gid) return null

  let subcollections: { id: string; approximateDocCount: number }[] = []
  try {
    const cols = await db.collection(GROUPS).doc(gid).listCollections()
    subcollections = await Promise.all(
      cols.map(async (c) => {
        const snap = await c.limit(HUB_SHARED_LIBRARY_FEED_LIMIT).get()
        return { id: c.id, approximateDocCount: snap.size }
      }),
    )
  } catch {
    subcollections = []
  }

  const feedSamples: HubSharedLibraryDiagnosis['feedSamples'] = []
  try {
    const snap = await db
      .collection(GROUPS)
      .doc(gid)
      .collection(FEED_SUBCOLLECTION)
      .limit(DIAGNOSE_FEED_SAMPLE)
      .get()
    for (const doc of snap.docs) {
      const d = doc.data() as Record<string, unknown>
      const [pr, cr, wr] = await Promise.all([
        trySharePlanRow(d),
        tryShareCollectionRow(d),
        tryShareWorkoutRow(d),
      ])
      feedSamples.push({
        docId: doc.id,
        topLevelKeys: Object.keys(d).slice(0, 48),
        feedTypeFromData: feedTypeFromData(d),
        inferredShareKind: inferShareKindFromRefsAndIdsDeep(d),
        resolvedPlan: pr != null,
        resolvedCollection: cr != null,
        resolvedWorkout: wr != null,
      })
    }
  } catch {
    /* ignore */
  }

  return { groupId: gid, subcollections, feedSamples }
}

async function sharedLibraryItemsFromFeedDoc(d: Record<string, unknown>): Promise<HubSharedLibraryItem[]> {
  const shareType = resolveFeedDocShareType(d, feedTypeFromData(d))
  if (!shareType) return []

  if (shareType === 'sharePlan') {
    let resolved = await trySharePlanRow(d)
    if (!resolved) {
      const fb = syncFallbackShareTarget(d, 'sharePlan')
      if (!fb) return []
      resolved = await hubPlanRowFromSyncFallback(fb)
      if (!resolved) return []
    }
    return [{ kind: 'plan', ...resolved }]
  }

  if (shareType === 'shareCollection') {
    let resolved = await tryShareCollectionRow(d)
    if (!resolved) {
      const fb = syncFallbackShareTarget(d, 'shareCollection')
      if (!fb) return []
      resolved = await hubCollectionRowFromSyncFallback(fb)
      if (!resolved) return []
    }
    return [{ kind: 'collection', ...resolved }]
  }

  let resolved = await tryShareWorkoutRow(d)
  if (!resolved) {
    const fb = syncFallbackShareTarget(d, 'shareWorkout')
    if (!fb) return []
    resolved = await hubWorkoutRowFromSyncFallback(fb)
    if (!resolved) return []
  }
  return [{ kind: 'workout', ...resolved }]
}

async function trySharePlanRow(
  d: Record<string, unknown>,
): Promise<Omit<HubSharedLibraryItem, 'kind'> | null> {
  const layeredName = planNameFromFeedLayersDeep(d)
  const layers = collectFeedLayersDeep(d)
  type Pair = { ownerId: string; planId: string }
  const pairs: Pair[] = []
  const pushPair = (ownerId: string, planId: string) => {
    const o = ownerId.trim()
    const p = planId.trim()
    if (!o || !p) return
    pairs.push({ ownerId: o, planId: p })
  }

  for (const layer of layers) {
    for (const k of WORKOUT_PLAN_REF_KEYS) {
      const path = extractFirestoreRefPath(layer[k])
      const loc = parseUserWorkoutPlanPath(path)
      if (loc) pushPair(loc.ownerId, loc.planId)
    }
  }
  for (const path of scanFirestorePathsFromLayers(layers)) {
    const loc = parseUserWorkoutPlanPath(path)
    if (loc) pushPair(loc.ownerId, loc.planId)
  }

  const ownerCandidates = collectResourceOwnerCandidates(d)
  const planIds = new Set<string>()
  for (const layer of layers) {
    const pid = planIdFromFeedDoc(layer)
    if (pid) planIds.add(pid)
  }
  for (const pid of planIds) {
    for (const oid of ownerCandidates) pushPair(oid, pid)
  }

  const seen = new Set<string>()
  for (const { ownerId, planId } of pairs) {
    const key = `${ownerId}\0${planId}`
    if (seen.has(key)) continue
    seen.add(key)
    const plan = await getPlanById(ownerId, planId)
    if (!plan || plan.deletedAt) continue
    const n = plan.workoutPlanName?.trim() || layeredName?.trim() || planId
    return {
      ownerUserId: ownerId,
      resourceId: planId,
      label: n,
      subtitle: planSubtitleFromEntity(plan),
      planIsPersonal: !!plan.isPersonal,
      planTrainingIntent: plan.trainingIntent === 1 ? 1 : 0,
    }
  }

  const pathLoc = firstUserWorkoutPlanPathFromFeedDoc(d)
  if (pathLoc) {
    const plan = await getPlanById(pathLoc.ownerId, pathLoc.planId)
    if (!plan || plan.deletedAt) return null
    const n = plan.workoutPlanName?.trim() || layeredName?.trim() || pathLoc.planId
    return {
      ownerUserId: pathLoc.ownerId,
      resourceId: pathLoc.planId,
      label: n,
      subtitle: planSubtitleFromEntity(plan),
      planIsPersonal: !!plan.isPersonal,
      planTrainingIntent: plan.trainingIntent === 1 ? 1 : 0,
    }
  }

  const actor = actorUserIdFromData(d)
  const planIdList = [...planIds]
  if (actor && planIdList.length > 0) {
    const pid = planIdList[0]!
    const plan = await getPlanById(actor, pid)
    if (!plan || plan.deletedAt) return null
    const n = plan.workoutPlanName?.trim() || layeredName?.trim() || pid
    return {
      ownerUserId: actor,
      resourceId: pid,
      label: n,
      subtitle: planSubtitleFromEntity(plan),
      planIsPersonal: !!plan.isPersonal,
      planTrainingIntent: plan.trainingIntent === 1 ? 1 : 0,
    }
  }

  return null
}

async function tryShareCollectionRow(
  d: Record<string, unknown>,
): Promise<Omit<HubSharedLibraryItem, 'kind'> | null> {
  const layeredName = collectionNameFromFeedLayersDeep(d)
  const layers = collectFeedLayersDeep(d)
  type Pair = { ownerId: string; collectionId: string }
  const pairs: Pair[] = []
  const pushPair = (ownerId: string, collectionId: string) => {
    const o = ownerId.trim()
    const c = collectionId.trim()
    if (!o || !c) return
    pairs.push({ ownerId: o, collectionId: c })
  }

  for (const layer of layers) {
    for (const k of WORKOUT_COLLECTION_REF_KEYS) {
      const path = extractFirestoreRefPath(layer[k])
      const loc = parseUserWorkoutCollectionPath(path)
      if (loc) pushPair(loc.ownerId, loc.collectionId)
    }
  }
  for (const path of scanFirestorePathsFromLayers(layers)) {
    const loc = parseUserWorkoutCollectionPath(path)
    if (loc) pushPair(loc.ownerId, loc.collectionId)
  }

  const ownerCandidates = collectResourceOwnerCandidates(d)
  const collectionIds = new Set<string>()
  for (const layer of layers) {
    const cid = collectionIdFromFeedDoc(layer)
    if (cid) collectionIds.add(cid)
  }
  for (const cid of collectionIds) {
    for (const oid of ownerCandidates) pushPair(oid, cid)
  }

  const seen = new Set<string>()
  for (const { ownerId, collectionId } of pairs) {
    const key = `${ownerId}\0${collectionId}`
    if (seen.has(key)) continue
    seen.add(key)
    const coll = await getCollectionById(ownerId, collectionId)
    if (!coll || coll.deletedAt) continue
    const n = coll.workoutCollectionName?.trim() || layeredName?.trim() || collectionId
    return {
      ownerUserId: ownerId,
      resourceId: collectionId,
      label: n,
      collectionWorkoutCount: Array.isArray(coll.workoutIds) ? coll.workoutIds.length : 0,
      subtitle: getCollectionDisplayDescription({
        workoutCollectionDescription: coll.workoutCollectionDescription,
        workoutIds: coll.workoutIds,
      }),
    }
  }

  const pathLoc = firstUserWorkoutCollectionPathFromFeedDoc(d)
  if (pathLoc) {
    const coll = await getCollectionById(pathLoc.ownerId, pathLoc.collectionId)
    if (!coll || coll.deletedAt) return null
    const n = coll.workoutCollectionName?.trim() || layeredName?.trim() || pathLoc.collectionId
    return {
      ownerUserId: pathLoc.ownerId,
      resourceId: pathLoc.collectionId,
      label: n,
      collectionWorkoutCount: Array.isArray(coll.workoutIds) ? coll.workoutIds.length : 0,
      subtitle: getCollectionDisplayDescription({
        workoutCollectionDescription: coll.workoutCollectionDescription,
        workoutIds: coll.workoutIds,
      }),
    }
  }

  const actor = actorUserIdFromData(d)
  const collectionIdList = [...collectionIds]
  if (actor && collectionIdList.length > 0) {
    const cid = collectionIdList[0]!
    const coll = await getCollectionById(actor, cid)
    if (!coll || coll.deletedAt) return null
    const n = coll.workoutCollectionName?.trim() || layeredName?.trim() || cid
    return {
      ownerUserId: actor,
      resourceId: cid,
      label: n,
      collectionWorkoutCount: Array.isArray(coll.workoutIds) ? coll.workoutIds.length : 0,
      subtitle: getCollectionDisplayDescription({
        workoutCollectionDescription: coll.workoutCollectionDescription,
        workoutIds: coll.workoutIds,
      }),
    }
  }

  return null
}

async function tryShareWorkoutRow(
  d: Record<string, unknown>,
): Promise<Omit<HubSharedLibraryItem, 'kind'> | null> {
  const layeredName = workoutNameFromFeedLayersDeep(d)
  const layers = collectFeedLayersDeep(d)
  type Pair = { ownerId: string; workoutId: string }
  const pairs: Pair[] = []
  const pushPair = (ownerId: string, workoutId: string) => {
    const o = ownerId.trim()
    const wid = workoutId.trim()
    if (!o || !wid) return
    pairs.push({ ownerId: o, workoutId: wid })
  }

  for (const layer of layers) {
    for (const k of WORKOUT_DOC_REF_KEYS) {
      const path = extractFirestoreRefPath(layer[k])
      const loc = parseUserWorkoutPath(path)
      if (loc) pushPair(loc.ownerId, loc.workoutId)
    }
  }
  for (const path of scanFirestorePathsFromLayers(layers)) {
    const loc = parseUserWorkoutPath(path)
    if (loc) pushPair(loc.ownerId, loc.workoutId)
  }

  const ownerCandidates = collectResourceOwnerCandidates(d)
  const workoutIds = new Set<string>()
  for (const layer of layers) {
    const wid = workoutIdFromFeedDoc(layer)
    if (wid) workoutIds.add(wid)
  }
  for (const wid of workoutIds) {
    for (const oid of ownerCandidates) pushPair(oid, wid)
  }

  const seen = new Set<string>()
  for (const { ownerId, workoutId } of pairs) {
    const key = `${ownerId}\0${workoutId}`
    if (seen.has(key)) continue
    seen.add(key)
    const w = await getWorkoutById(ownerId, workoutId)
    if (!w || w.deletedAt) continue
    const name =
      getWorkoutDisplayName(w).trim() || layeredName?.trim() || w.workoutId?.trim() || workoutId
    return {
      ownerUserId: ownerId,
      resourceId: workoutId,
      label: name,
      subtitle: getWorkoutDetailDescription(w),
      workoutBarColor: getWorkoutBarColor(w),
    }
  }

  const pathLoc = firstUserWorkoutPathFromFeedDoc(d)
  if (pathLoc) {
    const w = await getWorkoutById(pathLoc.ownerId, pathLoc.workoutId)
    if (!w || w.deletedAt) return null
    const name =
      getWorkoutDisplayName(w).trim() || layeredName?.trim() || w.workoutId?.trim() || pathLoc.workoutId
    return {
      ownerUserId: pathLoc.ownerId,
      resourceId: pathLoc.workoutId,
      label: name,
      subtitle: getWorkoutDetailDescription(w),
      workoutBarColor: getWorkoutBarColor(w),
    }
  }

  const actor = actorUserIdFromData(d)
  const widList = [...workoutIds]
  if (actor && widList.length > 0) {
    const wid = widList[0]!
    const w = await getWorkoutById(actor, wid)
    if (!w || w.deletedAt) return null
    return {
      ownerUserId: actor,
      resourceId: wid,
      label: getWorkoutDisplayName(w).trim() || layeredName?.trim() || wid,
      subtitle: getWorkoutDetailDescription(w),
      workoutBarColor: getWorkoutBarColor(w),
    }
  }

  return null
}

function syncFallbackShareTarget(
  d: Record<string, unknown>,
  shareType: 'sharePlan' | 'shareCollection' | 'shareWorkout',
): { ownerUserId: string; resourceId: string; label: string } | null {
  if (shareType === 'shareWorkout') {
    const pathWorkout = firstUserWorkoutPathFromFeedDoc(d)
    if (pathWorkout) {
      return {
        ownerUserId: pathWorkout.ownerId,
        resourceId: pathWorkout.workoutId,
        label: workoutNameFromFeedLayersDeep(d)?.trim() || pathWorkout.workoutId,
      }
    }
  }

  if (shareType === 'sharePlan') {
    const pathPlan = firstUserWorkoutPlanPathFromFeedDoc(d)
    if (pathPlan) {
      return {
        ownerUserId: pathPlan.ownerId,
        resourceId: pathPlan.planId,
        label: planNameFromFeedLayersDeep(d)?.trim() || pathPlan.planId,
      }
    }
  }
  if (shareType === 'shareCollection') {
    const pathCol = firstUserWorkoutCollectionPathFromFeedDoc(d)
    if (pathCol) {
      return {
        ownerUserId: pathCol.ownerId,
        resourceId: pathCol.collectionId,
        label: collectionNameFromFeedLayersDeep(d)?.trim() || pathCol.collectionId,
      }
    }
  }

  const owners = collectResourceOwnerCandidates(d)
  let owner = owners.map((o) => o.trim()).find(Boolean) ?? ''
  if (!owner) {
    const layersToScan = [d, ...collectFeedLayersDeep(d)]
    for (const layer of layersToScan) {
      const o = planOwnerUserIdFromFeedDoc(layer)
      if (o) {
        owner = o
        break
      }
    }
  }
  if (
    !owner &&
    (shareType === 'shareWorkout' || shareType === 'sharePlan' || shareType === 'shareCollection')
  ) {
    const actor = actorUserIdFromData(d)
    if (actor) owner = actor
  }
  if (!owner) return null
  const layers = collectFeedLayersDeep(d)

  if (shareType === 'sharePlan') {
    let resourceId = ''
    for (const layer of layers) {
      resourceId = planIdFromFeedDoc(layer)
      if (resourceId) break
    }
    if (!resourceId) return null
    const label = planNameFromFeedLayersDeep(d)?.trim() || resourceId
    return { ownerUserId: owner, resourceId, label }
  }
  if (shareType === 'shareCollection') {
    let resourceId = ''
    for (const layer of layers) {
      resourceId = collectionIdFromFeedDoc(layer)
      if (resourceId) break
    }
    if (!resourceId) return null
    const label = collectionNameFromFeedLayersDeep(d)?.trim() || resourceId
    return { ownerUserId: owner, resourceId, label }
  }

  let resourceId = ''
  for (const layer of layers) {
    resourceId = workoutIdFromFeedDoc(layer)
    if (resourceId) break
  }
  if (!resourceId) return null
  const label = workoutNameFromFeedLayersDeep(d)?.trim() || resourceId
  return { ownerUserId: owner, resourceId, label }
}

function shareWorkoutHintFromFeedDocDeep(d: Record<string, unknown>): boolean {
  for (const layer of collectFeedLayersDeep(d)) {
    for (const k of FEED_TYPE_STRING_KEYS) {
      if (!(k in layer)) continue
      const parsed = normalizeFeedTypeFromUnknown(layer[k])
      if (parsed === 'shareWorkout') return true
    }
  }
  return false
}

function sharePlanHintFromFeedDocDeep(d: Record<string, unknown>): boolean {
  for (const layer of collectFeedLayersDeep(d)) {
    for (const k of FEED_TYPE_STRING_KEYS) {
      if (!(k in layer)) continue
      const parsed = normalizeFeedTypeFromUnknown(layer[k])
      if (parsed === 'sharePlan') return true
    }
  }
  return false
}

function shareCollectionHintFromFeedDocDeep(d: Record<string, unknown>): boolean {
  for (const layer of collectFeedLayersDeep(d)) {
    for (const k of FEED_TYPE_STRING_KEYS) {
      if (!(k in layer)) continue
      const parsed = normalizeFeedTypeFromUnknown(layer[k])
      if (parsed === 'shareCollection') return true
    }
  }
  return false
}

/**
 * Single share kind per feed document — matches {@link enrichShareFieldsForFeedItem} so hub “shared library”
 * does not list a plan for every activity that merely references a plan (e.g. scheduled workouts).
 */
function resolveFeedDocShareType(
  d: Record<string, unknown>,
  primaryType: AppFeedItemType,
): AppFeedItemType | null {
  /** `objectId` may duplicate `groupId` (iOS createGroup); do not treat as plan/collection id. */
  if (primaryType === 'createGroup') return null

  let shareType: AppFeedItemType | null = SHARE_FEED_TYPES.has(primaryType) ? primaryType : null
  if (!shareType) {
    const inferred = inferShareKindFromRefsAndIdsDeep(d)
    if (SHARE_FEED_TYPES.has(inferred)) shareType = inferred
  }
  if (!shareType && firstUserWorkoutPathFromFeedDoc(d)) {
    shareType = 'shareWorkout'
  }
  if (!shareType && firstUserWorkoutPlanPathFromFeedDoc(d)) {
    shareType = 'sharePlan'
  }
  if (!shareType && firstUserWorkoutCollectionPathFromFeedDoc(d)) {
    shareType = 'shareCollection'
  }
  if (!shareType) {
    const layers = collectFeedLayersDeep(d)
    let wid = ''
    let pid = ''
    let cid = ''
    for (const layer of layers) {
      if (!wid) wid = workoutIdFromFeedDoc(layer)
      if (!pid) pid = planIdFromFeedDoc(layer)
      if (!cid) cid = collectionIdFromFeedDoc(layer)
    }
    const hasW = Boolean(wid)
    const hasP = Boolean(pid)
    const hasC = Boolean(cid)
    if (hasW && !hasP && !hasC) shareType = 'shareWorkout'
    else if (!hasW && hasP && !hasC) shareType = 'sharePlan'
    else if (!hasW && !hasP && hasC) shareType = 'shareCollection'
    else if (hasW && hasP && !hasC) {
      const wn = workoutNameFromFeedLayersDeep(d)
      const pn = planNameFromFeedLayersDeep(d)
      if (wn && !pn) shareType = 'shareWorkout'
      else if (pn && !wn) shareType = 'sharePlan'
      else shareType = 'shareWorkout'
    } else if (hasW && !hasP && hasC) shareType = 'shareWorkout'
    else if (!hasW && hasP && hasC) {
      const cn = collectionNameFromFeedLayersDeep(d)
      const pn = planNameFromFeedLayersDeep(d)
      if (cn && !pn) shareType = 'shareCollection'
      else if (pn && !cn) shareType = 'sharePlan'
      else shareType = 'shareCollection'
    } else if (hasW && hasP && hasC) shareType = 'shareWorkout'
  }
  if (!shareType && sharePlanHintFromFeedDocDeep(d)) {
    shareType = 'sharePlan'
  }
  if (!shareType && shareCollectionHintFromFeedDocDeep(d)) {
    shareType = 'shareCollection'
  }
  if (!shareType && shareWorkoutHintFromFeedDocDeep(d)) {
    shareType = 'shareWorkout'
  }
  return shareType
}

async function hubPlanRowFromSyncFallback(fb: {
  ownerUserId: string
  resourceId: string
  label: string
}): Promise<Omit<HubSharedLibraryItem, 'kind'> | null> {
  const plan = await getPlanById(fb.ownerUserId, fb.resourceId)
  if (!plan || plan.deletedAt) return null
  return {
    ownerUserId: fb.ownerUserId,
    resourceId: fb.resourceId,
    label: plan.workoutPlanName?.trim() || fb.label,
    subtitle: planSubtitleFromEntity(plan),
    planIsPersonal: !!plan.isPersonal,
    planTrainingIntent: plan.trainingIntent === 1 ? 1 : 0,
  }
}

async function hubCollectionRowFromSyncFallback(fb: {
  ownerUserId: string
  resourceId: string
  label: string
}): Promise<Omit<HubSharedLibraryItem, 'kind'> | null> {
  const coll = await getCollectionById(fb.ownerUserId, fb.resourceId)
  if (!coll || coll.deletedAt) return null
  return {
    ownerUserId: fb.ownerUserId,
    resourceId: fb.resourceId,
    label: coll.workoutCollectionName?.trim() || fb.label,
    collectionWorkoutCount: Array.isArray(coll.workoutIds) ? coll.workoutIds.length : 0,
    subtitle: getCollectionDisplayDescription({
      workoutCollectionDescription: coll.workoutCollectionDescription,
      workoutIds: coll.workoutIds,
    }),
  }
}

async function hubWorkoutRowFromSyncFallback(fb: {
  ownerUserId: string
  resourceId: string
  label: string
}): Promise<Omit<HubSharedLibraryItem, 'kind'> | null> {
  const w = await getWorkoutById(fb.ownerUserId, fb.resourceId)
  if (!w || w.deletedAt) return null
  return {
    ownerUserId: fb.ownerUserId,
    resourceId: fb.resourceId,
    label: getWorkoutDisplayName(w).trim() || fb.label,
    subtitle: getWorkoutDetailDescription(w),
    workoutBarColor: getWorkoutBarColor(w),
  }
}

async function enrichShareFieldsForFeedItem(
  d: Record<string, unknown>,
  type: AppFeedItemType
): Promise<{
  shareComment: string | null
  sharedResource: AppFeedSharedResource | null
  planName: string | null
  collectionName: string | null
  workoutName: string | null
}> {
  const shareComment = commentFromFeedDoc(d)
  const emptyNames = {
    shareComment,
    sharedResource: null as AppFeedSharedResource | null,
    planName: null as string | null,
    collectionName: null as string | null,
    workoutName: null as string | null,
  }

  const shareType = resolveFeedDocShareType(d, type)
  if (!shareType) {
    return emptyNames
  }

  let resolved: { ownerUserId: string; resourceId: string; label: string } | null = null
  if (shareType === 'sharePlan') {
    resolved = await trySharePlanRow(d)
    if (!resolved) resolved = syncFallbackShareTarget(d, 'sharePlan')
  } else if (shareType === 'shareCollection') {
    resolved = await tryShareCollectionRow(d)
    if (!resolved) resolved = syncFallbackShareTarget(d, 'shareCollection')
  } else {
    resolved = await tryShareWorkoutRow(d)
    if (!resolved) resolved = syncFallbackShareTarget(d, 'shareWorkout')
  }

  if (!resolved) {
    return emptyNames
  }

  const canonKind = shareType === 'sharePlan' ? 'plan' : shareType === 'shareCollection' ? 'collection' : 'workout'
  if (!(await canonicalSharedItemLive(canonKind, resolved.ownerUserId, resolved.resourceId))) {
    return emptyNames
  }

  const resKind: AppFeedSharedResource['kind'] =
    shareType === 'sharePlan' ? 'plan' : shareType === 'shareCollection' ? 'collection' : 'workout'
  const sharedResource: AppFeedSharedResource = {
    kind: resKind,
    ownerUserId: resolved.ownerUserId,
    resourceId: resolved.resourceId,
    label: resolved.label,
  }
  return {
    shareComment,
    sharedResource,
    planName: resKind === 'plan' ? resolved.label : null,
    collectionName: resKind === 'collection' ? resolved.label : null,
    workoutName: resKind === 'workout' ? resolved.label : null,
  }
}

export type LoadHubSharedLibraryOptions = {
  /** When set, skips feed docs whose `actorUserId` equals this uid (your own hub shares). */
  omitFeedDocsWhereActorUserId?: string
}

/**
 * Deduped shared workouts / collections / plans from `groups/{groupId}/feed` (newest-first wins per resource).
 */
export async function loadHubSharedLibrary(
  groupId: string,
  opts?: LoadHubSharedLibraryOptions
): Promise<{
  workouts: HubSharedLibraryItem[]
  collections: HubSharedLibraryItem[]
  plans: HubSharedLibraryItem[]
}> {
  const empty = { workouts: [] as HubSharedLibraryItem[], collections: [] as HubSharedLibraryItem[], plans: [] as HubSharedLibraryItem[] }
  const db = adminDb
  if (!db) return empty

  const gid = groupId.trim()
  if (!gid) return empty
  const omitActor = (opts?.omitFeedDocsWhereActorUserId ?? '').trim()

  let gSnap
  try {
    gSnap = await db.collection(GROUPS).doc(gid).get()
  } catch {
    return empty
  }
  if (!gSnap.exists) return empty
  const gTop = gSnap.data() as Record<string, unknown>
  if (gTop.deletedAt != null) return empty

  let snap: QuerySnapshot
  try {
    snap = await db.collection(GROUPS).doc(gid).collection(FEED_SUBCOLLECTION).limit(HUB_SHARED_LIBRARY_FEED_LIMIT).get()
  } catch {
    return empty
  }

  const sortedDocs = [...snap.docs].sort((a, b) => {
    const ta = parseCreatedAt(a.data() as Record<string, unknown>)?.getTime() ?? 0
    const tb = parseCreatedAt(b.data() as Record<string, unknown>)?.getTime() ?? 0
    if (tb !== ta) return tb - ta
    return b.id.localeCompare(a.id)
  })

  const seenPlan = new Set<string>()
  const seenCol = new Set<string>()
  const seenW = new Set<string>()
  const plans: HubSharedLibraryItem[] = []
  const collections: HubSharedLibraryItem[] = []
  const workouts: HubSharedLibraryItem[] = []

  for (const doc of sortedDocs) {
    const d = doc.data() as Record<string, unknown>
    if (omitActor) {
      const actor = str(d, 'actorUserId').trim()
      if (actor && actor === omitActor) continue
    }
    const items = await sharedLibraryItemsFromFeedDoc(d)
    for (const item of items) {
      if (item.kind === 'plan') {
        const u = `${item.ownerUserId}:${item.resourceId}`
        if (seenPlan.has(u)) continue
        seenPlan.add(u)
        plans.push(item)
      } else if (item.kind === 'collection') {
        const u = `${item.ownerUserId}:${item.resourceId}`
        if (seenCol.has(u)) continue
        seenCol.add(u)
        collections.push(item)
      } else {
        const u = `${item.ownerUserId}:${item.resourceId}`
        if (seenW.has(u)) continue
        seenW.add(u)
        workouts.push(item)
      }
    }
  }

  const workoutsWithFlags = await Promise.all(
    workouts.map(async (w) => ({
      w,
      direct: await workoutHasDirectGroupShareInHub(w.ownerUserId, gid, w.resourceId),
    }))
  )
  const workoutsFiltered = workoutsWithFlags.filter((x) => x.direct).map((x) => x.w)

  return { workouts: workoutsFiltered, collections, plans }
}
