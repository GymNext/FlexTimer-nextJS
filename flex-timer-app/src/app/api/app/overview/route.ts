import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
  getUserWorkoutCollections,
  getUserWorkoutPlans,
  getUserWorkouts,
} from '@/lib/firestore'
import { getSubscriptionLimits } from '@/lib/subscription-limits'
import type { SubscriptionLimits } from '@/lib/subscription-limits-constants'

/**
 * GET /api/app/overview
 * Returns the signed-in user's workouts, collections, plans (excluding soft-deleted),
 * subscription limits, and current counts for enforcing limits.
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
    const [allWorkouts, allWorkoutPlans, allWorkoutCollections, subscriptionLimitsResult] =
      await Promise.all([
        getUserWorkouts(uid),
        getUserWorkoutPlans(uid),
        getUserWorkoutCollections(uid),
        getSubscriptionLimits(uid).catch((err) => {
          console.error('[app overview] getSubscriptionLimits failed:', err)
          return null
        }),
      ])

    const workouts = allWorkouts.filter((w) => !w.deletedAt)
    const workoutPlans = allWorkoutPlans.filter((p) => !p.deletedAt)
    const workoutCollections = allWorkoutCollections.filter((c) => !c.deletedAt)

    const favoritesCollection = workoutCollections.find((c) => c.id === 'favorite')
    const nonDeletedWorkoutIds = new Set(workouts.map((w) => w.id))
    const favoritesCount =
      favoritesCollection?.workoutIds?.filter((id) => nonDeletedWorkoutIds.has(id)).length ?? 0
    const collectionsCount = workoutCollections.filter((c) => c.id !== 'favorite').length
    const plansCount = workoutPlans.length

    const subscriptionLimits: SubscriptionLimits = subscriptionLimitsResult ?? {
      tier: 'basic',
      maxFavorites: 5,
      maxCollections: 1,
      maxPlans: 1,
    }

    return NextResponse.json({
      workouts,
      workoutPlans,
      workoutCollections,
      subscriptionLimits,
      counts: {
        favorites: favoritesCount,
        collections: collectionsCount,
        plans: plansCount,
      },
    })
  } catch (err) {
    console.error('[app overview]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load overview' },
      { status: 500 }
    )
  }
}

