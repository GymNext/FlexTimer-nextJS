/**
 * RevenueCat + Firestore integration.
 * The RevenueCat Firebase Extension syncs customer/entitlement data to a Firestore
 * document. Configure the document path via REVENUECAT_CUSTOMERS_DOC_PATH.
 *
 * Example paths (use {app_user_id} as placeholder for Firebase UID):
 *   - revenuecat_customers/{app_user_id}  (top-level collection)
 *   - users/{app_user_id}/purchaser-info/{app_user_id}  (subcollection under user)
 */

import { adminDb } from '@/lib/firebase-admin'

/** Entitlement entry as stored by RevenueCat Firebase Extension */
export interface RevenueCatEntitlementInfo {
  expires_date?: string | null
  product_identifier?: string | null
  [key: string]: unknown
}

/** Customer document shape written by RevenueCat Firebase Extension to Firestore */
export interface RevenueCatCustomerDoc {
  app_user_id?: string
  entitlements?: Record<string, RevenueCatEntitlementInfo>
  active_subscriptions?: string[]
  activeSubscriptions?: string[]
  first_seen?: string
  last_seen?: string
  [key: string]: unknown
}

/** Resolved subscription/entitlement info for the admin UI */
export interface RevenueCatSubscriptionInfo {
  /** Active entitlement identifiers (e.g. ['premium', 'pro']) */
  activeEntitlementIds: string[]
  /** Active product IDs (e.g. ['monthly_pro', 'annual_pro']) */
  activeProductIds: string[]
  /** Human-readable label for display (e.g. 'Pro', 'Premium') */
  displayLabel: string
  /** Raw doc for debugging/advanced display */
  raw?: RevenueCatCustomerDoc
}

/** Map RevenueCat entitlement identifiers to display labels. Override via env REVENUECAT_ENTITLEMENT_LABELS (JSON: {"pro":"Pro","premium":"Premium"}). */
const DEFAULT_ENTITLEMENT_LABELS: Record<string, string> = {
  premium: 'Premium',
  pro: 'Pro',
  pro_plus: 'Pro Plus',
  basic: 'Basic',
  classic: 'Classic',
}

function getEntitlementLabels(): Record<string, string> {
  try {
    const raw = process.env.REVENUECAT_ENTITLEMENT_LABELS
    if (raw && typeof raw === 'string') {
      const parsed = JSON.parse(raw) as Record<string, string>
      if (parsed && typeof parsed === 'object') return { ...DEFAULT_ENTITLEMENT_LABELS, ...parsed }
    }
  } catch {
    // ignore
  }
  return DEFAULT_ENTITLEMENT_LABELS
}

function isEntitlementActive(ent: RevenueCatEntitlementInfo): boolean {
  const exp = ent?.expires_date
  if (!exp) return true
  const expiresAt = typeof exp === 'string' ? new Date(exp).getTime() : NaN
  if (Number.isNaN(expiresAt)) return true
  return expiresAt > Date.now()
}

/**
 * Returns the Firestore document path for a customer, with {app_user_id} replaced by userId.
 * Default: users/{app_user_id}/purchaser-info/{app_user_id}
 */
function getRevenueCatCustomerPath(userId: string): string {
  const pathTemplate =
    process.env.REVENUECAT_CUSTOMERS_DOC_PATH ?? 'users/{app_user_id}/purchaser-info/{app_user_id}'
  return pathTemplate.replace(/\{app_user_id\}/g, userId)
}

/**
 * Fetches RevenueCat customer/entitlement data from Firestore for the given user.
 * Returns null if the extension is not configured, the path is missing, or the doc doesn't exist.
 */
export async function getRevenueCatCustomer(
  userId: string
): Promise<RevenueCatSubscriptionInfo | null> {
  if (!adminDb) return null
  const path = getRevenueCatCustomerPath(userId)
  const segments = path.split('/').filter(Boolean)
  if (segments.length < 2) return null
  const docRef = adminDb.doc(path)
  const snap = await docRef.get()
  if (!snap.exists) return null
  const data = snap.data() as RevenueCatCustomerDoc | undefined
  if (!data || typeof data !== 'object') return null

  const entitlements = data.entitlements ?? {}
  const activeProductIds = data.active_subscriptions ?? data.activeSubscriptions ?? []
  const activeEntitlementIds = Object.entries(entitlements)
    .filter(([, ent]) => isEntitlementActive(ent))
    .map(([id]) => id)

  const labels = getEntitlementLabels()
  const displayLabel =
    activeEntitlementIds
      .map((id) => labels[id] ?? id)
      .filter(Boolean)[0] ?? (activeProductIds.length > 0 ? activeProductIds[0] : '—')

  return {
    activeEntitlementIds,
    activeProductIds,
    displayLabel,
    raw: data,
  }
}
