import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAuth } from '@/lib/auth'
import { adminAuth } from '@/lib/firebase-admin'
import { getRevenueCatCustomer } from '@/lib/revenuecat'
import { getUserDataCounts, getUserDocument, getUserWorkoutCollections, getUserWorkoutPlans, getUserWorkouts } from '@/lib/firestore'
import type { AdminUserProfile } from '@/types/user'

/** When RevenueCat has no subscription, compute Classic from override or effective/expiry dates (matches Swift). */
function getSubscriptionDisplayLabelFallback(userDoc: {
  classicEligibleOverride?: boolean
  classicEligibleEffectiveDate?: unknown
  classicEligibleExpiryDate?: unknown
} | null): string {
  if (!userDoc) return 'Basic'
  if (typeof userDoc.classicEligibleOverride === 'boolean') {
    return userDoc.classicEligibleOverride ? 'Classic' : 'Basic'
  }
  const now = Date.now()
  const effective = parseTimestamp(userDoc.classicEligibleEffectiveDate)
  const expiry = parseTimestamp(userDoc.classicEligibleExpiryDate)
  if (effective == null || now < effective) return 'Basic'
  if (expiry != null && now >= expiry) return 'Basic'
  return 'Classic'
}

function parseTimestamp(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'string') {
    const ms = new Date(v).getTime()
    return Number.isNaN(ms) ? null : ms
  }
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function')
    return (v as { toDate: () => Date }).toDate().getTime()
  return null
}

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
    const [userRecord, userDoc, revenueCat, dataCounts, allWorkouts, allWorkoutPlans, allWorkoutCollections] = await Promise.all([
      adminAuth.getUser(userId),
      getUserDocument(userId),
      getRevenueCatCustomer(userId),
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

    const providerIdToLabel: Record<string, string> = {
      'google.com': 'Google',
      'apple.com': 'Apple',
      'password': 'Email',
      'phone': 'Phone',
      'anonymous': 'Anonymous',
      'facebook.com': 'Facebook',
      'github.com': 'GitHub',
      'microsoft.com': 'Microsoft',
      'twitter.com': 'Twitter',
      'yahoo.com': 'Yahoo',
    }
    const unknownProviderLabel = 'Guest'
    const providers =
      userRecord.providerData?.length > 0
        ? [...new Set(userRecord.providerData.map((p) => providerIdToLabel[p.providerId] ?? p.providerId))]
        : [unknownProviderLabel]

    const profile: AdminUserProfile = {
      uid: userRecord.uid,
      email: userRecord.email ?? userDoc?.email ?? null,
      displayName: userRecord.displayName ?? null,
      photoURL: userRecord.photoURL ?? null,
      emailVerified: userRecord.emailVerified,
      disabled: userRecord.disabled,
      providers,
      metadata: {
        creationTime: userRecord.metadata.creationTime,
        lastSignInTime: userRecord.metadata.lastSignInTime ?? null,
      },
      firstName: userDoc?.firstName ?? null,
      lastName: userDoc?.lastName ?? null,
      connectedUserDisplay:
        typeof userDoc?.hasConnectedToDisplay === 'boolean'
          ? userDoc.hasConnectedToDisplay
            ? 'Connected User'
            : 'Standalone User'
          : 'Standalone User',
      userTypeDisplay:
        typeof userDoc?.connectedToDisplayType === 'string' && userDoc.connectedToDisplayType !== ''
          ? userDoc.connectedToDisplayType
          : 'noDisplay',
      subscriptionDisplayLabel:
        revenueCat != null && (revenueCat.activeEntitlementIds.length > 0 || revenueCat.activeProductIds.length > 0)
          ? revenueCat.displayLabel
          : getSubscriptionDisplayLabelFallback(userDoc),
      subscriptionInfo: revenueCat
        ? {
            activeEntitlementIds: revenueCat.activeEntitlementIds,
            activeProductIds: revenueCat.activeProductIds,
          }
        : undefined,
      mergedUserIds: userDoc?.mergedUserIds ?? undefined,
      settings: userDoc?.settings ?? undefined,
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

/**
 * DELETE /api/admin/users/[userId]
 * Deletes the user from Firebase Auth (they can no longer sign in).
 */
export async function DELETE(
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
    await adminAuth.deleteUser(userId)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code: string }).code === 'auth/user-not-found'
          ? 'User not found'
          : err instanceof Error ? err.message : String(err)
        : 'Failed to delete user'
    const status =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code: string }).code === 'auth/user-not-found'
          ? 404
          : 500
        : 500
    return NextResponse.json({ error: message }, { status })
  }
}
