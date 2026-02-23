import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { getUserDataCounts, getUserWorkoutCollections, getUserWorkoutPlans } from '@/lib/firestore'
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
    const [userRecord, dataCounts, allWorkoutPlans, allWorkoutCollections] = await Promise.all([
      adminAuth.getUser(userId),
      getUserDataCounts(userId),
      getUserWorkoutPlans(userId),
      getUserWorkoutCollections(userId),
    ])

    const deletedWorkoutPlansCount = allWorkoutPlans.filter((p) => p.deletedAt).length
    const workoutPlans = allWorkoutPlans.filter((p) => !p.deletedAt)
    const deletedWorkoutCollectionsCount = allWorkoutCollections.filter((c) => c.deletedAt).length
    const workoutCollections = allWorkoutCollections.filter((c) => !c.deletedAt)

    const profile: AdminUserProfile = {
      uid: userRecord.uid,
      email: userRecord.email ?? null,
      displayName: userRecord.displayName ?? null,
      photoURL: userRecord.photoURL ?? null,
      emailVerified: userRecord.emailVerified,
      disabled: userRecord.disabled,
      metadata: {
        creationTime: userRecord.metadata.creationTime,
        lastSignInTime: userRecord.metadata.lastSignInTime ?? null,
      },
      dataCounts,
      workoutPlans,
      deletedWorkoutPlansCount,
      workoutCollections,
      deletedWorkoutCollectionsCount,
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
