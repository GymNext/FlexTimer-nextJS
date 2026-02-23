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

/** Full admin view of a user: Auth record + Firestore counts */
export interface AdminUserProfile extends AdminUserRecord {
  dataCounts: UserDataCounts
}
