/**
 * Client-safe subscription limit constants and types.
 * Do not import server-only modules (firestore, revenuecat) here—
 * use subscription-limits.ts for server-side limit resolution.
 */

export const SUBSCRIPTION_TIER = {
  basic: 'basic',
  classic: 'classic',
  pro: 'pro',
} as const

export type SubscriptionTier = (typeof SUBSCRIPTION_TIER)[keyof typeof SUBSCRIPTION_TIER]

/** Use a large number for "unlimited" so APIs and JSON stay simple. */
export const UNLIMITED = 999999

export interface SubscriptionLimits {
  tier: SubscriptionTier
  maxFavorites: number
  maxCollections: number
  maxPlans: number
  /** Shared workout + collection bookmarks (`workoutSubscriptions` / `workoutCollectionSubscriptions`, active). */
  maxBookmarks: number
}
