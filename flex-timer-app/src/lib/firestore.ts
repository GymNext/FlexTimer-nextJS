import { adminDb } from '@/lib/firebase-admin'
import { USER_COLLECTIONS, type UserDataCounts, type Workout, type WorkoutCollection, type WorkoutPlan } from '@/types/user'

function parseDeletedAt(d: Record<string, unknown>): string | null {
  const deletedAtRaw = d.deletedAt
  if (deletedAtRaw == null) return null
  if (typeof deletedAtRaw === 'string') return deletedAtRaw
  if (typeof deletedAtRaw === 'object' && deletedAtRaw !== null && 'toDate' in deletedAtRaw && typeof (deletedAtRaw as { toDate: () => Date }).toDate === 'function')
    return (deletedAtRaw as { toDate: () => Date }).toDate().toISOString()
  return null
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
      deletedAt: parseDeletedAt(d),
    }
  })
  plans.sort((a, b) => a.ordinal - b.ordinal)
  return plans
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

/** Fetch workout documents by id from users/<userId>/workouts (doc id = workoutId). */
export async function getWorkoutsByIds(userId: string, workoutIds: string[]): Promise<Workout[]> {
  if (!adminDb || workoutIds.length === 0) return []
  const userRef = adminDb.collection('users').doc(userId)
  const workoutsRef = userRef.collection(USER_COLLECTIONS.workouts)
  const uniqueIds = [...new Set(workoutIds)]
  const snaps = await Promise.all(uniqueIds.map((id) => workoutsRef.doc(id).get()))
  const results: Workout[] = []
  for (let i = 0; i < uniqueIds.length; i++) {
    const doc = snaps[i]
    if (!doc?.exists) continue
    const d = doc.data()!
    const type = d.type === 'MultiSegmentWorkout' ? 'MultiSegmentWorkout' : 'SingleSegmentWorkout'
    results.push({
      id: doc.id,
      type,
      userId: typeof d.userId === 'string' ? d.userId : '',
      workoutId: typeof d.workoutId === 'string' ? d.workoutId : doc.id,
      workoutShareId: typeof d.workoutShareId === 'string' ? d.workoutShareId : '',
      workoutName: d.workoutName ?? null,
      workoutDescription: d.workoutDescription ?? null,
      workoutImage: d.workoutImage ?? null,
      deletedAt: parseDeletedAt(d as Record<string, unknown>),
    })
  }
  return results
}
