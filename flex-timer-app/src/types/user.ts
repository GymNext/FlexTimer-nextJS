import type { UserHubLookupIds, UserHubLookupLabels } from './hub-profile'

/** Firebase Auth user record as returned to admin */
export interface AdminUserRecord {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  emailVerified: boolean
  disabled: boolean
  /** Auth provider(s), e.g. ['Google'], ['Apple'], ['Email'] */
  providers: string[]
  metadata: {
    creationTime: string
    lastSignInTime: string | null
  }
}

/** Firestore subcollections under users/<userId> */
export const USER_COLLECTIONS = {
  workouts: 'workouts',
  workoutCollections: 'workoutCollections',
  workoutPlans: 'workoutPlans',
} as const

export type UserCollectionName = keyof typeof USER_COLLECTIONS

/** Counts for a user's Firestore data (admin profile view) */
export interface UserDataCounts {
  workouts: number
  workoutCollections: number
  workoutPlans: number
}

/**
 * Firestore `trainingIntent`: numeric **0** or **1** only (0 = private training, 1 = group training).
 * Omitted when `isPersonal` is true; `isPersonal` takes precedence for display and behavior.
 */
export type PlanTrainingIntent = 0 | 1

/** Workout plan document from users/<userId>/workoutPlans */
export interface WorkoutPlan {
  id: string
  isPersonal: boolean
  ordinal: number
  userId: string
  workoutPlanDescription: string | null
  workoutPlanId: string
  workoutPlanName: string
  /** For non-personal plans only: 0 private training, 1 group training. */
  trainingIntent?: PlanTrainingIntent | null
  /** Sharing privacy level from mobile app (private/protected/public as raw int). */
  privacy?: number | null
  /** Optional public handle used when sharing is enabled. */
  handle?: string | null
  /** Set when plan is soft-deleted; used to filter from list and count */
  deletedAt?: string | null
  /**
   * When true (default), this owned plan is included on the Planning → Today's Plan tab.
   * When false, Today omits it. Synced with mobile as `showInSchedule`.
   */
  showInSchedule?: boolean | null
  /**
   * IANA timezone for planned-workout `day` timestamps (local calendar midnight = `day` field).
   * Optional; web can also send `planDayTimeZone` on create. Common Firestore keys are read in `getPlanById`.
   */
  dayTimeZoneId?: string | null
}

/** One entry in PlanDay.entries[] (stored as map in Firestore). Can be single-segment (flat) or MultiSegmentWorkout (has segments array). */
export interface PlanDayEntry {
  continuity?: boolean
  direction?: boolean
  metronome?: number
  prelude?: number
  restDirection?: number
  segue?: boolean
  timerMode?: number
  type?: string
  userId?: string
  warningStrategy?: number
  warnings?: number[]
  workoutDescription?: string | null
  /** Single-segment: full workout details (rep scheme, weights, movements, etc.) */
  workoutDetails?: string | null
  workoutId?: string
  workoutImage?: string | null
  workoutName?: string | null
  /** JSON string (single-segment) */
  workoutSchedule?: string
  workoutShareId?: string | null
  planId?: string
  /** MultiSegmentWorkout: nested segments */
  segments?: WorkoutSegment[]
  autoProgress?: boolean
  timerModes?: number[]
}

/** Planned workout document from users/<userId>/plannedWorkouts/<plannedWorkoutId> */
export interface PlannedWorkout {
  id: string
  day: string
  ordinal: number
  planId: string
  plannedWorkoutId: string
  sourceWorkoutId: string | null
  userId: string
  /** Embedded workout data (same shape as PlanDayEntry) */
  workout: PlanDayEntry
  deletedAt?: string | null
}

/** Plan day document from users/<userId>/workoutPlans/<planId>/planDays/<date> */
export interface PlanDay {
  id: string
  day: string
  entries: PlanDayEntry[]
  planId: string
  sourceWorkoutIds: (string | null)[]
  userId: string
}

/** Workout collection document from users/<userId>/workoutCollections */
export interface WorkoutCollection {
  id: string
  ordinal: number
  userId: string
  workoutCollectionDescription: string | null
  workoutCollectionId: string
  workoutCollectionName: string
  workoutCollectionShareId: string
  workoutIds: string[]
  /** Set when collection is soft-deleted; used to filter from list and count */
  deletedAt?: string | null
}

/** Workout document from users/<userId>/workouts (SingleSegmentWorkout or MultiSegmentWorkout) */
export type WorkoutType = 'SingleSegmentWorkout' | 'MultiSegmentWorkout'

/** Segment in Firestore: workoutSchedule is JSON string; enums stored as raw int. */
export interface WorkoutSegment {
  workoutId: string
  workoutName?: string | null
  workoutDescription?: string | null
  /** Full segment details (rep scheme, weights, movements, etc.) */
  workoutDetails?: string | null
  workoutImage?: string | null
  workoutShareId?: string | null
  /** JSON string from JsonHelper.toJsonFromWorkoutSchedule */
  workoutSchedule?: string | null
  prelude?: number
  segue?: boolean
  warnings?: number[]
  metronome?: number
  direction?: boolean
  restDirection?: number
  warningStrategy?: number
  continuity?: boolean
}

export interface Workout {
  id: string
  type: WorkoutType
  userId: string
  workoutId: string
  workoutShareId: string
  workoutName: string | null
  workoutDescription: string | null
  /** SingleSegmentWorkout only: full workout details (rep scheme, weights, movements, etc.) */
  workoutDetails?: string | null
  workoutImage: string | null
  /** SingleSegmentWorkout: timer mode (raw int) */
  timerMode?: unknown
  /** MultiSegmentWorkout: timer modes (raw int[]) */
  timerModes?: unknown
  /** SingleSegmentWorkout: schedule as JSON string */
  workoutSchedule?: string | null
  /** SingleSegmentWorkout: options (enums as raw int) */
  prelude?: number
  segue?: boolean
  warnings?: number[]
  metronome?: number
  direction?: boolean
  restDirection?: number
  warningStrategy?: number
  continuity?: boolean
  /** MultiSegmentWorkout only */
  autoProgress?: boolean
  /** MultiSegmentWorkout only */
  segments?: WorkoutSegment[]
  /** Set when workout is soft-deleted */
  deletedAt?: string | null
}

/** Subscription plan enum (stored as int on user document). */
export const SUBSCRIPTION_PLAN = {
  basic: 0,
  pro: 1,
  proPlus: 2,
  classic: 3,
} as const

export type SubscriptionPlanKey = keyof typeof SUBSCRIPTION_PLAN

const SUBSCRIPTION_PLAN_LABELS: Record<number, string> = {
  [SUBSCRIPTION_PLAN.basic]: 'Basic',
  [SUBSCRIPTION_PLAN.pro]: 'Pro',
  [SUBSCRIPTION_PLAN.proPlus]: 'Pro Plus',
  [SUBSCRIPTION_PLAN.classic]: 'Classic',
}

export function getSubscriptionPlanLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return SUBSCRIPTION_PLAN_LABELS[value] ?? String(value)
}

/** Fields stored on the user document (users/<userId>) in Firestore. Subscription/entitlements come from RevenueCat (Firestore) instead. */
export interface UserDocumentFields extends Partial<UserHubLookupIds> {
  email?: string | null
  firstName?: string | null
  lastName?: string | null
  handle?: string | null
  handleKey?: string | null
  bio?: string | null
  profilePhotoUrl?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
}

/** RevenueCat subscription summary for admin profile (entitlements from Firestore). */
export interface AdminSubscriptionInfo {
  activeEntitlementIds: string[]
  activeProductIds: string[]
}

/** Full admin view of a user: Auth record + user document + Firestore counts + workout/plan/collection lists */
export interface AdminUserProfile extends AdminUserRecord, Partial<UserHubLookupIds> {
  /** From user document users/<userId> */
  firstName?: string | null
  lastName?: string | null
  handle?: string | null
  handleKey?: string | null
  bio?: string | null
  profilePhotoUrl?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
  /** From UserDetails/settings: hasConnectedToDisplay -> "Connected User" | "Standalone User" */
  connectedUserDisplay?: string | null
  /** From UserDetails/settings: connectedToDisplayType (noDisplay | singleDisplay | multiDisplay) */
  userTypeDisplay?: string | null
  /** From RevenueCat (Firestore); human-readable plan/entitlement label for display */
  subscriptionDisplayLabel?: string | null
  /** From RevenueCat (Firestore); active entitlements and product IDs */
  subscriptionInfo?: AdminSubscriptionInfo
  /** User IDs merged into this user (UserDetails.mergedUserIds) */
  mergedUserIds?: string[]
  /** UserDetails settings map (key-value pairs from app) */
  settings?: Record<string, unknown>
  /** Resolved labels for hub lookup ids (admin display). */
  hubLookupLabels?: UserHubLookupLabels
  dataCounts: UserDataCounts
  workouts: Workout[]
  /** Workouts with deletedAt set (for Deleted data section) */
  deletedWorkouts: Workout[]
  workoutPlans: WorkoutPlan[]
  /** Workout plans with deletedAt set (for Deleted data section) */
  deletedWorkoutPlans: WorkoutPlan[]
  workoutCollections: WorkoutCollection[]
  /** Workout collections with deletedAt set (for Deleted data section) */
  deletedWorkoutCollections: WorkoutCollection[]
}
