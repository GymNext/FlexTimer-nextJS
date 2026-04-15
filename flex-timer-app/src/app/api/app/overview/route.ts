import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import {
  getUserWorkoutCollections,
  getUserWorkoutPlans,
  getUserWorkouts,
  getUserDocument,
} from '@/lib/firestore'
import { EMPTY_USER_HUB_LOOKUP_IDS, resolveHubLookupLabels } from '@/types/hub-profile'
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
    const [allWorkouts, allWorkoutPlans, allWorkoutCollections, subscriptionLimitsResult, userDoc] =
      await Promise.all([
        getUserWorkouts(uid),
        getUserWorkoutPlans(uid),
        getUserWorkoutCollections(uid),
        getSubscriptionLimits(uid).catch((err) => {
          console.error('[app overview] getSubscriptionLimits failed:', err)
          return null
        }),
        getUserDocument(uid),
      ])

    const settings = userDoc?.settings
    const timerDefaultsParts: {
      direction?: boolean
      restDirection?: number
      warmupDuration?: number
      warmupDirection?: boolean
      cooldownDuration?: number
      cooldownDirection?: boolean
    } = {}
    if (settings && typeof settings.direction === 'boolean')
      timerDefaultsParts.direction = settings.direction === true
    if (settings && typeof settings.restDirection === 'number')
      timerDefaultsParts.restDirection = settings.restDirection
    if (settings && typeof settings.warmupDuration === 'number')
      timerDefaultsParts.warmupDuration = settings.warmupDuration
    if (settings && typeof settings.warmupDirection === 'boolean')
      timerDefaultsParts.warmupDirection = settings.warmupDirection
    if (settings && typeof settings.cooldownDuration === 'number')
      timerDefaultsParts.cooldownDuration = settings.cooldownDuration
    if (settings && typeof settings.cooldownDirection === 'boolean')
      timerDefaultsParts.cooldownDirection = settings.cooldownDirection
    const timerDefaults =
      Object.keys(timerDefaultsParts).length > 0 ? timerDefaultsParts : undefined

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

    const hubLookupIds = userDoc?.hubLookupIds ?? EMPTY_USER_HUB_LOOKUP_IDS
    return NextResponse.json({
      workouts,
      workoutPlans,
      workoutCollections,
      handle: userDoc?.handle ?? null,
      handleKey: userDoc?.handleKey ?? null,
      bio: userDoc?.bio ?? null,
      firstName: userDoc?.firstName ?? null,
      lastName: userDoc?.lastName ?? null,
      profilePhotoUrl: userDoc?.profilePhotoUrl ?? null,
      city: userDoc?.city ?? null,
      region: userDoc?.region ?? null,
      country: userDoc?.country ?? null,
      hubLookupIds,
      hubLookupLabels: resolveHubLookupLabels(hubLookupIds),
      subscriptionLimits,
      timerDefaults,
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

