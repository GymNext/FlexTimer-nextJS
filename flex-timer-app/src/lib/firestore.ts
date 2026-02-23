import { adminDb } from '@/lib/firebase-admin'
import { USER_COLLECTIONS, type UserDataCounts } from '@/types/user'

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
