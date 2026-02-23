import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { DEFAULT_ADMIN_USER_IDS } from './admin-user-ids'

/** Default admin UIDs when ADMIN_USER_IDS env is not set. */
export const ADMIN_USER_IDS = DEFAULT_ADMIN_USER_IDS

// Env vars override defaults. In production, set NEXT_PUBLIC_FIREBASE_* in your host's
// environment (e.g. Vercel / Firebase App Hosting) or rely on these defaults.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? 'AIzaSyA56ZQs97MRdr2U2OfSuMontQLX80fg1Rw',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'gymnext-flex-timer.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'gymnext-flex-timer',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'gymnext-flex-timer.firebasestorage.app',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '641222875087',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '1:641222875087:web:1f1295240f208f39d364ba',
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? 'G-0F1C3W4BZW',
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export { app as firebaseApp }
