import { adminAuth } from '@/lib/firebase-admin'
import { DEFAULT_ADMIN_USER_IDS } from './admin-user-ids'

const ADMIN_USER_IDS = process.env.ADMIN_USER_IDS
  ? new Set(process.env.ADMIN_USER_IDS.split(',').map((id) => id.trim()).filter(Boolean))
  : new Set(DEFAULT_ADMIN_USER_IDS)

/**
 * Verifies the Firebase ID token from the request and checks if the user is an admin.
 * Use in API routes: pass the Bearer token from Authorization header.
 * Returns { uid } if valid admin, or { error, status } if not.
 */
export async function requireAdminAuth(
  authHeader: string | null
): Promise<
  | { uid: string; error?: undefined }
  | { error: string; status: 401 | 403 | 500 }
> {
  if (!adminAuth) {
    return { error: 'Server: Firebase Admin not configured', status: 500 }
  }

  if (!authHeader?.startsWith('Bearer ')) {
    return { error: 'Missing or invalid Authorization header', status: 401 }
  }

  const token = authHeader.slice(7)
  try {
    const decoded = await adminAuth.verifyIdToken(token)
    const uid = decoded.uid
    if (!ADMIN_USER_IDS.has(uid)) {
      return { error: 'Forbidden: admin access required', status: 403 }
    }
    return { uid }
  } catch (e) {
    // Log the real cause so you can fix project mismatch or credential issues
    console.error('[requireAdminAuth] Token verification failed:', e)
    return { error: 'Invalid or expired token', status: 401 }
  }
}

export function getAdminUserIds(): Set<string> {
  return new Set(ADMIN_USER_IDS)
}
