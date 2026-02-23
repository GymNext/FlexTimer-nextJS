import { getApps, getApp, initializeApp, cert, type App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

function getFirebaseAdminApp(): App {
  if (getApps().length > 0) {
    return getApp() as App
  }
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID
  const hasInlineCreds =
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL && process.env.FIREBASE_ADMIN_PRIVATE_KEY
  const credential = hasInlineCreds
    ? cert({
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL!,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      })
    : undefined
  const useDefaultCredentials = !!process.env.GOOGLE_APPLICATION_CREDENTIALS || !hasInlineCreds

  if (!useDefaultCredentials && !credential) {
    throw new Error(
      'Firebase Admin: set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_ADMIN_CLIENT_EMAIL + FIREBASE_ADMIN_PRIVATE_KEY'
    )
  }

  return initializeApp({
    ...(projectId && { projectId }),
    ...(credential && { credential }),
  })
}

let adminApp: App
try {
  adminApp = getFirebaseAdminApp()
} catch {
  adminApp = null as unknown as App
}

export const adminAuth = adminApp ? getAuth(adminApp) : null
export const adminDb = adminApp ? getFirestore(adminApp) : null
