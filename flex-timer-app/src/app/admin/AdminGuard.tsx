'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  FacebookAuthProvider,
  OAuthProvider,
  type User,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, setUser)
    setLoading(false)
    return unsubscribe
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Loading…</p>
      </div>
    )
  }

  if (!user) {
    return <AdminSignIn onSuccess={() => router.refresh()} />
  }

  return <>{children}</>
}

function AdminSignIn({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [appleLoading, setAppleLoading] = useState(false)
  const [facebookLoading, setFacebookLoading] = useState(false)

  async function handleGoogleSignIn() {
    setError(null)
    setGoogleLoading(true)
    try {
      await signInWithPopup(auth, new GoogleAuthProvider())
      onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google sign in failed')
    } finally {
      setGoogleLoading(false)
    }
  }

  async function handleAppleSignIn() {
    setError(null)
    setAppleLoading(true)
    try {
      await signInWithPopup(auth, new OAuthProvider('apple.com'))
      onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Apple sign in failed')
    } finally {
      setAppleLoading(false)
    }
  }

  async function handleFacebookSignIn() {
    setError(null)
    setFacebookLoading(true)
    try {
      await signInWithPopup(auth, new FacebookAuthProvider())
      onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Facebook sign in failed')
    } finally {
      setFacebookLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email, password)
      onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setLoading(false)
    }
  }

  const busy = loading || googleLoading || appleLoading || facebookLoading

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white shadow p-6">
        <h1 className="text-lg font-semibold text-gray-900 mb-4">Admin sign in</h1>

        <div className="space-y-2">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded border border-gray-300 bg-white px-4 py-2.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <GoogleIcon className="h-5 w-5" />
            {googleLoading ? 'Signing in…' : 'Sign in with Google'}
          </button>
          <button
            type="button"
            onClick={handleAppleSignIn}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded border border-gray-300 bg-black px-4 py-2.5 text-white hover:bg-gray-800 disabled:opacity-50"
          >
            <AppleIcon className="h-5 w-5" />
            {appleLoading ? 'Signing in…' : 'Sign in with Apple'}
          </button>
          <button
            type="button"
            onClick={handleFacebookSignIn}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded border border-gray-300 bg-[#1877F2] px-4 py-2.5 text-white hover:bg-[#166FE5] disabled:opacity-50"
          >
            <FacebookIcon className="h-5 w-5" />
            {facebookLoading ? 'Signing in…' : 'Sign in with Facebook'}
          </button>
        </div>

        <div className="my-4 flex items-center gap-3">
          <span className="flex-1 border-t border-gray-200" />
          <span className="text-xs text-gray-500">or</span>
          <span className="flex-1 border-t border-gray-200" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#6B21A8' }}
          >
            {loading ? 'Signing in…' : 'Sign in with email'}
          </button>
        </form>
      </div>
    </div>
  )
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  )
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

function adminProviderLabel(providerId: string): string {
  switch (providerId) {
    case 'google.com':
      return 'Google'
    case 'apple.com':
      return 'Apple'
    case 'facebook.com':
      return 'Facebook'
    case 'password':
      return 'Email / Password'
    default:
      return providerId
  }
}

export function AdminHeader() {
  const [user, setUser] = useState<User | null>(null)
  const [userInfoDialogOpen, setUserInfoDialogOpen] = useState(false)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, setUser)
    return unsubscribe
  }, [])

  async function handleSignOut() {
    await signOut(auth)
    window.location.href = '/admin'
  }

  if (!user) {
    return (
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <a href="/admin" className="font-medium text-gray-900">
            FlexTimer Admin
          </a>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Sign out
          </button>
        </div>
      </header>
    )
  }

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <a href="/admin" className="font-medium text-gray-900">
          FlexTimer Admin
        </a>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setUserInfoDialogOpen(true)}
            className="text-sm font-medium text-gray-900 hover:text-gray-600 hover:underline"
            title="View account info"
          >
            {user.email ?? user.displayName ?? 'Signed in'}
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Sign out
          </button>
        </div>
      </div>

      {userInfoDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => setUserInfoDialogOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden">
            <div className="border-b border-gray-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-800">Account info</h2>
            </div>
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-4">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt=""
                    className="h-16 w-16 rounded-full object-cover bg-gray-100"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-full bg-gray-200 flex items-center justify-center text-xl font-medium text-gray-600">
                    {(user.displayName?.[0] ?? user.email?.[0] ?? '?').toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {user.displayName || '—'}
                  </p>
                  {user.email && (
                    <p className="text-xs text-gray-500 truncate">{user.email}</p>
                  )}
                </div>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-gray-500 font-medium">User ID</dt>
                <dd className="font-mono text-gray-900 break-all">{user.uid}</dd>

                {user.phoneNumber && (
                  <>
                    <dt className="text-gray-500 font-medium">Phone</dt>
                    <dd className="text-gray-900">{user.phoneNumber}</dd>
                  </>
                )}

                <dt className="text-gray-500 font-medium">Email verified</dt>
                <dd className="text-gray-900">{user.emailVerified ? 'Yes' : 'No'}</dd>

                <dt className="text-gray-500 font-medium">Login providers</dt>
                <dd className="text-gray-900">
                  {user.providerData?.length
                    ? user.providerData.map((p) => adminProviderLabel(p.providerId)).join(', ')
                    : '—'}
                </dd>

                {user.metadata?.creationTime && (
                  <>
                    <dt className="text-gray-500 font-medium">Account created</dt>
                    <dd className="text-gray-900">
                      {new Date(user.metadata.creationTime).toLocaleString()}
                    </dd>
                  </>
                )}
                {user.metadata?.lastSignInTime && (
                  <>
                    <dt className="text-gray-500 font-medium">Last sign-in</dt>
                    <dd className="text-gray-900">
                      {new Date(user.metadata.lastSignInTime).toLocaleString()}
                    </dd>
                  </>
                )}
              </dl>
            </div>
            <div className="flex justify-end gap-2 px-4 pb-4">
              <button
                type="button"
                onClick={() => setUserInfoDialogOpen(false)}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
