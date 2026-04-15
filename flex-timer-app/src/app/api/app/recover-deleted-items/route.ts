import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
  getSoftDeletedOwnedGroupsForUser,
  getUserWorkoutCollections,
  getUserWorkoutPlans,
  getUserWorkouts,
  getWorkoutIdsReferencedByActiveCollections,
} from '@/lib/firestore'
import { getWorkoutDisplayName } from '@/lib/json-workout-format'

function deletedTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

/**
 * GET /api/app/recover-deleted-items
 * Lists owned plans, collections, and workouts where `deletedAt` is set (soft-deleted),
 * plus active workouts not listed on any non-deleted collection (“orphaned”).
 */
export async function GET(request: NextRequest) {
  const authResult = await requireUserAuth(request.headers.get('authorization'))
  if ('status' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  if (!adminAuth) {
    return NextResponse.json(
      { error: 'Firebase Admin not configured' },
      { status: 503 }
    )
  }

  const { uid } = authResult

  try {
    const [allWorkouts, allPlans, allCollections, deletedGroups] = await Promise.all([
      getUserWorkouts(uid),
      getUserWorkoutPlans(uid),
      getUserWorkoutCollections(uid),
      getSoftDeletedOwnedGroupsForUser(uid),
    ])

    const workoutPlans = allPlans
      .filter((p) => Boolean(p.deletedAt))
      .map((p) => ({
        id: p.id,
        workoutPlanName: p.workoutPlanName,
        deletedAt: p.deletedAt ?? null,
      }))
      .sort((a, b) => deletedTimeMs(b.deletedAt) - deletedTimeMs(a.deletedAt))

    const workoutCollections = allCollections
      .filter((c) => Boolean(c.deletedAt))
      .map((c) => ({
        id: c.id,
        workoutCollectionName: c.workoutCollectionName,
        deletedAt: c.deletedAt ?? null,
      }))
      .sort((a, b) => deletedTimeMs(b.deletedAt) - deletedTimeMs(a.deletedAt))

    const workouts = allWorkouts
      .filter((w) => Boolean(w.deletedAt))
      .map((w) => ({
        id: w.id,
        workoutName: w.workoutName,
        /** Same labeling as library / favorites: derived from schedule, segments, or timer mode when name is empty. */
        displayName: getWorkoutDisplayName(w).trim() || w.workoutId.trim() || w.id,
        deletedAt: w.deletedAt ?? null,
      }))
      .sort((a, b) => deletedTimeMs(b.deletedAt) - deletedTimeMs(a.deletedAt))

    const referencedIds = getWorkoutIdsReferencedByActiveCollections(allCollections)
    const orphanedWorkouts = allWorkouts
      .filter((w) => !w.deletedAt && !referencedIds.has(w.id))
      .map((w) => ({
        id: w.id,
        workoutName: w.workoutName,
        displayName: getWorkoutDisplayName(w).trim() || w.workoutId.trim() || w.id,
      }))
      .sort((a, b) => (a.displayName || a.id).localeCompare(b.displayName || b.id))

    const activeCollections = allCollections
      .filter((c) => !c.deletedAt)
      .map((c) => ({ id: c.id, workoutCollectionName: c.workoutCollectionName }))
      .sort((a, b) => a.workoutCollectionName.localeCompare(b.workoutCollectionName))

    const groups = deletedGroups.map((g) => ({
      id: g.groupId,
      name: g.name,
      groupType: g.groupType,
      deletedAt: g.deletedAt,
    }))

    return NextResponse.json({
      workoutPlans,
      workoutCollections,
      workouts,
      orphanedWorkouts,
      groups,
      activeCollections,
    })
  } catch (err) {
    console.error('[app recover-deleted-items]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load deleted items' },
      { status: 500 }
    )
  }
}
