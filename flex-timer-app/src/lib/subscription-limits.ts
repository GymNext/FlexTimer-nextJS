/**
 * Subscription-based limits for the user app (server-only).
 * Basic: 5 favorites, 1 collection, 1 plan.
 * Classic: unlimited favorites, 5 collections, 1 plan.
 * Pro / Pro Plus: unlimited favorites, collections, and plans.
 */

import { getRevenueCatCustomer } from '@/lib/revenuecat'
import { getUserDocument } from '@/lib/firestore'
import {
  UNLIMITED,
  SUBSCRIPTION_TIER,
  type SubscriptionLimits,
  type SubscriptionTier,
} from '@/lib/subscription-limits-constants'

export type { SubscriptionLimits, SubscriptionTier }
export { UNLIMITED, SUBSCRIPTION_TIER }

const LIMITS_BASIC: SubscriptionLimits = {
  tier: 'basic' as SubscriptionTier,
  maxFavorites: 5,
  maxCollections: 1,
  maxPlans: 1,
}

const LIMITS_CLASSIC: SubscriptionLimits = {
  tier: 'classic' as SubscriptionTier,
  maxFavorites: UNLIMITED,
  maxCollections: 5,
  maxPlans: 1,
}

const LIMITS_PRO: SubscriptionLimits = {
  tier: 'pro' as SubscriptionTier,
  maxFavorites: UNLIMITED,
  maxCollections: UNLIMITED,
  maxPlans: UNLIMITED,
}

/**
 * Explicit subscription-tier overrides for internal testing accounts.
 * Keep this list small and temporary.
 */
const TEST_SUBSCRIPTION_TIER_OVERRIDES: Record<string, SubscriptionTier> = {
  '0Xo9G9bp7QhmUSJm7SAJLuag5H43': 'pro',
  /** Local testing: full Pro limits (unlimited favorites, collections, plans). */
  '2A8CVkrOcXO2rQGmdEW4nzBJk8P2': 'pro',
}

/** When RevenueCat has no subscription, compute Classic from user doc override or effective/expiry (matches admin). */
function getTierFallback(userDoc: Awaited<ReturnType<typeof getUserDocument>>): SubscriptionTier {
  if (!userDoc) return 'basic'
  if (typeof userDoc.classicEligibleOverride === 'boolean') {
    return userDoc.classicEligibleOverride ? 'classic' : 'basic'
  }
  const now = Date.now()
  const effective = parseTimestamp(userDoc.classicEligibleEffectiveDate)
  const expiry = parseTimestamp(userDoc.classicEligibleExpiryDate)
  if (effective == null || now < effective) return 'basic'
  if (expiry != null && now >= expiry) return 'basic'
  return 'classic'
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
 * Resolve the user's subscription tier from RevenueCat (and user doc fallback), then return limits.
 * On any failure (network, Firestore, etc.) returns basic limits so the app does not 500.
 */
export async function getSubscriptionLimits(userId: string): Promise<SubscriptionLimits> {
  const testOverrideTier = TEST_SUBSCRIPTION_TIER_OVERRIDES[userId]
  if (testOverrideTier === 'pro') return LIMITS_PRO
  if (testOverrideTier === 'classic') return LIMITS_CLASSIC
  if (testOverrideTier === 'basic') return LIMITS_BASIC

  try {
    const [revenueCat, userDoc] = await Promise.all([
      getRevenueCatCustomer(userId),
      getUserDocument(userId),
    ])

    const hasPro = revenueCat?.activeEntitlementIds?.some(
      (id) => id === 'pro' || id === 'pro_plus'
    )
    const hasClassic = revenueCat?.activeEntitlementIds?.some((id) => id === 'classic')

    if (hasPro) return LIMITS_PRO
    if (hasClassic) return LIMITS_CLASSIC
    if (revenueCat != null && (revenueCat.activeEntitlementIds.length > 0 || revenueCat.activeProductIds.length > 0)) {
      return LIMITS_BASIC
    }
    const fallbackTier = getTierFallback(userDoc)
    return fallbackTier === 'classic' ? LIMITS_CLASSIC : LIMITS_BASIC
  } catch (err) {
    console.error('[getSubscriptionLimits]', userId, err)
    return LIMITS_BASIC
  }
}
