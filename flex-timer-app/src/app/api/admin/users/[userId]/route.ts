import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { getUserDataCounts, getUserDocument, getUserWorkoutCollections, getUserWorkoutPlans, getUserWorkouts } from '@/lib/firestore'
import type { AdminUserProfile } from '@/types/user'

/**
 * GET /api/admin/users/[userId]
 * Returns one user's Auth record plus Firestore data counts (workouts, workoutCollections, workoutPlans).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const authResult = await requireAdminAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  if (!adminAuth) {
    return NextResponse.json(
      { error: 'Firebase Admin not configured' },
      { status: 503 }
    )
  }

  const { userId } = await params
  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 })
  }

  try {
    const [userRecord, userDoc, dataCounts, allWorkouts, allWorkoutPlans, allWorkoutCollections] = await Promise.all([
      adminAuth.getUser(userId),
      getUserDocument(userId),
      getUserDataCounts(userId),
      getUserWorkouts(userId),
      getUserWorkoutPlans(userId),
      getUserWorkoutCollections(userId),
    ])

    const deletedWorkouts = allWorkouts.filter((w) => w.deletedAt)
    const workouts = allWorkouts.filter((w) => !w.deletedAt)
    const deletedWorkoutPlans = allWorkoutPlans.filter((p) => p.deletedAt)
    const workoutPlans = allWorkoutPlans.filter((p) => !p.deletedAt)
    const deletedWorkoutCollections = allWorkoutCollections.filter((c) => c.deletedAt)
    const workoutCollections = allWorkoutCollections.filter((c) => !c.deletedAt)

    const profile: AdminUserProfile = {
      uid: userRecord.uid,
      email: userRecord.email ?? userDoc?.email ?? null,
      displayName: userRecord.displayName ?? null,
      photoURL: userRecord.photoURL ?? null,
      emailVerified: userRecord.emailVerified,
      disabled: userRecord.disabled,
      metadata: {
        creationTime: userRecord.metadata.creationTime,
        lastSignInTime: userRecord.metadata.lastSignInTime ?? null,
      },
      firstName: userDoc?.firstName ?? null,
      lastName: userDoc?.lastName ?? null,
      subscriptionPlan: userDoc?.subscriptionPlan ?? null,
      dataCounts,
      workouts,
      deletedWorkouts,
      workoutPlans,
      deletedWorkoutPlans,
      workoutCollections,
      deletedWorkoutCollections,
    }

    return NextResponse.json(profile)
  } catch (err: unknown) {
    const message = err && typeof err === 'object' && 'code' in err
      ? (err as { code: string }).code === 'auth/user-not-found'
        ? 'User not found'
        : err instanceof Error ? err.message : String(err)
      : 'Failed to get user'
    const status =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code: string }).code === 'auth/user-not-found'
          ? 404
          : 500
        : 500
    return NextResponse.json({ error: message }, { status })
  }
}
