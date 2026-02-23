/** Firebase Auth user record as returned to admin */
export interface AdminUserRecord {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  emailVerified: boolean
  disabled: boolean
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

/** Workout plan document from users/<userId>/workoutPlans */
export interface WorkoutPlan {
  id: string
  isPersonal: boolean
  ordinal: number
  userId: string
  workoutPlanDescription: string | null
  workoutPlanId: string
  workoutPlanName: string
  /** Set when plan is soft-deleted; used to filter from list and count */
  deletedAt?: string | null
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

export interface Workout {
  id: string
  type: WorkoutType
  userId: string
  workoutId: string
  workoutShareId: string
  workoutName: string | null
  workoutDescription: string | null
  workoutImage: string | null
  /** Set when workout is soft-deleted */
  deletedAt?: string | null
}

/** Full admin view of a user: Auth record + Firestore counts + workout plans/collections lists */
export interface AdminUserProfile extends AdminUserRecord {
  dataCounts: UserDataCounts
  workoutPlans: WorkoutPlan[]
  /** Number of workout plans with deletedAt set (hidden from list) */
  deletedWorkoutPlansCount: number
  workoutCollections: WorkoutCollection[]
  /** Number of workout collections with deletedAt set (hidden from list) */
  deletedWorkoutCollectionsCount: number
}
