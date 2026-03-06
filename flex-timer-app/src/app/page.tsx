/* Main user app: Firebase Auth gating + favorites / collections / plans UI */
'use client'

import { useEffect, useMemo, useState, Fragment, forwardRef, useImperativeHandle, useCallback, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import headerIcon from './icon.png'
import {
  GoogleAuthProvider,
  FacebookAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import type {
  Workout,
  WorkoutCollection,
  WorkoutPlan,
  PlannedWorkout,
  WorkoutSegment,
} from '@/types/user'
import { UNLIMITED } from '@/lib/subscription-limits-constants'
import type { SubscriptionLimits, SubscriptionTier } from '@/lib/subscription-limits-constants'
import {
  getWorkoutDisplayDescription,
  getWorkoutDisplayName,
  getScheduleDisplayDescription,
  getSegmentDisplayName,
  getTimerModeColor,
  getWorkoutBarColor,
  timerModeToDisplayString,
} from '@/lib/json-workout-format'

type TabId = 'favorites' | 'collections' | 'plans'

interface OverviewData {
  workouts: Workout[]
  workoutPlans: WorkoutPlan[]
  workoutCollections: WorkoutCollection[]
  subscriptionLimits?: SubscriptionLimits
  counts?: { favorites: number; collections: number; plans: number }
}

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewError, setOverviewError] = useState<string | null>(null)

  const resetToDefaultRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (current) => {
        setUser(current)
        setAuthLoading(false)
        setAuthError(null)
        if (!current) {
          setOverview(null)
        }
      },
      (error) => {
        console.error('[auth]', error)
        setAuthError(error.message ?? 'Failed to initialize authentication')
        setAuthLoading(false)
      }
    )
    return unsubscribe
  }, [])

  async function loadOverview(currentUser: User | null) {
    if (!currentUser) return
    setOverviewLoading(true)
    setOverviewError(null)
    try {
      const token = await currentUser.getIdToken()
      const res = await fetch('/api/app/overview', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as OverviewData
      setOverview(data)
    } catch (e) {
      console.error('[overview]', e)
      setOverview(null)
      setOverviewError(
        e instanceof Error ? e.message : 'Failed to load your data'
      )
    } finally {
      setOverviewLoading(false)
    }
  }

  useEffect(() => {
    if (user) {
      loadOverview(user)
    }
  }, [user])

  if (authLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gymnext-page">
        <p className="text-gray-700">Loading…</p>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gymnext-page p-4">
        <SignInScreen authError={authError} />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gymnext-page flex flex-col">
      <AppHeader
        user={user}
        subscriptionTier={overview?.subscriptionLimits?.tier ?? 'basic'}
        onLogoClick={() => resetToDefaultRef.current?.()}
      />
      <section className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        <UserAppLayout
          user={user}
          overview={overview}
          overviewLoading={overviewLoading}
          overviewError={overviewError}
          reloadOverview={() => loadOverview(user)}
          registerResetToDefault={(fn) => {
            resetToDefaultRef.current = fn
          }}
        />
      </section>
      <footer className="border-t border-gymnext-muted/30 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-3 text-xs text-gray-500 flex items-center justify-between">
          <span>GymNext FlexTimer</span>
          <Link
            href="/admin"
            className="text-gymnext hover:text-gymnext-dark font-medium"
          >
            Admin console
          </Link>
        </div>
      </footer>
    </main>
  )
}

function AppHeader({
  user,
  subscriptionTier = 'basic',
  onLogoClick,
}: {
  user: User
  subscriptionTier?: SubscriptionTier
  onLogoClick: () => void
}) {
  async function handleSignOut() {
    await signOut(auth)
  }

  const tierLabel =
    subscriptionTier === 'pro'
      ? 'Pro Tier'
      : subscriptionTier === 'classic'
        ? 'Classic Tier'
        : 'Basic Tier'

  return (
    <header className="border-b border-gymnext-muted/30 bg-white">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onLogoClick}
          className="flex items-center gap-2 rounded-md hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-gymnext/50"
          aria-label="Back to default view"
        >
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center bg-white">
            <Image
              src={headerIcon}
              alt="Flex Timer"
              width={32}
              height={32}
              className="h-8 w-8 object-contain"
            />
          </span>
          <div className="flex flex-col items-start">
            <span className="text-sm font-semibold text-gray-900">
              GymNext FlexTimer
            </span>
            <span className="text-xs text-gray-500">
              Workouts, collections & plans
            </span>
          </div>
        </button>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col items-end text-right">
            <span className="text-xs font-medium text-gray-900">
              {user.email ?? user.displayName ?? 'Signed in'}
            </span>
            <span className="text-xs text-gray-500">{tierLabel}</span>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded border border-gymnext-muted/50 px-3 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-background"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}

function SignInScreen({ authError }: { authError: string | null }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(authError)

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Email/password sign in failed'
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleProviderSignIn(provider: 'google' | 'facebook' | 'apple') {
    setError(null)
    setBusy(true)
    try {
      if (provider === 'google') {
        await signInWithPopup(auth, new GoogleAuthProvider())
      } else if (provider === 'facebook') {
        await signInWithPopup(auth, new FacebookAuthProvider())
      } else {
        await signInWithPopup(auth, new OAuthProvider('apple.com'))
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Sign in with ${provider} failed`
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full max-w-md rounded-xl bg-white shadow-lg border border-gymnext-muted/30 p-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-gray-900">
          Sign in to GymNext FlexTimer
        </h1>
        <p className="text-xs text-gray-500">
          Use your existing account credentials from our mobile application
        </p>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => handleProviderSignIn('apple')}
          className="w-full inline-flex items-center justify-center gap-2 rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-50"
        >
          <img
            src="/icons/apple.png"
            alt=""
            width={20}
            height={20}
            className="shrink-0 object-contain invert"
          />
          <span>Sign In with Apple</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => handleProviderSignIn('google')}
          className="w-full inline-flex items-center justify-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-gray-50 disabled:opacity-50"
        >
          <img
            src="/icons/google.png"
            alt=""
            width={20}
            height={20}
            className="shrink-0 object-contain"
          />
          <span>Sign In with Google</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => handleProviderSignIn('facebook')}
          className="w-full inline-flex items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium text-white hover:opacity-95 disabled:opacity-50"
          style={{ backgroundColor: '#1877F2' }}
        >
          <svg
            width={20}
            height={20}
            viewBox="0 0 24 24"
            fill="currentColor"
            className="shrink-0"
            aria-hidden
          >
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
          </svg>
          <span>Log In with Facebook</span>
        </button>
      </div>

      <div className="flex items-center gap-3">
        <span className="flex-1 border-t border-gray-200" />
        <span className="text-[10px] uppercase tracking-wide text-gray-400">
          Or sign in with email
        </span>
        <span className="flex-1 border-t border-gray-200" />
      </div>

      <form onSubmit={handleEmailSignIn} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
          />
        </div>
        <div>
          <label
            htmlFor="password"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
          />
        </div>
        {error && (
          <p className="text-xs text-red-600 whitespace-pre-line">{error}</p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-gymnext px-3 py-2 text-sm font-medium text-white hover:bg-gymnext-dark disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

function UserAppLayout({
  user,
  overview,
  overviewLoading,
  overviewError,
  reloadOverview,
  registerResetToDefault,
}: {
  user: User
  overview: OverviewData | null
  overviewLoading: boolean
  overviewError: string | null
  reloadOverview: () => void
  registerResetToDefault: (fn: () => void) => void
}) {
  const [activeTab, setActiveTab] = useState<TabId>('favorites')
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [selectedFavoriteWorkout, setSelectedFavoriteWorkout] = useState<Workout | null>(null)
  const [collectionDetail, setCollectionDetail] = useState<{
    collection: WorkoutCollection
    workouts: Workout[]
  } | null>(null)
  const [collectionLoading, setCollectionLoading] = useState(false)
  const [collectionError, setCollectionError] = useState<string | null>(null)

  const [plannedWorkouts, setPlannedWorkouts] = useState<PlannedWorkout[]>([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [plansError, setPlansError] = useState<string | null>(null)
  const [weekStart, setWeekStart] = useState<string>(() => toYYYYMMDD(new Date()))
  const [planViewMode, setPlanViewMode] = useState<'week' | '3day' | '1day'>('1day')

  useEffect(() => {
    const today = toYYYYMMDD(new Date())
    if (planViewMode === '1day') {
      setWeekStart(today)
    } else if (planViewMode === '3day') {
      setWeekStart(addDays(today, -1))
    } else {
      setWeekStart(getMondayOfWeek(new Date()))
    }
  }, [planViewMode])

  const planDayCount = planViewMode === 'week' ? 7 : planViewMode === '3day' ? 3 : 1
  const weekEnd = useMemo(
    () => addDays(weekStart, planDayCount - 1),
    [weekStart, planDayCount]
  )

  const sortedCollections = useMemo(
    () =>
      [...(overview?.workoutCollections ?? [])].sort(
        (a, b) => a.ordinal - b.ordinal
      ),
    [overview?.workoutCollections]
  )

  const favoritesCollection = useMemo(
    () => sortedCollections.find((c) => c.id === 'favorite'),
    [sortedCollections]
  )

  const favoriteWorkouts = useMemo(() => {
    if (!overview?.workouts || !favoritesCollection) return []
    const byId = new Map(overview.workouts.map((w) => [w.id, w]))
    return favoritesCollection.workoutIds
      .map((id) => byId.get(id))
      .filter(Boolean) as Workout[]
  }, [overview?.workouts, favoritesCollection])

  const collectionsExcludingFavorites = useMemo(
    () => sortedCollections.filter((c) => c.id !== 'favorite'),
    [sortedCollections]
  )

  const sortedPlans = useMemo(
    () =>
      [...(overview?.workoutPlans ?? [])].sort(
        (a, b) => a.ordinal - b.ordinal
      ),
    [overview?.workoutPlans]
  )

  async function authedFetch(input: string, init?: RequestInit) {
    const token = await user.getIdToken()
    const headers: HeadersInit = {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    }
    return fetch(input, { ...init, headers })
  }

  async function handleReorderFavorites(index: number, direction: 'up' | 'down') {
    if (!favoritesCollection) return
    const ids = [...favoritesCollection.workoutIds]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= ids.length) return
    ;[ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]]
    try {
      await authedFetch(`/api/app/collections/${encodeURIComponent(favoritesCollection.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workoutIds: ids }),
      })
      await reloadOverview()
    } catch (e) {
      console.error('[favorites reorder]', e)
    }
  }

  async function handleRemoveFromFavorites(workoutId: string) {
    if (!favoritesCollection) return
    const ids = favoritesCollection.workoutIds.filter((id) => id !== workoutId)
    try {
      await authedFetch(`/api/app/collections/${encodeURIComponent(favoritesCollection.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workoutIds: ids }),
      })
      await reloadOverview()
      setSelectedFavoriteWorkout(null)
    } catch (e) {
      console.error('[favorites remove]', e)
    }
  }

  async function handleUpdateCollectionWorkoutIds(collectionId: string, workoutIds: string[]) {
    try {
      await authedFetch(`/api/app/collections/${encodeURIComponent(collectionId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workoutIds }),
      })
      await reloadOverview()
    } catch (e) {
      console.error('[update collection workoutIds]', e)
    }
  }

  const [createFavoriteDialogOpen, setCreateFavoriteDialogOpen] = useState(false)

  async function doCreateFavoriteWorkout(payload: {
    workout: { timerMode: number; workoutSchedule: string; direction?: boolean }
  }) {
    if (!favoritesCollection) throw new Error('No favorites collection')
    const res = await authedFetch(
      `/api/app/collections/${encodeURIComponent(favoritesCollection.id)}/workouts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      throw new Error(json.error || `HTTP ${res.status}`)
    }
    return (await res.json()) as Workout
  }

  async function doCreateWorkoutInCollection(
    collectionId: string,
    payload: {
      workout: { timerMode: number; workoutSchedule: string; direction?: boolean }
    }
  ) {
    const res = await authedFetch(
      `/api/app/collections/${encodeURIComponent(collectionId)}/workouts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      throw new Error(json.error || `HTTP ${res.status}`)
    }
    return (await res.json()) as Workout
  }

  async function handleCreateCollection(name: string, description: string | null) {
    const res = await authedFetch('/api/app/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), description: description?.trim() || null }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      throw new Error(json.error || `HTTP ${res.status}`)
    }
    const created = (await res.json()) as WorkoutCollection
    await reloadOverview()
    return created
  }

  async function handleCreatePlan(name: string, description: string | null) {
    const res = await authedFetch('/api/app/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), description: description?.trim() || null }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      throw new Error(json.error || `HTTP ${res.status}`)
    }
    const created = (await res.json()) as WorkoutPlan
    await reloadOverview()
    return created
  }

  async function handleSaveFavoritePayload(
    workoutId: string,
    data: Record<string, unknown>
  ) {
    const res = await authedFetch(
      `/api/app/workouts/${encodeURIComponent(workoutId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }
    )
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      throw new Error(json.error || `HTTP ${res.status}`)
    }
    const updated = (await res.json()) as Workout
    await reloadOverview()
    setSelectedFavoriteWorkout((prev) =>
      prev?.id === workoutId ? updated : prev
    )
  }

  async function openCollectionDetail(collectionId: string) {
    if (collectionDetail?.collection.id === collectionId) {
      setSelectedCollectionId(null)
      setCollectionDetail(null)
      setCollectionError(null)
      return
    }
    setSelectedCollectionId(collectionId)
    setCollectionDetail(null)
    setCollectionError(null)
    setCollectionLoading(true)
    try {
      const res = await authedFetch(
        `/api/app/collections/${encodeURIComponent(collectionId)}`
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as {
        collection: WorkoutCollection
        workouts: Workout[]
      }
      setCollectionDetail(data)
    } catch (e) {
      setCollectionError(
        e instanceof Error ? e.message : 'Failed to load collection'
      )
    } finally {
      setCollectionLoading(false)
    }
  }

  /** Refetch the currently open collection (e.g. after bookmarks change). */
  async function reloadCollectionDetail() {
    if (!collectionDetail) return
    const collectionId = collectionDetail.collection.id
    try {
      const res = await authedFetch(
        `/api/app/collections/${encodeURIComponent(collectionId)}`
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as {
        collection: WorkoutCollection
        workouts: Workout[]
      }
      setCollectionDetail(data)
    } catch (e) {
      console.error('[reload collection detail]', e)
    }
  }

  async function handleSaveCollectionWorkout(
    workoutId: string,
    data: Record<string, unknown>
  ) {
    const res = await authedFetch(
      `/api/app/workouts/${encodeURIComponent(workoutId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }
    )
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      throw new Error(json.error || `HTTP ${res.status}`)
    }
    await reloadOverview()
    if (
      collectionDetail?.workouts.some((w) => w.id === workoutId)
    ) {
      await reloadCollectionDetail()
    }
  }

  async function handleRemoveWorkoutFromCollection(collectionId: string, workoutId: string) {
    const detail =
      collectionDetail && collectionDetail.collection.id === collectionId
        ? collectionDetail
        : null
    if (!detail) return
    const ids = detail.collection.workoutIds.filter((id) => id !== workoutId)
    try {
      await authedFetch(`/api/app/collections/${encodeURIComponent(collectionId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workoutIds: ids }),
      })
      await reloadOverview()
      setCollectionLoading(true)
      setCollectionError(null)
      try {
        const res = await authedFetch(
          `/api/app/collections/${encodeURIComponent(collectionId)}`
        )
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `HTTP ${res.status}`)
        }
        const data = (await res.json()) as {
          collection: WorkoutCollection
          workouts: Workout[]
        }
        setCollectionDetail(data)
        setSelectedCollectionId(collectionId)
      } catch (e) {
        setCollectionError(
          e instanceof Error ? e.message : 'Failed to load collection'
        )
      } finally {
        setCollectionLoading(false)
      }
    } catch (e) {
      console.error('[collection remove workout]', e)
    }
  }

  async function handleReorderCollectionWorkout(
    collectionId: string,
    index: number,
    direction: 'up' | 'down'
  ) {
    const detail =
      collectionDetail && collectionDetail.collection.id === collectionId
        ? collectionDetail
        : null
    if (!detail) return
    const ids = [...detail.collection.workoutIds]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= ids.length) return
    ;[ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]]
    try {
      await authedFetch(`/api/app/collections/${encodeURIComponent(collectionId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workoutIds: ids }),
      })
      await reloadOverview()
      await reloadCollectionDetail()
    } catch (e) {
      console.error('[collection reorder]', e)
    }
  }

  async function handleReorderCollections(index: number, direction: 'up' | 'down') {
    const userIds = collectionsExcludingFavorites.map((c) => c.id)
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= userIds.length) return
    const newUserIds = [...userIds]
    ;[newUserIds[index], newUserIds[targetIndex]] = [newUserIds[targetIndex], newUserIds[index]]
    const fullIds = sortedCollections.map((c) => c.id)
    const newFullIds = fullIds.map((id) =>
      id === 'favorite' ? id : newUserIds.shift()!
    )
    try {
      await authedFetch('/api/app/collections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionIds: newFullIds }),
      })
      await reloadOverview()
    } catch (e) {
      console.error('[collections reorder]', e)
    }
  }

  async function handleUpdateCollection(
    collectionId: string,
    name: string,
    description: string | null
  ) {
    const res = await authedFetch(
      `/api/app/collections/${encodeURIComponent(collectionId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workoutCollectionName: name,
          workoutCollectionDescription: description,
        }),
      }
    )
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to update collection')
    }
    await reloadOverview()
    if (collectionDetail?.collection.id === collectionId) {
      await reloadCollectionDetail()
    }
  }

  async function handleDeleteCollection(collectionId: string) {
    try {
      await authedFetch(
        `/api/app/collections/${encodeURIComponent(collectionId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      )
      await reloadOverview()
      setSelectedCollectionId(null)
      setCollectionDetail(null)
    } catch (e) {
      console.error('[collection delete]', e)
    }
  }

  async function handleUpdatePlan(
    planId: string,
    name: string,
    description: string | null
  ) {
    const res = await authedFetch(
      `/api/app/plans/${encodeURIComponent(planId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workoutPlanName: name,
          workoutPlanDescription: description,
        }),
      }
    )
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to update plan')
    }
    await reloadOverview()
  }

  async function handleReorderPlans(index: number, direction: 'up' | 'down') {
    const ids = sortedPlans.map((p) => p.id)
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= ids.length) return
    ;[ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]]
    try {
      await authedFetch('/api/app/plans', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planIds: ids }),
      })
      await reloadOverview()
    } catch (e) {
      console.error('[plans reorder]', e)
    }
  }

  async function handleDeletePlan(planId: string) {
    try {
      await authedFetch(`/api/app/plans/${encodeURIComponent(planId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      await reloadOverview()
      setSelectedPlanId(null)
    } catch (e) {
      console.error('[plan delete]', e)
    }
  }

  async function loadPlannedWorkoutsForPlan(planId: string) {
    setSelectedPlanId(planId)
    setPlansLoading(true)
    setPlansError(null)
    try {
      const res = await authedFetch(
        `/api/app/plans/${encodeURIComponent(
          planId
        )}/planned-workouts?from=${encodeURIComponent(
          weekStart
        )}&to=${encodeURIComponent(weekEnd)}`
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as { plannedWorkouts: PlannedWorkout[] }
      setPlannedWorkouts(data.plannedWorkouts ?? [])
    } catch (e) {
      setPlansError(
        e instanceof Error ? e.message : 'Failed to load planned workouts'
      )
      setPlannedWorkouts([])
    } finally {
      setPlansLoading(false)
    }
  }

  const byDay = useMemo(() => {
    const map: Record<string, PlannedWorkout[]> = {}
    const weekDays = Array.from({ length: planDayCount }, (_, i) =>
      addDays(weekStart, i)
    )
    weekDays.forEach((d) => (map[d] = []))
    plannedWorkouts.forEach((pw) => {
      const key = pw.day.slice(0, 10)
      if (!map[key]) map[key] = []
      map[key].push(pw)
    })
    weekDays.forEach((d) => {
      if (map[d]) map[d].sort((a, b) => a.ordinal - b.ordinal)
    })
    return map
  }, [plannedWorkouts, weekStart, planDayCount])

  async function handleReorderPlannedWithinDay(
    dayKey: string,
    index: number,
    direction: 'up' | 'down'
  ) {
    const items = [...(byDay[dayKey] ?? [])]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= items.length) return
    ;[items[index], items[targetIndex]] = [items[targetIndex], items[index]]
    // Reassign ordinals 0..n-1 for this day
    try {
      await Promise.all(
        items.map((pw, idx) =>
          authedFetch(
            `/api/app/plans/${encodeURIComponent(
              pw.planId
            )}/planned-workouts/${encodeURIComponent(pw.id)}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ordinal: idx }),
            }
          )
        )
      )
      if (selectedPlanId) {
        await loadPlannedWorkoutsForPlan(selectedPlanId)
      }
    } catch (e) {
      console.error('[planned reorder]', e)
    }
  }

  async function handleDeletePlanned(pw: PlannedWorkout) {
    try {
      await authedFetch(
        `/api/app/plans/${encodeURIComponent(
          pw.planId
        )}/planned-workouts/${encodeURIComponent(pw.id)}`,
        { method: 'DELETE' }
      )
      if (selectedPlanId) {
        await loadPlannedWorkoutsForPlan(selectedPlanId)
      }
    } catch (e) {
      console.error('[planned delete]', e)
    }
  }

  useEffect(() => {
    if (selectedPlanId) {
      loadPlannedWorkoutsForPlan(selectedPlanId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, planDayCount])

  useEffect(() => {
    registerResetToDefault(() => {
      setActiveTab('favorites')
      setSelectedCollectionId(null)
      setCollectionDetail(null)
      setSelectedPlanId(null)
      setSelectedFavoriteWorkout(null)
    })
    return () => registerResetToDefault(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="inline-flex rounded-md border border-gymnext-muted/40 bg-white p-0.5">
          <TabButton
            id="favorites"
            active={activeTab === 'favorites'}
            onClick={() => setActiveTab('favorites')}
          >
            Favorites
          </TabButton>
          <TabButton
            id="collections"
            active={activeTab === 'collections'}
            onClick={() => setActiveTab('collections')}
          >
            Collections
          </TabButton>
          <TabButton
            id="plans"
            active={activeTab === 'plans'}
            onClick={() => setActiveTab('plans')}
          >
            Plans
          </TabButton>
        </div>
      </div>

      {overviewLoading && !overview && (
        <p className="text-sm text-gray-500">Loading your data…</p>
      )}
      {overviewError && (
        <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">
          {overviewError}
        </div>
      )}

      {!overview && !overviewLoading && !overviewError && (
        <p className="text-sm text-gray-500">
          No data found yet. Create workouts and collections in the FlexTimer
          mobile app and they will appear here.
        </p>
      )}

      {overview && (
        <>
          {activeTab === 'favorites' && (
            <FavoritesSection
              favoritesCollection={favoritesCollection}
              favoriteWorkouts={favoriteWorkouts}
              allCollections={sortedCollections}
              onUpdateCollectionWorkoutIds={handleUpdateCollectionWorkoutIds}
              onReloadCollectionDetail={reloadCollectionDetail}
              selectedWorkout={selectedFavoriteWorkout}
              onSelectWorkout={setSelectedFavoriteWorkout}
              onReorder={handleReorderFavorites}
              onRemoveFromFavorites={handleRemoveFromFavorites}
              onSave={handleSaveFavoritePayload}
              createDialogOpen={createFavoriteDialogOpen}
              onOpenCreateDialog={() => setCreateFavoriteDialogOpen(true)}
              onCloseCreateDialog={() => setCreateFavoriteDialogOpen(false)}
              doCreateFavoriteWorkout={doCreateFavoriteWorkout}
              onCreatedWorkout={(w) => {
                setSelectedFavoriteWorkout(w)
                setCreateFavoriteDialogOpen(false)
                reloadOverview()
              }}
              maxFavorites={overview?.subscriptionLimits?.maxFavorites ?? UNLIMITED}
              favoritesCount={overview?.counts?.favorites ?? 0}
            />
          )}
          {activeTab === 'collections' && (
            <CollectionsSection
              collections={collectionsExcludingFavorites}
              collectionDetail={collectionDetail}
              allCollections={sortedCollections}
              onUpdateCollectionWorkoutIds={handleUpdateCollectionWorkoutIds}
              onReloadCollectionDetail={reloadCollectionDetail}
              collectionLoading={collectionLoading}
              collectionError={collectionError}
              openCollectionDetail={openCollectionDetail}
              onReorderWorkout={handleReorderCollectionWorkout}
              onReorderCollections={handleReorderCollections}
              onRemoveWorkoutFromCollection={handleRemoveWorkoutFromCollection}
              onCreateCollection={handleCreateCollection}
              onUpdateCollection={handleUpdateCollection}
              onDeleteCollection={handleDeleteCollection}
              onSaveWorkout={handleSaveCollectionWorkout}
              maxCollections={overview?.subscriptionLimits?.maxCollections ?? UNLIMITED}
              collectionsCount={overview?.counts?.collections ?? 0}
              maxFavorites={overview?.subscriptionLimits?.maxFavorites ?? UNLIMITED}
              createWorkoutInCollection={doCreateWorkoutInCollection}
            />
          )}
          {activeTab === 'plans' && (
            <PlansSection
              plans={sortedPlans}
              selectedPlanId={selectedPlanId}
              setSelectedPlanId={(id) => {
                setSelectedPlanId(id)
                if (id) loadPlannedWorkoutsForPlan(id)
              }}
              weekStart={weekStart}
              setWeekStart={setWeekStart}
              weekEnd={weekEnd}
              byDay={byDay}
              planViewMode={planViewMode}
              setPlanViewMode={setPlanViewMode}
              planDayCount={planDayCount}
              plansLoading={plansLoading}
              plansError={plansError}
              onReorderPlanned={handleReorderPlannedWithinDay}
              onDeletePlanned={handleDeletePlanned}
              user={user}
              reloadPlanned={() => {
                if (selectedPlanId) loadPlannedWorkoutsForPlan(selectedPlanId)
              }}
              onCreatePlan={handleCreatePlan}
              onUpdatePlan={handleUpdatePlan}
              onDeletePlan={handleDeletePlan}
              maxPlans={overview?.subscriptionLimits?.maxPlans ?? UNLIMITED}
              plansCount={overview?.counts?.plans ?? 0}
              subscriptionTier={overview?.subscriptionLimits?.tier ?? 'basic'}
              onReorderPlans={handleReorderPlans}
              favoriteWorkouts={favoriteWorkouts}
              collectionsExcludingFavorites={collectionsExcludingFavorites}
              workoutsById={overview?.workouts ? new Map(overview.workouts.map((w) => [w.id, w])) : new Map()}
            />
          )}
        </>
      )}
    </div>
  )
}

function TabButton({
  id,
  active,
  onClick,
  children,
}: {
  id: TabId
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-md ${
        active
          ? 'text-white shadow-sm'
          : 'text-gray-700 hover:bg-gymnext-background'
      }`}
      style={active ? { backgroundColor: '#6B21A8' } : undefined}
    >
      {children}
    </button>
  )
}

function CreateWorkoutDialog({
  onClose,
  createWorkout,
  onSaveWorkout,
  onCreated,
  title = 'Create new favorite workout',
}: {
  onClose: () => void
  createWorkout: (payload: {
    workout: { timerMode: number; workoutSchedule: string; direction?: boolean }
  }) => Promise<Workout>
  onSaveWorkout: (workoutId: string, data: Record<string, unknown>) => Promise<void>
  onCreated: (workout: Workout) => void
  title?: string
}) {
  const [step, setStep] = useState(1)
  const [mode, setMode] = useState(1)
  const [options, setOptions] = useState<Record<string, string | number>>({})
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const built = useMemo(
    () => buildWorkoutFromCreateForm(mode, options) as { workoutSchedule: string; direction: boolean },
    [mode, options]
  )

  async function handleCreate() {
    if (!hasValidDurationForMode(mode, options, parseDurationInput)) {
      setError('Warmup, Cooldown, and Rest require a duration greater than 0:00.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const created = await createWorkout({
        workout: {
          timerMode: mode,
          workoutSchedule: built.workoutSchedule,
          direction: built.direction,
        },
      })
      if (name.trim() || description.trim()) {
        await onSaveWorkout(created.id, {
          workoutName: name.trim() || null,
          workoutDescription: description.trim() || null,
        })
      }
      onCreated({
        ...created,
        workoutName: name.trim() || null,
        workoutDescription: description.trim() || null,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create workout')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden
        onClick={() => !busy && onClose()}
      />
      <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
        <div className="border-b border-gymnext-muted/30 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-800">
            {title}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {step === 1 && 'Choose the workout type.'}
            {step === 2 && 'Configure the timer settings for this workout.'}
            {step === 3 && 'Optionally set a name and description.'}
          </p>
        </div>
        <div className="p-4 space-y-4">
          {step === 1 && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Workout type
                </label>
                <select
                  value={mode}
                  onChange={(e) => {
                    setMode(Number(e.target.value))
                    setOptions({})
                  }}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                >
                  {CREATABLE_TIMER_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="rounded text-white text-sm font-medium px-3 py-2 hover:opacity-90"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  Next
                </button>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <CreateWorkoutOptions
                mode={mode}
                options={options}
                onChange={setOptions}
                parseDurationInput={parseDurationInput}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  disabled={busy}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  disabled={!hasValidDurationForMode(mode, options, parseDurationInput)}
                  className="rounded text-white text-sm font-medium px-3 py-2 hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  Next
                </button>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Name (optional)
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  placeholder="Workout name"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Description (optional)
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  placeholder="Optional description"
                />
              </div>
              {error && (
                <p className="text-xs text-red-600">{error}</p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={busy}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={busy || !hasValidDurationForMode(mode, options, parseDurationInput)}
                  className="rounded text-white text-sm font-medium px-3 py-2 hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  {busy ? 'Creating…' : 'Create workout'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function FavoritesSection({
  favoritesCollection,
  favoriteWorkouts,
  allCollections,
  onUpdateCollectionWorkoutIds,
  onReloadCollectionDetail,
  selectedWorkout,
  onSelectWorkout,
  onReorder,
  onRemoveFromFavorites,
  onSave,
  createDialogOpen,
  onOpenCreateDialog,
  onCloseCreateDialog,
  doCreateFavoriteWorkout,
  onCreatedWorkout,
  maxFavorites,
  favoritesCount,
}: {
  favoritesCollection: WorkoutCollection | undefined
  favoriteWorkouts: Workout[]
  allCollections: WorkoutCollection[]
  onUpdateCollectionWorkoutIds: (collectionId: string, workoutIds: string[]) => Promise<void>
  onReloadCollectionDetail?: () => Promise<void>
  selectedWorkout: Workout | null
  onSelectWorkout: (workout: Workout | null) => void
  onReorder: (index: number, direction: 'up' | 'down') => void
  onRemoveFromFavorites: (workoutId: string) => Promise<void>
  onSave: (workoutId: string, data: Record<string, unknown>) => Promise<void>
  createDialogOpen: boolean
  onOpenCreateDialog: () => void
  onCloseCreateDialog: () => void
  doCreateFavoriteWorkout: (payload: {
    workout: { timerMode: number; workoutSchedule: string; direction?: boolean }
  }) => Promise<Workout>
  onCreatedWorkout: (workout: Workout) => void
  maxFavorites?: number
  favoritesCount?: number
}) {
  const [editingWorkout, setEditingWorkout] = useState<Workout | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)

  const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false)
  const [bookmarkSelectedIds, setBookmarkSelectedIds] = useState<Set<string>>(new Set())
  const [bookmarkSaving, setBookmarkSaving] = useState(false)

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [unsavedConfirmOpen, setUnsavedConfirmOpen] = useState(false)
  type PendingUnsavedAction =
    | { type: 'switch'; workout: Workout | null }
    | { type: 'openEdit'; workout: Workout }
  const [pendingUnsavedAction, setPendingUnsavedAction] = useState<PendingUnsavedAction | null>(null)
  const detailPanelRef = useRef<{ save: () => Promise<void> }>(null)

  const maxFav = maxFavorites ?? UNLIMITED
  const count = favoritesCount ?? 0
  const atFavoritesLimit = maxFav < UNLIMITED && count >= maxFav
  const favoritesLabel =
    maxFav >= UNLIMITED
      ? favoritesCollection
        ? ` (${favoriteWorkouts.length})`
        : ''
      : favoritesCollection
        ? ` (${count} / ${maxFav})`
        : ''

  function openEdit(w: Workout) {
    setEditingWorkout(w)
    setEditName(w.workoutName ?? '')
    setEditDescription(w.workoutDescription ?? '')
    setEditError(null)
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingWorkout) return
    setEditError(null)
    setEditBusy(true)
    try {
      await onSave(editingWorkout.id, {
        workoutName: editName.trim() || null,
        workoutDescription: editDescription.trim() || null,
      })
      setEditingWorkout(null)
      setEditName('')
      setEditDescription('')
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update workout')
    } finally {
      setEditBusy(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)]">
      <div className="rounded-lg border border-gymnext-muted/30 bg-white overflow-hidden">
        <div className="border-b border-gymnext-muted/30 bg-gymnext-background px-4 py-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-gray-800">
            Favorites
            {favoritesLabel}
          </h3>
          {favoritesCollection && (
            <button
              type="button"
              onClick={onOpenCreateDialog}
              disabled={atFavoritesLimit}
              title={atFavoritesLimit ? `Your plan allows up to ${maxFav} favorites. Upgrade to add more.` : undefined}
              className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#6B21A8' }}
            >
              Create new favorite workout
            </button>
          )}
        </div>
        {!favoritesCollection ? (
          <p className="px-4 py-6 text-sm text-gray-500">
            No favorites collection found. Mark workouts as favorites in the
            FlexTimer app and they will appear here.
          </p>
        ) : favoriteWorkouts.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">
            No workouts in favorites yet. Create one or add from the mobile app.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 max-h-[60vh] overflow-y-auto">
            {favoriteWorkouts.map((w, index) => {
              const barColor = getWorkoutBarColor(w)
              const isSelected = selectedWorkout?.id === w.id
              const nextSelection = isSelected ? null : w
              const wouldSwitch =
                selectedWorkout !== null &&
                (nextSelection === null || selectedWorkout.id !== nextSelection.id)
              function handleSelectWorkoutClick() {
                if (wouldSwitch && hasUnsavedChanges) {
                  setPendingUnsavedAction({ type: 'switch', workout: nextSelection })
                  setUnsavedConfirmOpen(true)
                } else {
                  onSelectWorkout(nextSelection)
                }
              }
              return (
              <li
                key={w.id}
                className={`pl-1 pr-4 py-3 flex items-center gap-3 cursor-pointer border-l-8 ${
                  isSelected
                    ? 'bg-gymnext-background'
                    : 'hover:bg-gray-100'
                }`}
                style={{ borderLeftColor: barColor }}
                onClick={handleSelectWorkoutClick}
              >
                <span className="w-5 shrink-0 flex items-center justify-center" aria-hidden>
                  {isSelected && (
                    <span style={{ color: barColor }} aria-label="Active workout">
                      ✓
                    </span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {getWorkoutDisplayName(w) || w.workoutId}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {getWorkoutDisplayDescription(w) || '—'}
                  </p>
                </div>
                <div
                  className="inline-flex items-center gap-1 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (hasUnsavedChanges) {
                        setPendingUnsavedAction({ type: 'openEdit', workout: w })
                        setUnsavedConfirmOpen(true)
                      } else {
                        openEdit(w)
                      }
                    }}
                    className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                    aria-label="Edit workout"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onReorder(index, 'up')}
                    className="h-7 w-7 inline-flex items-center justify-center rounded border border-gymnext-muted/50 text-gray-700 hover:bg-gymnext-background"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => onReorder(index, 'down')}
                    className="h-7 w-7 inline-flex items-center justify-center rounded border border-gymnext-muted/50 text-gray-700 hover:bg-gymnext-background"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                </div>
              </li>
            )
            })}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-gymnext-muted/30 bg-white overflow-hidden">
        {selectedWorkout ? (
          <>
            <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-2 relative">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">
                  {getWorkoutDisplayName(selectedWorkout) || selectedWorkout.workoutId}
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  {getWorkoutDisplayDescription(selectedWorkout) || '—'}
                </p>
              </div>
              <div className="shrink-0">
                <button
                  type="button"
                  onClick={() => setMoreMenuOpen((open) => !open)}
                  className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  aria-label="More options"
                  aria-expanded={moreMenuOpen}
                >
                  ⋯
                </button>
                {moreMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      aria-hidden
                      onClick={() => setMoreMenuOpen(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        onClick={() => {
                          setMoreMenuOpen(false)
                          setBookmarkSelectedIds(
                            new Set(
                              allCollections.filter((c) =>
                                c.workoutIds.includes(selectedWorkout.id)
                              ).map((c) => c.id)
                            )
                          )
                          setBookmarkDialogOpen(true)
                        }}
                      >
                        Update bookmarks
                      </button>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                        onClick={() => {
                          setMoreMenuOpen(false)
                          setRemoveConfirmOpen(true)
                        }}
                      >
                        Remove from favorites
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              <FavoritesDetailPanel
                workout={selectedWorkout}
                ref={detailPanelRef}
                onDirtyChange={setHasUnsavedChanges}
                onSave={onSave}
                onClose={() => onSelectWorkout(null)}
                scheduleOnly
              />
            </div>
          </>
        ) : (
          <div className="px-4 py-12 text-center text-sm text-gray-500">
            Select a workout from the list to view and edit its schedule.
          </div>
        )}
      </div>

      {bookmarkDialogOpen && selectedWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !bookmarkSaving && setBookmarkDialogOpen(false)}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg flex flex-col max-h-[80vh]">
            <div className="border-b border-gymnext-muted/30 px-4 py-3 shrink-0">
              <h3 className="text-sm font-semibold text-gray-800">Update bookmarks</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Choose which collections include this workout
              </p>
            </div>
            <div className="overflow-y-auto p-2 min-h-0">
              {allCollections.map((c) => {
                const isChecked = bookmarkSelectedIds.has(c.id)
                const displayName = c.id === 'favorite' ? 'Favorites' : c.workoutCollectionName
                const favoritesAtLimitCannotAdd =
                  c.id === 'favorite' && atFavoritesLimit && !isChecked
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={favoritesAtLimitCannotAdd}
                    title={
                      favoritesAtLimitCannotAdd
                        ? `Favorites is at its limit (${maxFav}). Upgrade to add more.`
                        : undefined
                    }
                    onClick={() => {
                      if (favoritesAtLimitCannotAdd) return
                      setBookmarkSelectedIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(c.id)) next.delete(c.id)
                        else next.add(c.id)
                        return next
                      })
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-gray-50 text-left disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                        isChecked
                          ? 'bg-gymnext border-gymnext text-white'
                          : 'border-gray-300 bg-white'
                      }`}
                      style={isChecked ? { backgroundColor: '#6B21A8', borderColor: '#6B21A8' } : undefined}
                    >
                      {isChecked ? '✓' : ''}
                    </span>
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {displayName}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="border-t border-gymnext-muted/30 px-4 py-3 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setBookmarkDialogOpen(false)}
                disabled={bookmarkSaving}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={bookmarkSaving}
                onClick={async () => {
                  if (!selectedWorkout) return
                  setBookmarkSaving(true)
                  try {
                    for (const c of allCollections) {
                      const wantIn = bookmarkSelectedIds.has(c.id)
                      const hasIn = c.workoutIds.includes(selectedWorkout.id)
                      if (wantIn === hasIn) continue
                      const newIds = wantIn
                        ? [...c.workoutIds, selectedWorkout.id]
                        : c.workoutIds.filter((id) => id !== selectedWorkout.id)
                      await onUpdateCollectionWorkoutIds(c.id, newIds)
                    }
                    await onReloadCollectionDetail?.()
                    if (favoritesCollection && !bookmarkSelectedIds.has(favoritesCollection.id)) {
                      onSelectWorkout(null)
                    }
                    setBookmarkDialogOpen(false)
                  } catch (e) {
                    console.error('[bookmark save]', e)
                  } finally {
                    setBookmarkSaving(false)
                  }
                }}
                className="rounded px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#6B21A8' }}
              >
                {bookmarkSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {removeConfirmOpen && selectedWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => setRemoveConfirmOpen(false)}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <p className="text-sm text-gray-800">
              Remove this workout from favorites?
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setRemoveConfirmOpen(false)}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onRemoveFromFavorites(selectedWorkout.id)
                  setRemoveConfirmOpen(false)
                }}
                className="rounded px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700"
              >
                Remove from favorites
              </button>
            </div>
          </div>
        </div>
      )}

      {unsavedConfirmOpen && pendingUnsavedAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => {
              setUnsavedConfirmOpen(false)
              setPendingUnsavedAction(null)
            }}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <p className="text-sm text-gray-800">
              You have unsaved changes. Save, discard, or cancel?
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => {
                  setUnsavedConfirmOpen(false)
                  setPendingUnsavedAction(null)
                }}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setUnsavedConfirmOpen(false)
                  if (pendingUnsavedAction.type === 'switch') {
                    onSelectWorkout(pendingUnsavedAction.workout)
                  } else {
                    openEdit(pendingUnsavedAction.workout)
                  }
                  setPendingUnsavedAction(null)
                }}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await detailPanelRef.current?.save()
                    setUnsavedConfirmOpen(false)
                    if (pendingUnsavedAction.type === 'switch') {
                      onSelectWorkout(pendingUnsavedAction.workout)
                    } else {
                      openEdit(pendingUnsavedAction.workout)
                    }
                    setPendingUnsavedAction(null)
                  } catch {
                    // keep dialog open on save error
                  }
                }}
                className="rounded px-3 py-2 text-sm font-medium text-white bg-gymnext hover:bg-gymnext-dark"
                style={{ backgroundColor: '#6B21A8' }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {editingWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !editBusy && setEditingWorkout(null)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
            <div className="border-b border-gymnext-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">Edit workout</h3>
              <p className="text-xs text-gray-500 mt-0.5">Change the name and description.</p>
            </div>
            <form onSubmit={handleEditSubmit} className="p-4 space-y-4">
              <div>
                <label htmlFor="fav-edit-name" className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                <input
                  id="fav-edit-name"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  placeholder="Workout name"
                />
              </div>
              <div>
                <label htmlFor="fav-edit-desc" className="block text-xs font-medium text-gray-700 mb-1">Description (optional)</label>
                <textarea
                  id="fav-edit-desc"
                  rows={3}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  placeholder="Optional description"
                />
              </div>
              {editError && <p className="text-xs text-red-600">{editError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingWorkout(null)}
                  disabled={editBusy}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editBusy}
                  className="rounded text-white text-sm font-medium px-3 py-2 hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  {editBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {createDialogOpen && favoritesCollection && (
        <CreateWorkoutDialog
          onClose={onCloseCreateDialog}
          createWorkout={doCreateFavoriteWorkout}
          onSaveWorkout={onSave}
          onCreated={onCreatedWorkout}
        />
      )}
    </div>
  )
}

const FavoritesDetailPanel = forwardRef<
  { save: () => Promise<void> },
  {
    workout: Workout
    onSave: (workoutId: string, data: Record<string, unknown>) => Promise<void>
    onClose: () => void
    scheduleOnly?: boolean
    onDirtyChange?: (dirty: boolean) => void
  }
>(function FavoritesDetailPanel({
  workout,
  onSave,
  onClose,
  scheduleOnly = false,
  onDirtyChange,
}: {
  workout: Workout
  onSave: (workoutId: string, data: Record<string, unknown>) => Promise<void>
  onClose: () => void
  scheduleOnly?: boolean
  onDirtyChange?: (dirty: boolean) => void
}, ref: React.Ref<{ save: () => Promise<void> }>) {
  const [name, setName] = useState(workout.workoutName ?? '')
  const [description, setDescription] = useState(workout.workoutDescription ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  const isSingle = workout.type === 'SingleSegmentWorkout'
  const parsed = useMemo(
    () => (isSingle ? parseScheduleToOptions(workout.workoutSchedule) : null),
    [isSingle, workout.workoutSchedule]
  )
  const [scheduleMode, setScheduleMode] = useState(parsed?.mode ?? 1)
  const [scheduleOptions, setScheduleOptions] = useState<Record<string, string | number>>(parsed?.options ?? {})
  const [scheduleDirection, setScheduleDirection] = useState(parsed?.direction ?? false)

  const [segments, setSegments] = useState<WorkoutSegment[]>(
    workout.type === 'MultiSegmentWorkout' && workout.segments ? [...workout.segments] : []
  )
  const [expandedSegmentIndex, setExpandedSegmentIndex] = useState<number | null>(null)

  useEffect(() => {
    setName(workout.workoutName ?? '')
    setDescription(workout.workoutDescription ?? '')
    setIsDirty(false)
  }, [workout.id, workout.workoutName, workout.workoutDescription])

  useEffect(() => {
    if (parsed) {
      setScheduleMode(parsed.mode)
      setScheduleOptions(parsed.options)
      setScheduleDirection(parsed.direction)
    }
  }, [parsed?.mode, parsed?.options, parsed?.direction])

  useEffect(() => {
    if (workout.type === 'MultiSegmentWorkout' && workout.segments) {
      setSegments([...workout.segments])
    }
    setIsDirty(false)
  }, [workout.id, workout.type, workout.segments])

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const doSave = useCallback(async () => {
    if (
      isSingle &&
      !hasValidDurationForMode(scheduleMode, { ...scheduleOptions, direction: scheduleDirection }, parseDurationInput)
    ) {
      setError('Warmup, Cooldown, and Rest require a duration greater than 0:00.')
      return
    }
    if (!isSingle && segments.length > 0) {
      for (const seg of segments) {
        if (!seg.workoutSchedule) continue
        try {
          const s = JSON.parse(seg.workoutSchedule) as Record<string, unknown>
          const mode = typeof s.timerMode === 'number' ? s.timerMode : 0
          if (mode === 10 || mode === 11 || mode === 13) {
            const cap =
              mode === 10
                ? (s.warmupTimeCap as number | undefined)
                : mode === 11
                  ? (s.cooldownTimeCap as number | undefined)
                  : (s.restTimeCap as number | undefined)
            if (cap === undefined || cap === null || Number(cap) <= 0) {
              setError('Warmup, Cooldown, and Rest require a duration greater than 0:00.')
              return
            }
          }
        } catch {
          // ignore parse errors
        }
      }
    }
    setError(null)
    setSaving(true)
    try {
      const nameDesc = scheduleOnly
        ? { workoutName: workout.workoutName ?? null, workoutDescription: workout.workoutDescription ?? null }
        : { workoutName: name.trim() || null, workoutDescription: description.trim() || null }
      if (isSingle) {
        const built = buildWorkoutFromCreateForm(scheduleMode, {
          ...scheduleOptions,
          direction: scheduleDirection,
        }) as { workoutSchedule: string; direction: boolean }
        await onSave(workout.id, {
          ...nameDesc,
          timerMode: scheduleMode,
          workoutSchedule: built.workoutSchedule,
          direction: built.direction,
        })
      } else {
        await onSave(workout.id, {
          ...nameDesc,
          segments,
        })
      }
      setIsDirty(false)
      onDirtyChange?.(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [
    scheduleOnly,
    workout,
    name,
    description,
    isSingle,
    scheduleMode,
    scheduleOptions,
    scheduleDirection,
    segments,
    onSave,
    onDirtyChange,
  ])

  useImperativeHandle(ref, () => ({ save: doSave }), [doSave])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await doSave()
  }

  function moveSegment(index: number, direction: 'up' | 'down') {
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= segments.length) return
    const next = [...segments]
    ;[next[index], next[target]] = [next[target], next[index]]
    setSegments(next)
    setIsDirty(true)
    if (expandedSegmentIndex === index) setExpandedSegmentIndex(target)
    else if (expandedSegmentIndex === target) setExpandedSegmentIndex(index)
  }

  function deleteSegment(index: number) {
    setSegments((prev) => prev.filter((_, i) => i !== index))
    setIsDirty(true)
    if (expandedSegmentIndex === index) setExpandedSegmentIndex(null)
    else if (expandedSegmentIndex != null && expandedSegmentIndex > index) setExpandedSegmentIndex(expandedSegmentIndex - 1)
  }

  function addSegment() {
    const defaultSchedule = JSON.stringify({ timerMode: 1, standardTimeCap: 0 })
    setSegments((prev) => [
      ...prev,
      {
        workoutId: `${workout.workoutId}-seg-${prev.length}`,
        workoutName: null,
        workoutDescription: null,
        workoutSchedule: defaultSchedule,
      },
    ])
    setIsDirty(true)
    setExpandedSegmentIndex(segments.length)
  }

  function updateSegment(index: number, updates: Partial<WorkoutSegment>) {
    setSegments((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...updates } : s))
    )
    setIsDirty(true)
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-4">
      {!scheduleOnly && (
        <>
          <div>
            <label htmlFor="fav-name" className="block text-xs font-medium text-gray-700 mb-1">
              Name
            </label>
            <input
              id="fav-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setIsDirty(true)
              }}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
              placeholder="Workout name"
            />
          </div>
          <div>
            <label htmlFor="fav-desc" className="block text-xs font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              id="fav-desc"
              rows={2}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                setIsDirty(true)
              }}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
              placeholder="Optional description"
            />
          </div>
        </>
      )}

      {isSingle && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Timer mode
            </label>
            <p className="text-sm text-gray-900 py-1.5">
              {CREATABLE_TIMER_MODES.find((m) => m.value === scheduleMode)?.label ?? 'Standard'}
            </p>
          </div>
          <CreateWorkoutOptions
            mode={scheduleMode}
            options={{ ...scheduleOptions, direction: scheduleDirection }}
            onChange={(o) => {
              setScheduleOptions(o)
              setScheduleDirection(o.direction === true || o.direction === 'true')
              setIsDirty(true)
            }}
            parseDurationInput={parseDurationInput}
          />
        </div>
      )}

      {!isSingle && (
        <div className="border-t border-gray-200 pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-gray-800">Segments</h4>
            <button
              type="button"
              onClick={addSegment}
              className="rounded text-white text-xs font-medium px-2 py-1.5 hover:opacity-90"
              style={{ backgroundColor: '#6B21A8' }}
            >
              Add segment
            </button>
          </div>
          <ul className="space-y-2 max-h-[40vh] overflow-y-auto">
            {segments.map((seg, index) => (
              <li
                key={`${seg.workoutId}-${index}`}
                className="rounded border border-gray-200 bg-gray-50/50 p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate flex-1">
                    {getSegmentDisplayName(seg, index)}
                  </span>
                  <div className="inline-flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveSegment(index, 'up')}
                      disabled={index === 0}
                      className="h-6 w-6 inline-flex items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSegment(index, 'down')}
                      disabled={index === segments.length - 1}
                      className="h-6 w-6 inline-flex items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedSegmentIndex(expandedSegmentIndex === index ? null : index)
                      }
                      className="text-xs text-gymnext-dark hover:underline px-1"
                    >
                      {expandedSegmentIndex === index ? 'Collapse' : 'Edit'}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSegment(index)}
                      className="text-xs text-red-600 hover:underline px-1"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {expandedSegmentIndex === index && (
                  <SegmentEditor
                    segment={seg}
                    workoutId={workout.workoutId}
                    segmentIndex={index}
                    onChange={(updates) => updateSegment(index, updates)}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded text-white text-sm font-medium px-3 py-2 hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: '#6B21A8' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {!scheduleOnly && (
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        )}
      </div>
    </form>
  )
})

function SegmentEditor({
  segment,
  workoutId,
  segmentIndex,
  onChange,
}: {
  segment: WorkoutSegment
  workoutId: string
  segmentIndex: number
  onChange: (updates: Partial<WorkoutSegment>) => void
}) {
  const parsed = useMemo(
    () => parseScheduleToOptions(segment.workoutSchedule ?? undefined),
    [segment.workoutSchedule]
  )
  const [mode, setMode] = useState(parsed.mode)
  const [options, setOptions] = useState<Record<string, string | number>>(parsed.options)
  const [name, setName] = useState(segment.workoutName ?? '')
  const [description, setDescription] = useState(segment.workoutDescription ?? '')
  const [scheduleError, setScheduleError] = useState<string | null>(null)

  useEffect(() => {
    setMode(parsed.mode)
    setOptions(parsed.options)
    setName(segment.workoutName ?? '')
    setDescription(segment.workoutDescription ?? '')
  }, [segment.workoutId, parsed.mode, parsed.options, segment.workoutName, segment.workoutDescription])

  function applyToParent(updates: Partial<WorkoutSegment>) {
    onChange(updates)
  }

  function applySchedule() {
    if (!hasValidDurationForMode(mode, options, parseDurationInput)) {
      setScheduleError('Warmup, Cooldown, and Rest require a duration greater than 0:00.')
      return
    }
    setScheduleError(null)
    const built = buildWorkoutFromCreateForm(mode, options) as { workoutSchedule: string }
    applyToParent({
      workoutName: name.trim() || null,
      workoutDescription: description.trim() || null,
      workoutSchedule: built.workoutSchedule,
    })
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-200 space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-0.5">Segment name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => applyToParent({ workoutName: name.trim() || null, workoutDescription: description.trim() || null })}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          placeholder={`Segment ${segmentIndex + 1}`}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-0.5">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => applyToParent({ workoutName: name.trim() || null, workoutDescription: description.trim() || null })}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          placeholder="Optional"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-0.5">Timer mode</label>
        <p className="text-sm text-gray-900 py-1">
          {CREATABLE_TIMER_MODES.find((m) => m.value === mode)?.label ?? 'Standard'}
        </p>
      </div>
      <CreateWorkoutOptions
        mode={mode}
        options={options}
        onChange={(o) => {
          setOptions(o)
          if (hasValidDurationForMode(mode, o, parseDurationInput)) {
            const built = buildWorkoutFromCreateForm(mode, o) as { workoutSchedule: string }
            applyToParent({ workoutSchedule: built.workoutSchedule })
          }
        }}
        parseDurationInput={parseDurationInput}
      />
      {scheduleError && <p className="text-xs text-red-600">{scheduleError}</p>}
      <button
        type="button"
        onClick={applySchedule}
        className="text-xs text-gymnext-dark hover:underline"
      >
        Apply segment settings
      </button>
    </div>
  )
}

function CollectionsSection({
  collections,
  collectionDetail,
  allCollections,
  onUpdateCollectionWorkoutIds,
  onReloadCollectionDetail,
  collectionLoading,
  collectionError,
  openCollectionDetail,
  onReorderWorkout,
  onReorderCollections,
  onRemoveWorkoutFromCollection,
  onCreateCollection,
  onUpdateCollection,
  onDeleteCollection,
  onSaveWorkout,
  maxCollections,
  collectionsCount,
  maxFavorites,
  createWorkoutInCollection,
}: {
  collections: WorkoutCollection[]
  collectionDetail: { collection: WorkoutCollection; workouts: Workout[] } | null
  allCollections: WorkoutCollection[]
  onUpdateCollectionWorkoutIds: (collectionId: string, workoutIds: string[]) => Promise<void>
  onReloadCollectionDetail?: () => Promise<void>
  collectionLoading: boolean
  collectionError: string | null
  openCollectionDetail: (collectionId: string) => void
  onReorderWorkout: (
    collectionId: string,
    index: number,
    direction: 'up' | 'down'
  ) => void
  onReorderCollections?: (index: number, direction: 'up' | 'down') => void
  onRemoveWorkoutFromCollection: (collectionId: string, workoutId: string) => Promise<void>
  onCreateCollection: (name: string, description: string | null) => Promise<WorkoutCollection>
  onUpdateCollection: (collectionId: string, name: string, description: string | null) => Promise<void>
  onDeleteCollection: (collectionId: string) => Promise<void>
  onSaveWorkout: (workoutId: string, data: Record<string, unknown>) => Promise<void>
  maxCollections?: number
  collectionsCount?: number
  maxFavorites?: number
  createWorkoutInCollection?: (
    collectionId: string,
    payload: {
      workout: { timerMode: number; workoutSchedule: string; direction?: boolean }
    }
  ) => Promise<Workout>
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [editMetaWorkout, setEditMetaWorkout] = useState<Workout | null>(null)
  const [editMetaName, setEditMetaName] = useState('')
  const [editMetaDescription, setEditMetaDescription] = useState('')
  const [editMetaBusy, setEditMetaBusy] = useState(false)
  const [editMetaError, setEditMetaError] = useState<string | null>(null)

  const [collectionMoreMenuOpen, setCollectionMoreMenuOpen] = useState(false)
  const [collectionDeleteConfirmOpen, setCollectionDeleteConfirmOpen] = useState(false)

  const [expandedWorkoutId, setExpandedWorkoutId] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [unsavedConfirmOpen, setUnsavedConfirmOpen] = useState(false)
  type PendingUnsavedAction =
    | { type: 'expand'; nextExpandedId: string | null }
    | { type: 'createWorkout' }
    | { type: 'updateBookmarks'; workout: Workout }
    | { type: 'removeFromCollection'; workout: Workout }
    | { type: 'createCollection' }
    | { type: 'editCollection'; collection: WorkoutCollection }
    | { type: 'editWorkoutMeta'; workout: Workout }
  const [pendingUnsavedAction, setPendingUnsavedAction] = useState<PendingUnsavedAction | null>(null)
  const collectionDetailPanelRef = useRef<{ save: () => Promise<void> }>(null)

  function runPendingUnsavedAction() {
    if (!pendingUnsavedAction) return
    switch (pendingUnsavedAction.type) {
      case 'expand':
        setExpandedWorkoutId(pendingUnsavedAction.nextExpandedId)
        break
      case 'createWorkout':
        setCollectionCreateDialogOpen(true)
        break
      case 'updateBookmarks': {
        const w = pendingUnsavedAction.workout
        setCollectionBookmarkWorkout(w)
        setCollectionBookmarkSelectedIds(
          new Set(
            allCollections.filter((c) => c.workoutIds.includes(w.id)).map((c) => c.id)
          )
        )
        setCollectionBookmarkDialogOpen(true)
        break
      }
      case 'removeFromCollection':
        setRemoveFromCollectionConfirmWorkout(pendingUnsavedAction.workout)
        break
      case 'createCollection':
        setCreateOpen(true)
        break
      case 'editCollection':
        openEdit(pendingUnsavedAction.collection)
        break
      case 'editWorkoutMeta':
        openEditMeta(pendingUnsavedAction.workout)
        break
    }
    setPendingUnsavedAction(null)
    setHasUnsavedChanges(false)
  }

  const [expandedWorkoutMenuOpen, setExpandedWorkoutMenuOpen] = useState(false)
  const [removeFromCollectionConfirmWorkout, setRemoveFromCollectionConfirmWorkout] = useState<Workout | null>(null)

  const [collectionBookmarkDialogOpen, setCollectionBookmarkDialogOpen] = useState(false)
  const [collectionBookmarkWorkout, setCollectionBookmarkWorkout] = useState<Workout | null>(null)
  const [collectionBookmarkSelectedIds, setCollectionBookmarkSelectedIds] = useState<Set<string>>(new Set())
  const [collectionBookmarkSaving, setCollectionBookmarkSaving] = useState(false)

  const [collectionCreateDialogOpen, setCollectionCreateDialogOpen] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [editCollection, setEditCollection] = useState<WorkoutCollection | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const maxColl = maxCollections ?? UNLIMITED
  const count = collectionsCount ?? 0
  const atCollectionsLimit = maxColl < UNLIMITED && count >= maxColl
  const collectionsLabel =
    maxColl >= UNLIMITED ? `(${collections.length})` : `(${count} / ${maxColl})`

  const favoritesCollectionFromAll = allCollections.find((c) => c.id === 'favorite')
  const maxFav = maxFavorites ?? UNLIMITED
  const atFavoritesLimit =
    maxFav < UNLIMITED && (favoritesCollectionFromAll?.workoutIds.length ?? 0) >= maxFav

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!createName.trim()) return
    setCreateError(null)
    setCreateBusy(true)
    try {
      const created = await onCreateCollection(createName.trim(), createDescription.trim() || null)
      setCreateOpen(false)
      setCreateName('')
      setCreateDescription('')
      openCollectionDetail(created.id)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create collection')
    } finally {
      setCreateBusy(false)
    }
  }

  function openEdit(c: WorkoutCollection) {
    setEditCollection(c)
    setEditName(c.workoutCollectionName)
    setEditDescription(c.workoutCollectionDescription ?? '')
    setEditError(null)
    setEditOpen(true)
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editCollection || !editName.trim()) return
    setEditError(null)
    setEditBusy(true)
    try {
      await onUpdateCollection(editCollection.id, editName.trim(), editDescription.trim() || null)
      setEditOpen(false)
      setEditCollection(null)
      setEditName('')
      setEditDescription('')
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to update collection')
    } finally {
      setEditBusy(false)
    }
  }

  function openEditMeta(w: Workout) {
    setEditMetaWorkout(w)
    setEditMetaName(w.workoutName ?? '')
    setEditMetaDescription(w.workoutDescription ?? '')
    setEditMetaError(null)
  }

  async function handleEditMetaSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editMetaWorkout) return
    setEditMetaError(null)
    setEditMetaBusy(true)
    try {
      await onSaveWorkout(editMetaWorkout.id, {
        workoutName: editMetaName.trim() || null,
        workoutDescription: editMetaDescription.trim() || null,
      })
      setEditMetaWorkout(null)
      setEditMetaName('')
      setEditMetaDescription('')
    } catch (err) {
      setEditMetaError(err instanceof Error ? err.message : 'Failed to update workout')
    } finally {
      setEditMetaBusy(false)
    }
  }

  function handleExpandWorkoutClick(nextExpandedId: string | null) {
    if (nextExpandedId !== expandedWorkoutId && hasUnsavedChanges) {
      setPendingUnsavedAction({ type: 'expand', nextExpandedId })
      setUnsavedConfirmOpen(true)
    } else {
      setExpandedWorkoutId(nextExpandedId)
    }
  }

  useEffect(() => {
    if (
      expandedWorkoutId &&
      collectionDetail &&
      !collectionDetail.workouts.some((w) => w.id === expandedWorkoutId)
    ) {
      setExpandedWorkoutId(null)
    }
  }, [collectionDetail?.workouts, expandedWorkoutId])

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)]">
      <div className="rounded-lg border border-gymnext-muted/30 bg-white overflow-hidden">
        <div className="border-b border-gymnext-muted/30 bg-gymnext-background px-4 py-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-gray-800">
            Collections {collectionsLabel}
          </h3>
          <button
            type="button"
            onClick={() => {
              if (hasUnsavedChanges) {
                setPendingUnsavedAction({ type: 'createCollection' })
                setUnsavedConfirmOpen(true)
              } else {
                setCreateOpen(true)
              }
            }}
            disabled={atCollectionsLimit}
            title={atCollectionsLimit ? `Your plan allows up to ${maxColl} collection${maxColl === 1 ? '' : 's'}. Upgrade to add more.` : undefined}
            className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#6B21A8' }}
          >
            Create collection
          </button>
        </div>
        {collections.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">
            You do not have any collections yet.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {collections.map((c, index) => {
              const isSelected = collectionDetail?.collection.id === c.id
              return (
                <li
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openCollectionDetail(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openCollectionDetail(c.id)
                    }
                  }}
                  className={`px-4 py-3 flex items-center gap-3 cursor-pointer border-l-8 ${
                    isSelected
                      ? 'bg-white border-amber-700'
                      : 'bg-white border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  <span className="w-5 shrink-0 flex items-center justify-center" aria-hidden>
                    {isSelected && (
                      <span className="text-amber-700" aria-label="Active collection">
                        ✓
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {c.workoutCollectionName}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {c.workoutIds.length} workouts
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (hasUnsavedChanges) {
                          setPendingUnsavedAction({ type: 'editCollection', collection: c })
                          setUnsavedConfirmOpen(true)
                        } else {
                          openEdit(c)
                        }
                      }}
                      className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                      aria-label="Edit collection"
                    >
                      Edit
                    </button>
                    {onReorderCollections && (
                      <>
                        <button
                          type="button"
                          onClick={() => onReorderCollections(index, 'up')}
                          disabled={index === 0}
                          className="h-7 w-7 inline-flex items-center justify-center rounded border border-gymnext-muted/50 text-gray-700 hover:bg-gymnext-background disabled:opacity-40"
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => onReorderCollections(index, 'down')}
                          disabled={index === collections.length - 1}
                          className="h-7 w-7 inline-flex items-center justify-center rounded border border-gymnext-muted/50 text-gray-700 hover:bg-gymnext-background disabled:opacity-40"
                          aria-label="Move down"
                        >
                          ↓
                        </button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-gymnext-muted/30 bg-white overflow-hidden">
        {collectionLoading && (
          <p className="px-4 py-6 text-sm text-gray-500">Loading collection…</p>
        )}
        {collectionError && (
          <div className="px-4 py-2 text-xs text-red-700 bg-red-50">
            {collectionError}
          </div>
        )}
        {!collectionLoading && !collectionDetail && !collectionError && (
          <p className="px-4 py-6 text-sm text-gray-500 text-center">
            Select a collection to see its workouts.
          </p>
        )}
        {collectionDetail && (
          <div className="space-y-3 px-4 py-4">
            <div className="flex items-start justify-between gap-2 relative border-b border-gray-100 pb-3">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {collectionDetail.collection.workoutCollectionName}
                </p>
                <p className="text-xs text-gray-500">
                  {collectionDetail.collection.workoutCollectionDescription ||
                    'No description'}
                </p>
              </div>
              <div className="shrink-0">
                <button
                  type="button"
                  onClick={() => setCollectionMoreMenuOpen((open) => !open)}
                  className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  aria-label="More options"
                  aria-expanded={collectionMoreMenuOpen}
                >
                  ⋯
                </button>
                {collectionMoreMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      aria-hidden
                      onClick={() => setCollectionMoreMenuOpen(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                        onClick={() => {
                          setCollectionMoreMenuOpen(false)
                          setCollectionDeleteConfirmOpen(true)
                        }}
                      >
                        Delete collection
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            {collectionDetail.workouts.length === 0 ? (
              <p className="text-sm text-gray-500">
                This collection has no workouts yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {collectionDetail.workouts.map((w, index) => {
                      const barColor = getWorkoutBarColor(w)
                      const isExpanded = expandedWorkoutId === w.id
                      return (
                      <Fragment key={w.id}>
                      <tr className="hover:bg-gymnext-background/50">
                        <td
                          className="pl-3 pr-3 py-2 border-l-8 cursor-pointer align-top"
                          style={{ borderLeftColor: barColor }}
                          onClick={() => handleExpandWorkoutClick(isExpanded ? null : w.id)}
                        >
                          <div className="text-sm font-medium text-gray-900">
                            {getWorkoutDisplayName(w) || w.workoutId}
                          </div>
                          <div className="text-sm text-gray-600 mt-0.5">
                            {getWorkoutDisplayDescription(w) || '—'}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-sm text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                if (hasUnsavedChanges) {
                                  setPendingUnsavedAction({ type: 'editWorkoutMeta', workout: w })
                                  setUnsavedConfirmOpen(true)
                                } else {
                                  openEditMeta(w)
                                }
                              }}
                              className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                              aria-label="Edit workout"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onReorderWorkout(
                                  collectionDetail.collection.id,
                                  index,
                                  'up'
                                )
                              }
                              className="h-7 w-7 inline-flex items-center justify-center rounded border border-gymnext-muted/50 text-gymnext-dark hover:bg-gymnext-background"
                              aria-label="Move up"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onReorderWorkout(
                                  collectionDetail.collection.id,
                                  index,
                                  'down'
                                )
                              }
                              className="h-7 w-7 inline-flex items-center justify-center rounded border border-gymnext-muted/50 text-gymnext-dark hover:bg-gymnext-background"
                              aria-label="Move down"
                            >
                              ↓
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={2} className="p-0 bg-gray-50/80">
                            <div className="border-t border-gray-200 relative">
                              <div className="absolute top-2 right-2 z-10">
                                <div className="relative">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedWorkoutMenuOpen((open) => !open)}
                                    className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                                    aria-label="More options"
                                    aria-expanded={expandedWorkoutMenuOpen}
                                  >
                                    ⋯
                                  </button>
                                  {expandedWorkoutMenuOpen && (
                                    <>
                                      <div
                                        className="fixed inset-0 z-40"
                                        aria-hidden
                                        onClick={() => setExpandedWorkoutMenuOpen(false)}
                                      />
                                      <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                                        <button
                                          type="button"
                                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                          onClick={() => {
                                            setExpandedWorkoutMenuOpen(false)
                                            if (hasUnsavedChanges) {
                                              setPendingUnsavedAction({ type: 'updateBookmarks', workout: w })
                                              setUnsavedConfirmOpen(true)
                                            } else {
                                              setCollectionBookmarkWorkout(w)
                                              setCollectionBookmarkSelectedIds(
                                                new Set(
                                                  allCollections.filter((c) =>
                                                    c.workoutIds.includes(w.id)
                                                  ).map((c) => c.id)
                                                )
                                              )
                                              setCollectionBookmarkDialogOpen(true)
                                            }
                                          }}
                                        >
                                          Update bookmarks
                                        </button>
                                        <button
                                          type="button"
                                          className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                          onClick={() => {
                                            setExpandedWorkoutMenuOpen(false)
                                            if (hasUnsavedChanges) {
                                              setPendingUnsavedAction({ type: 'removeFromCollection', workout: w })
                                              setUnsavedConfirmOpen(true)
                                            } else {
                                              setRemoveFromCollectionConfirmWorkout(w)
                                            }
                                          }}
                                        >
                                          Remove from Collection
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="p-4 pt-10 max-h-[60vh] overflow-y-auto">
                                <FavoritesDetailPanel
                                  workout={w}
                                  scheduleOnly
                                  ref={collectionDetailPanelRef}
                                  onDirtyChange={setHasUnsavedChanges}
                                  onSave={async (workoutId, data) => {
                                    await onSaveWorkout(workoutId, data)
                                    setExpandedWorkoutId(null)
                                  }}
                                  onClose={() => setExpandedWorkoutId(null)}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                    )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex justify-end pt-3">
              <button
                type="button"
                onClick={() => {
                  if (hasUnsavedChanges) {
                    setPendingUnsavedAction({ type: 'createWorkout' })
                    setUnsavedConfirmOpen(true)
                  } else {
                    setCollectionCreateDialogOpen(true)
                  }
                }}
                className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90"
                style={{ backgroundColor: '#6B21A8' }}
              >
                Create Workout
              </button>
            </div>
          </div>
        )}
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !createBusy && setCreateOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
            <div className="border-b border-gymnext-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">Create new collection</h3>
              <p className="text-xs text-gray-500 mt-0.5">Give your collection a name and optional description.</p>
            </div>
            <form onSubmit={handleCreateSubmit} className="p-4 space-y-4">
              <div>
                <label htmlFor="coll-name" className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                <input
                  id="coll-name"
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  placeholder="Collection name"
                  required
                />
              </div>
              <div>
                <label htmlFor="coll-desc" className="block text-xs font-medium text-gray-700 mb-1">Description (optional)</label>
                <textarea
                  id="coll-desc"
                  rows={2}
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  placeholder="Optional description"
                />
              </div>
              {createError && <p className="text-xs text-red-600">{createError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  disabled={createBusy}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createBusy || !createName.trim()}
                  className="rounded text-white text-sm font-medium px-3 py-2 hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  {createBusy ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {collectionDeleteConfirmOpen && collectionDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => setCollectionDeleteConfirmOpen(false)}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <p className="text-sm text-gray-800">
              Delete this collection? It will be removed from your list. You can create a new collection anytime.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setCollectionDeleteConfirmOpen(false)}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onDeleteCollection(collectionDetail.collection.id)
                  setCollectionDeleteConfirmOpen(false)
                }}
                className="rounded px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700"
              >
                Delete collection
              </button>
            </div>
          </div>
        </div>
      )}

      {unsavedConfirmOpen && pendingUnsavedAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => {
              setUnsavedConfirmOpen(false)
              setPendingUnsavedAction(null)
            }}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <p className="text-sm text-gray-800">
              You have unsaved changes. Save, discard, or cancel?
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => {
                  setUnsavedConfirmOpen(false)
                  setPendingUnsavedAction(null)
                }}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setUnsavedConfirmOpen(false)
                  runPendingUnsavedAction()
                }}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await collectionDetailPanelRef.current?.save()
                    setUnsavedConfirmOpen(false)
                    runPendingUnsavedAction()
                  } catch {
                    // keep dialog open on save error
                  }
                }}
                className="rounded px-3 py-2 text-sm font-medium text-white hover:bg-gymnext-dark"
                style={{ backgroundColor: '#6B21A8' }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {collectionBookmarkDialogOpen && collectionBookmarkWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !collectionBookmarkSaving && setCollectionBookmarkDialogOpen(false)}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg flex flex-col max-h-[80vh]">
            <div className="border-b border-gymnext-muted/30 px-4 py-3 shrink-0">
              <h3 className="text-sm font-semibold text-gray-800">Update bookmarks</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Choose which collections include this workout
              </p>
            </div>
            <div className="overflow-y-auto p-2 min-h-0">
              {allCollections.map((c) => {
                const isChecked = collectionBookmarkSelectedIds.has(c.id)
                const displayName = c.id === 'favorite' ? 'Favorites' : c.workoutCollectionName
                const favoritesAtLimitCannotAdd =
                  c.id === 'favorite' && atFavoritesLimit && !isChecked
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={favoritesAtLimitCannotAdd}
                    title={
                      favoritesAtLimitCannotAdd
                        ? `Favorites is at its limit (${maxFav}). Upgrade to add more.`
                        : undefined
                    }
                    onClick={() => {
                      if (favoritesAtLimitCannotAdd) return
                      setCollectionBookmarkSelectedIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(c.id)) next.delete(c.id)
                        else next.add(c.id)
                        return next
                      })
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-gray-50 text-left disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                        isChecked
                          ? 'bg-gymnext border-gymnext text-white'
                          : 'border-gray-300 bg-white'
                      }`}
                      style={isChecked ? { backgroundColor: '#6B21A8', borderColor: '#6B21A8' } : undefined}
                    >
                      {isChecked ? '✓' : ''}
                    </span>
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {displayName}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="border-t border-gymnext-muted/30 px-4 py-3 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setCollectionBookmarkDialogOpen(false)}
                disabled={collectionBookmarkSaving}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={collectionBookmarkSaving}
                onClick={async () => {
                  if (!collectionBookmarkWorkout) return
                  setCollectionBookmarkSaving(true)
                  try {
                    for (const c of allCollections) {
                      const wantIn = collectionBookmarkSelectedIds.has(c.id)
                      const hasIn = c.workoutIds.includes(collectionBookmarkWorkout.id)
                      if (wantIn === hasIn) continue
                      const newIds = wantIn
                        ? [...c.workoutIds, collectionBookmarkWorkout.id]
                        : c.workoutIds.filter((id) => id !== collectionBookmarkWorkout.id)
                      await onUpdateCollectionWorkoutIds(c.id, newIds)
                    }
                    await onReloadCollectionDetail?.()
                    setCollectionBookmarkDialogOpen(false)
                    setCollectionBookmarkWorkout(null)
                  } catch (e) {
                    console.error('[bookmark save]', e)
                  } finally {
                    setCollectionBookmarkSaving(false)
                  }
                }}
                className="rounded px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#6B21A8' }}
              >
                {collectionBookmarkSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {collectionCreateDialogOpen && collectionDetail && createWorkoutInCollection && (
        <CreateWorkoutDialog
          title="Create new workout"
          onClose={() => setCollectionCreateDialogOpen(false)}
          createWorkout={(payload) =>
            createWorkoutInCollection(collectionDetail.collection.id, payload)
          }
          onSaveWorkout={onSaveWorkout}
          onCreated={async (workout) => {
            await onReloadCollectionDetail?.()
            setExpandedWorkoutId(workout.id)
          }}
        />
      )}

      {removeFromCollectionConfirmWorkout && collectionDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => setRemoveFromCollectionConfirmWorkout(null)}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <p className="text-sm text-gray-800">
              Remove this workout from the collection?
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setRemoveFromCollectionConfirmWorkout(null)}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onRemoveWorkoutFromCollection(collectionDetail.collection.id, removeFromCollectionConfirmWorkout.id)
                  setRemoveFromCollectionConfirmWorkout(null)
                  setExpandedWorkoutId(null)
                }}
                className="rounded px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {editMetaWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !editMetaBusy && setEditMetaWorkout(null)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
            <div className="border-b border-gymnext-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">Edit workout</h3>
              <p className="text-xs text-gray-500 mt-0.5">Change the name and description.</p>
            </div>
            <form onSubmit={handleEditMetaSubmit} className="p-4 space-y-4">
              <div>
                <label htmlFor="coll-edit-workout-name" className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                <input
                  id="coll-edit-workout-name"
                  type="text"
                  value={editMetaName}
                  onChange={(e) => setEditMetaName(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  placeholder="Workout name"
                />
              </div>
              <div>
                <label htmlFor="coll-edit-workout-desc" className="block text-xs font-medium text-gray-700 mb-1">Description (optional)</label>
                <textarea
                  id="coll-edit-workout-desc"
                  rows={3}
                  value={editMetaDescription}
                  onChange={(e) => setEditMetaDescription(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  placeholder="Optional description"
                />
              </div>
              {editMetaError && <p className="text-xs text-red-600">{editMetaError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditMetaWorkout(null)}
                  disabled={editMetaBusy}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editMetaBusy}
                  className="rounded text-white text-sm font-medium px-3 py-2 hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  {editMetaBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editOpen && editCollection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !editBusy && setEditOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
            <div className="border-b border-gymnext-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">Edit collection</h3>
              <p className="text-xs text-gray-500 mt-0.5">Change the name and optional description.</p>
            </div>
            <form onSubmit={handleEditSubmit} className="p-4 space-y-4">
              <div>
                <label htmlFor="edit-coll-name" className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                <input
                  id="edit-coll-name"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  placeholder="Collection name"
                  required
                />
              </div>
              <div>
                <label htmlFor="edit-coll-desc" className="block text-xs font-medium text-gray-700 mb-1">Description (optional)</label>
                <textarea
                  id="edit-coll-desc"
                  rows={2}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  placeholder="Optional description"
                />
              </div>
              {editError && <p className="text-xs text-red-600">{editError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  disabled={editBusy}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editBusy || !editName.trim()}
                  className="rounded text-white text-sm font-medium px-3 py-2 hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  {editBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function PlansSection({
  plans,
  selectedPlanId,
  setSelectedPlanId,
  weekStart,
  setWeekStart,
  weekEnd,
  byDay,
  planViewMode,
  setPlanViewMode,
  planDayCount,
  plansLoading,
  plansError,
  onReorderPlanned,
  onDeletePlanned,
  user,
  reloadPlanned,
  onCreatePlan,
  onUpdatePlan,
  onDeletePlan,
  maxPlans,
  plansCount,
  subscriptionTier,
  onReorderPlans,
  favoriteWorkouts,
  collectionsExcludingFavorites,
  workoutsById,
}: {
  plans: WorkoutPlan[]
  selectedPlanId: string | null
  setSelectedPlanId: (id: string | null) => void
  weekStart: string
  setWeekStart: (value: string) => void
  weekEnd: string
  byDay: Record<string, PlannedWorkout[]>
  planViewMode: 'week' | '3day' | '1day'
  setPlanViewMode: (mode: 'week' | '3day' | '1day') => void
  planDayCount: number
  plansLoading: boolean
  plansError: string | null
  onReorderPlanned: (
    dayKey: string,
    index: number,
    direction: 'up' | 'down'
  ) => void
  onDeletePlanned: (pw: PlannedWorkout) => void
  user: User
  reloadPlanned: () => void
  onCreatePlan: (name: string, description: string | null) => Promise<WorkoutPlan>
  onUpdatePlan: (planId: string, name: string, description: string | null) => Promise<void>
  onDeletePlan: (planId: string) => Promise<void>
  maxPlans?: number
  plansCount?: number
  subscriptionTier?: SubscriptionTier
  onReorderPlans?: (index: number, direction: 'up' | 'down') => void
  favoriteWorkouts?: Workout[]
  collectionsExcludingFavorites?: WorkoutCollection[]
  workoutsById?: Map<string, Workout>
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [addWorkoutSource, setAddWorkoutSource] = useState<
    'choice' | 'favorites' | 'collection' | 'createNew'
  >('choice')
  const [expandedCollectionId, setExpandedCollectionId] = useState<string | null>(null)
  const [selectedWorkoutForPlan, setSelectedWorkoutForPlan] = useState<Workout | null>(null)
  const [createPlanOpen, setCreatePlanOpen] = useState(false)

  const [editPlanOpen, setEditPlanOpen] = useState(false)
  const [editPlan, setEditPlan] = useState<WorkoutPlan | null>(null)
  const [editPlanName, setEditPlanName] = useState('')
  const [editPlanDescription, setEditPlanDescription] = useState('')
  const [editPlanBusy, setEditPlanBusy] = useState(false)
  const [editPlanError, setEditPlanError] = useState<string | null>(null)

  const [editPlannedOpen, setEditPlannedOpen] = useState(false)
  const [editPlannedWorkout, setEditPlannedWorkout] = useState<PlannedWorkout | null>(null)
  const [editPlannedName, setEditPlannedName] = useState('')
  const [editPlannedDescription, setEditPlannedDescription] = useState('')
  const [editPlannedBusy, setEditPlannedBusy] = useState(false)
  const [editPlannedError, setEditPlannedError] = useState<string | null>(null)

  const [createPlanName, setCreatePlanName] = useState('')
  const [createPlanDescription, setCreatePlanDescription] = useState('')
  const [createPlanBusy, setCreatePlanBusy] = useState(false)
  const [createPlanError, setCreatePlanError] = useState<string | null>(null)
  const todayYmd = toYYYYMMDD(new Date())
  const [createDate, setCreateDate] = useState<string>(() => todayYmd)
  const [createMode, setCreateMode] = useState<number>(1)
  const [createOptions, setCreateOptions] = useState<
    Record<string, string | number>
  >({})
  const [createError, setCreateError] = useState<string | null>(null)
  const [createBusy, setCreateBusy] = useState(false)

  const [planMoreMenuOpen, setPlanMoreMenuOpen] = useState(false)
  const [planDeleteConfirmOpen, setPlanDeleteConfirmOpen] = useState(false)
  const [plannedWorkoutMenuId, setPlannedWorkoutMenuId] = useState<string | null>(null)
  const [copyPlannedWorkout, setCopyPlannedWorkout] = useState<PlannedWorkout | null>(null)
  const [copyTargetPlanId, setCopyTargetPlanId] = useState<string>('')
  const [copyTargetDay, setCopyTargetDay] = useState<string>(() => toYYYYMMDD(new Date()))
  const [copyBusy, setCopyBusy] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [movePlannedWorkout, setMovePlannedWorkout] = useState<PlannedWorkout | null>(null)
  const [moveTargetDay, setMoveTargetDay] = useState<string>('')
  const [moveBusy, setMoveBusy] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [deletePlannedConfirmWorkout, setDeletePlannedConfirmWorkout] = useState<PlannedWorkout | null>(null)
  const [editSchedulePlannedWorkout, setEditSchedulePlannedWorkout] = useState<PlannedWorkout | null>(null)
  const [editScheduleMode, setEditScheduleMode] = useState<number>(1)
  const [editScheduleOptions, setEditScheduleOptions] = useState<Record<string, string | number>>({})
  const [editScheduleBusy, setEditScheduleBusy] = useState(false)
  const [editScheduleError, setEditScheduleError] = useState<string | null>(null)

  const selectedPlan =
    selectedPlanId === null
      ? null
      : plans.find((p) => p.id === selectedPlanId) ?? null

  const maxP = maxPlans ?? UNLIMITED
  const planCount = plansCount ?? 0
  const atPlansLimit = maxP < UNLIMITED && planCount >= maxP
  const plansLabel = maxP >= UNLIMITED ? `(${plans.length})` : `(${planCount} / ${maxP})`

  const tier = subscriptionTier ?? 'basic'
  const isPro = tier === 'pro'
  const isPastDate = createDate < todayYmd
  const isFutureDate = createDate > todayYmd
  const canAddPlannedForSelectedDate =
    !isPastDate && (createDate === todayYmd || (isFutureDate && isPro))
  const plannedDateRestrictionMessage = isPastDate
    ? 'Cannot add workouts to past dates.'
    : isFutureDate && !isPro
      ? 'Upgrade to Pro to plan for future dates.'
      : null

  async function handleCreatePlanSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!createPlanName.trim()) return
    setCreatePlanError(null)
    setCreatePlanBusy(true)
    try {
      const created = await onCreatePlan(createPlanName.trim(), createPlanDescription.trim() || null)
      setCreatePlanOpen(false)
      setCreatePlanName('')
      setCreatePlanDescription('')
      setSelectedPlanId(created.id)
    } catch (e) {
      setCreatePlanError(e instanceof Error ? e.message : 'Failed to create plan')
    } finally {
      setCreatePlanBusy(false)
    }
  }

  function openEditPlan(plan: WorkoutPlan) {
    setEditPlan(plan)
    setEditPlanName(plan.workoutPlanName)
    setEditPlanDescription(plan.workoutPlanDescription ?? '')
    setEditPlanError(null)
    setEditPlanOpen(true)
  }

  async function handleEditPlanSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!editPlan || !editPlanName.trim()) return
    setEditPlanError(null)
    setEditPlanBusy(true)
    try {
      await onUpdatePlan(editPlan.id, editPlanName.trim(), editPlanDescription.trim() || null)
      setEditPlanOpen(false)
      setEditPlan(null)
      setEditPlanName('')
      setEditPlanDescription('')
    } catch (e) {
      setEditPlanError(e instanceof Error ? e.message : 'Failed to update plan')
    } finally {
      setEditPlanBusy(false)
    }
  }

  function openEditPlanned(pw: PlannedWorkout) {
    setEditPlannedWorkout(pw)
    setEditPlannedName(getWorkoutDisplayName(pw.workout) || '')
    setEditPlannedDescription((pw.workout.workoutDescription ?? getWorkoutDisplayDescription(pw.workout)) || '')
    setEditPlannedError(null)
    setEditPlannedOpen(true)
  }

  function openEditSchedulePlanned(pw: PlannedWorkout) {
    const parsed = parseScheduleToOptions(pw.workout.workoutSchedule)
    setEditScheduleMode(parsed.mode)
    setEditScheduleOptions({ ...parsed.options, direction: parsed.direction })
    setEditScheduleError(null)
    setEditSchedulePlannedWorkout(pw)
  }

  async function handleSaveEditSchedule(e: React.FormEvent) {
    e.preventDefault()
    if (!editSchedulePlannedWorkout || !selectedPlan) return
    if (!hasValidDurationForMode(editScheduleMode, editScheduleOptions, parseDurationInput)) {
      setEditScheduleError('Warmup, Cooldown, and Rest require a duration greater than 0:00.')
      return
    }
    setEditScheduleError(null)
    setEditScheduleBusy(true)
    try {
      const built = buildWorkoutFromCreateForm(editScheduleMode, editScheduleOptions)
      const res = await authedFetch(
        `/api/app/plans/${encodeURIComponent(selectedPlan.id)}/planned-workouts/${encodeURIComponent(editSchedulePlannedWorkout.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workout: built }),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update workout schedule')
      }
      setEditSchedulePlannedWorkout(null)
      reloadPlanned()
    } catch (e) {
      setEditScheduleError(e instanceof Error ? e.message : 'Failed to update workout schedule')
    } finally {
      setEditScheduleBusy(false)
    }
  }

  async function handleSavePlannedEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editPlannedWorkout || !selectedPlan) return
    setEditPlannedError(null)
    setEditPlannedBusy(true)
    try {
      const res = await authedFetch(
        `/api/app/plans/${encodeURIComponent(selectedPlan.id)}/planned-workouts/${encodeURIComponent(editPlannedWorkout.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workoutName: editPlannedName.trim() || null,
            workoutDescription: editPlannedDescription.trim() || null,
          }),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update workout')
      }
      setEditPlannedOpen(false)
      setEditPlannedWorkout(null)
      setEditPlannedName('')
      setEditPlannedDescription('')
      reloadPlanned()
    } catch (e) {
      setEditPlannedError(e instanceof Error ? e.message : 'Failed to update workout')
    } finally {
      setEditPlannedBusy(false)
    }
  }

  async function handleCopyToPlan(e: React.FormEvent) {
    e.preventDefault()
    if (!copyPlannedWorkout || !copyTargetPlanId || !copyTargetDay) return
    setCopyError(null)
    setCopyBusy(true)
    try {
      const w = copyPlannedWorkout.workout as Record<string, unknown>
      const workout =
        typeof w.timerMode === 'number'
          ? w
          : { ...w, timerMode: (Array.isArray(w.timerModes) ? (w.timerModes as number[])[0] : 1) }
      const res = await authedFetch(
        `/api/app/plans/${encodeURIComponent(copyTargetPlanId)}/planned-workouts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ day: copyTargetDay.slice(0, 10), ordinal: 0, workout }),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to copy workout')
      }
      setCopyPlannedWorkout(null)
      if (copyTargetPlanId === selectedPlanId) reloadPlanned()
    } catch (e) {
      setCopyError(e instanceof Error ? e.message : 'Failed to copy workout')
    } finally {
      setCopyBusy(false)
    }
  }

  async function handleMoveToDate(e: React.FormEvent) {
    e.preventDefault()
    if (!movePlannedWorkout || !selectedPlan) return
    const day = moveTargetDay.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return
    setMoveError(null)
    setMoveBusy(true)
    try {
      const res = await authedFetch(
        `/api/app/plans/${encodeURIComponent(selectedPlan.id)}/planned-workouts/${encodeURIComponent(movePlannedWorkout.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ day }),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to move workout')
      }
      setMovePlannedWorkout(null)
      reloadPlanned()
    } catch (e) {
      setMoveError(e instanceof Error ? e.message : 'Failed to move workout')
    } finally {
      setMoveBusy(false)
    }
  }

  async function authedFetch(input: string, init?: RequestInit) {
    const token = await user.getIdToken()
    const headers: HeadersInit = {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    }
    return fetch(input, { ...init, headers })
  }

  /** Build plan-day-entry shaped object from a Workout for the planned-workout API. */
  function workoutToPlanDayEntry(w: Workout): Record<string, unknown> {
    const entry: Record<string, unknown> = {
      timerMode: w.timerMode ?? (Array.isArray(w.timerModes) ? (w.timerModes as number[])[0] : 1),
      workoutName: w.workoutName ?? null,
      workoutDescription: w.workoutDescription ?? null,
      type: w.type,
    }
    if (w.workoutSchedule != null) entry.workoutSchedule = w.workoutSchedule
    if (w.direction != null) entry.direction = w.direction
    if (w.type === 'MultiSegmentWorkout' && w.segments) entry.segments = w.segments
    return entry
  }

  async function addPlannedFromWorkout(workout: Workout) {
    if (!selectedPlan) return
    setCreateBusy(true)
    setCreateError(null)
    try {
      const res = await authedFetch(
        `/api/app/plans/${encodeURIComponent(selectedPlan.id)}/planned-workouts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            day: createDate,
            ordinal: 0,
            workout: workoutToPlanDayEntry(workout),
            sourceWorkoutId: workout.id,
          }),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setCreateOpen(false)
      setAddWorkoutSource('choice')
      setExpandedCollectionId(null)
      setSelectedWorkoutForPlan(null)
      reloadPlanned()
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to add to plan')
    } finally {
      setCreateBusy(false)
    }
  }

  async function handleCreatePlanned() {
    if (!selectedPlan) return
    if (!hasValidDurationForMode(createMode, createOptions, parseDurationInput)) {
      setCreateError('Warmup, Cooldown, and Rest require a duration greater than 0:00.')
      return
    }
    setCreateError(null)
    setCreateBusy(true)
    try {
      const workout = buildWorkoutFromCreateForm(createMode, createOptions)
      const res = await authedFetch(
        `/api/app/plans/${encodeURIComponent(
          selectedPlan.id
        )}/planned-workouts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            day: createDate,
            ordinal: 0,
            workout,
          }),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setCreateOpen(false)
      setAddWorkoutSource('choice')
      setCreateOptions({})
      reloadPlanned()
    } catch (e) {
      setCreateError(
        e instanceof Error ? e.message : 'Failed to create planned workout'
      )
    } finally {
      setCreateBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.7fr)]">
        <div className="rounded-lg border border-gymnext-muted/30 bg-white overflow-hidden">
          <div className="border-b border-gymnext-muted/30 bg-gymnext-background px-4 py-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-gray-800">
              Plans {plansLabel}
            </h3>
            <button
              type="button"
              onClick={() => setCreatePlanOpen(true)}
              disabled={atPlansLimit}
              title={atPlansLimit ? `Your plan allows up to ${maxP} plan${maxP === 1 ? '' : 's'}. Upgrade to add more.` : undefined}
              className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#6B21A8' }}
            >
              Create plan
            </button>
          </div>
          {plans.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">
              You do not have any plans yet. Create one to get started.
            </p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {plans.map((p, index) => {
                const isSelected = selectedPlan?.id === p.id
                return (
                <li
                  key={p.id}
                  className={`pl-1 pr-4 py-3 flex items-center gap-3 cursor-pointer border-l-8 ${
                    isSelected
                      ? 'bg-white border-gymnext'
                      : 'bg-white border-gray-300 hover:bg-gray-100'
                  }`}
                  style={isSelected ? { borderLeftColor: '#6B21A8' } : undefined}
                  onClick={() => setSelectedPlanId(isSelected ? null : p.id)}
                >
                  <span className="w-5 shrink-0 flex items-center justify-center" aria-hidden>
                    {isSelected && (
                      <span style={{ color: '#6B21A8' }} aria-label="Active plan">
                        ✓
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {p.workoutPlanName}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {p.workoutPlanDescription || 'No description'}
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => openEditPlan(p)}
                      className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                      aria-label="Edit plan"
                    >
                      Edit
                    </button>
                    {onReorderPlans && (
                      <>
                        <button
                          type="button"
                          onClick={() => onReorderPlans(index, 'up')}
                          disabled={index === 0}
                          className="h-7 w-7 inline-flex items-center justify-center rounded border border-gymnext-muted/50 text-gray-700 hover:bg-gymnext-background disabled:opacity-40"
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => onReorderPlans(index, 'down')}
                          disabled={index === plans.length - 1}
                          className="h-7 w-7 inline-flex items-center justify-center rounded border border-gymnext-muted/50 text-gray-700 hover:bg-gymnext-background disabled:opacity-40"
                          aria-label="Move down"
                        >
                          ↓
                        </button>
                      </>
                    )}
                  </div>
                </li>
              )
              })}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-gymnext-muted/30 bg-white overflow-hidden">
          {!selectedPlan ? (
            <p className="px-4 py-8 text-sm text-gray-500 text-center">
              Select a plan from the list to view its schedule.
            </p>
          ) : (
            <>
          <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-2 relative">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">
                {selectedPlan.workoutPlanName}
              </p>
              <p className="text-xs text-gray-600 mt-1">
                {selectedPlan.workoutPlanDescription || 'No description'}
              </p>
            </div>
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => setPlanMoreMenuOpen((open) => !open)}
                className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="More options"
                aria-expanded={planMoreMenuOpen}
              >
                ⋯
              </button>
              {planMoreMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    aria-hidden
                    onClick={() => setPlanMoreMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                      onClick={() => {
                        setPlanMoreMenuOpen(false)
                        setPlanDeleteConfirmOpen(true)
                      }}
                    >
                      Delete plan
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="border-b border-gymnext-muted/30 bg-gymnext-background px-4 py-3 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded border border-gymnext-muted/50 bg-white p-0.5">
                {(['1day', '3day', 'week'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPlanViewMode(mode)}
                    className={`rounded px-2.5 py-1 text-xs font-medium ${
                      planViewMode === mode
                        ? 'text-white'
                        : 'text-gray-600 hover:bg-gymnext-background'
                    }`}
                    style={
                      planViewMode === mode
                        ? { backgroundColor: '#6B21A8' }
                        : undefined
                    }
                  >
                    {mode === 'week' ? 'week' : mode === '3day' ? '3 day' : '1 day'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  setCreateDate(todayYmd)
                  setCreateOpen(true)
                }}
                disabled={!selectedPlan}
                className="rounded bg-gymnext px-3 py-1.5 text-xs font-medium text-white hover:bg-gymnext-dark disabled:opacity-50"
              >
                Add planned workout
              </button>
              <button
                type="button"
                onClick={() => setWeekStart(addDays(weekStart, -planDayCount))}
                className="rounded border border-gymnext-muted/50 bg-white px-2.5 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-background"
              >
                ← Prev
              </button>
              <span className="text-xs text-gray-600">
                {new Date(weekStart + 'T12:00:00').toLocaleDateString(
                  undefined,
                  { month: 'short', day: 'numeric', year: 'numeric' }
                )}{' '}
                –{' '}
                {new Date(weekEnd + 'T12:00:00').toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
              <button
                type="button"
                onClick={() => setWeekStart(addDays(weekStart, planDayCount))}
                className="rounded border border-gymnext-muted/50 bg-white px-2.5 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-background"
              >
                Next →
              </button>
          </div>
          {plansLoading && (
            <p className="px-4 py-6 text-sm text-gray-500">
              Loading planned workouts…
            </p>
          )}
          {plansError && (
            <div className="px-4 py-2 text-xs text-red-700 bg-red-50">
              {plansError}
            </div>
          )}
          {selectedPlan && !plansLoading && (
            <div
              className={`grid grid-cols-1 divide-y md:divide-y-0 md:divide-x divide-gray-200 ${
                planDayCount === 1
                  ? 'md:grid-cols-1'
                  : planDayCount === 3
                    ? 'md:grid-cols-3'
                    : 'md:grid-cols-7'
              }`}
            >
              {Array.from({ length: planDayCount }, (_, i) => {
                const dateKey = addDays(weekStart, i)
                const items = byDay[dateKey] ?? []
                const dayDate = new Date(dateKey + 'T12:00:00')
                const dayName = dayDate.toLocaleDateString(undefined, {
                  weekday: 'short',
                })
                return (
                  <div key={dateKey} className="min-h-[140px] flex flex-col">
                    <div className="px-3 py-2 bg-gymnext-background border-b border-gymnext-muted/30 text-center">
                      <div className="text-[11px] font-medium uppercase text-gray-700">
                        {dayName}
                      </div>
                      <div className="text-xs font-medium text-gray-900">
                        {dayDate.toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </div>
                    </div>
                    <div className="p-2 flex-1 space-y-2">
                      {items.length === 0 && dateKey < todayYmd && (
                        <p className="text-[11px] text-gray-400 italic">
                          Rest day
                        </p>
                      )}
                      {items.length > 0 &&
                        items.map((pw, index) => {
                          const w = pw.workout
                          const barColor = getWorkoutBarColor(w)
                          const isPast = dateKey < todayYmd
                          return (
                            <div
                              key={pw.id}
                              className="rounded border border-gymnext-muted/30 bg-white shadow-sm relative"
                            >
                              <div
                                className="px-2 py-1.5 flex items-center justify-between gap-2"
                                style={{ backgroundColor: barColor, color: '#fff' }}
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium truncate">
                                    {getWorkoutDisplayName(w) || 'Workout'}
                                  </p>
                                  <p className="text-[11px] opacity-90 truncate">
                                    {(w.workoutDescription ?? (getWorkoutDisplayDescription(w) || '')).trim() || '—'}
                                  </p>
                                </div>
                                <div className="shrink-0 relative" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => setPlannedWorkoutMenuId((id) => (id === pw.id ? null : pw.id))}
                                    className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-white/20 text-[14px] font-medium leading-none"
                                    style={{ color: 'inherit' }}
                                    aria-label="More options"
                                    aria-expanded={plannedWorkoutMenuId === pw.id}
                                  >
                                    ⋯
                                  </button>
                                  {plannedWorkoutMenuId === pw.id && (
                                    <>
                                      <div
                                        className="fixed inset-0 z-40"
                                        aria-hidden
                                        onClick={() => setPlannedWorkoutMenuId(null)}
                                      />
                                      <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                                        {!isPast && (
                                          <>
                                        <button
                                          type="button"
                                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                          onClick={() => {
                                            setPlannedWorkoutMenuId(null)
                                            openEditPlanned(pw)
                                          }}
                                        >
                                          Edit
                                        </button>
                                        <button
                                          type="button"
                                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                          onClick={() => {
                                            setPlannedWorkoutMenuId(null)
                                            openEditSchedulePlanned(pw)
                                          }}
                                        >
                                          Modify workout details
                                        </button>
                                        </>
                                        )}
                                        <button
                                          type="button"
                                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                          onClick={() => {
                                            setPlannedWorkoutMenuId(null)
                                            setCopyPlannedWorkout(pw)
                                            setCopyTargetPlanId(plans[0]?.id ?? '')
                                            setCopyTargetDay(todayYmd)
                                            setCopyError(null)
                                          }}
                                        >
                                          Copy to another plan
                                        </button>
                                        {!isPast && (
                                          <>
                                        <button
                                          type="button"
                                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                          onClick={() => {
                                            setPlannedWorkoutMenuId(null)
                                            setMovePlannedWorkout(pw)
                                            setMoveTargetDay((pw.day || '').slice(0, 10))
                                            setMoveError(null)
                                          }}
                                        >
                                          Move to date
                                        </button>
                                        <div className="my-1 border-t border-gray-100" />
                                        <button
                                          type="button"
                                          className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                          onClick={() => {
                                            setPlannedWorkoutMenuId(null)
                                            setDeletePlannedConfirmWorkout(pw)
                                          }}
                                        >
                                          Delete
                                        </button>
                                        </>
                                        )}
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                              {!isPast && (
                              <div className="px-2 py-1 flex items-center justify-center gap-1 border-b border-gray-100">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onReorderPlanned(dateKey, index, 'up')
                                  }}
                                  className="h-6 w-6 inline-flex items-center justify-center rounded border border-gymnext-muted/50 text-gray-600 hover:bg-gymnext-background text-[10px]"
                                  aria-label="Move up"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onReorderPlanned(dateKey, index, 'down')
                                  }}
                                  className="h-6 w-6 inline-flex items-center justify-center rounded border border-gymnext-muted/50 text-gray-600 hover:bg-gymnext-background text-[10px]"
                                  aria-label="Move down"
                                >
                                  ↓
                                </button>
                              </div>
                              )}
                              {isPast ? (
                                <div className="w-full text-left px-2 py-1.5 block">
                                  <p className="text-[11px] text-gray-600 line-clamp-2">
                                    {getScheduleDisplayDescription(w) || '—'}
                                  </p>
                                </div>
                              ) : (
                              <button
                                type="button"
                                onClick={() => openEditSchedulePlanned(pw)}
                                className="w-full text-left px-2 py-1.5 block hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                              >
                                <p className="text-[11px] text-gray-600 line-clamp-2">
                                  {getScheduleDisplayDescription(w) || '—'}
                                </p>
                              </button>
                              )}
                            </div>
                          )
                        })}
                      {dateKey >= todayYmd && (
                        <button
                          type="button"
                          onClick={() => {
                            setCreateDate(dateKey)
                            setAddWorkoutSource('choice')
                            setExpandedCollectionId(null)
                            setCreateOpen(true)
                          }}
                          className="text-[11px] text-gymnext-dark hover:text-gymnext hover:underline text-left"
                        >
                          Add workout
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
            </>
          )}
        </div>
      </div>

      {createOpen && selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !createBusy && (setCreateOpen(false), setAddWorkoutSource('choice'), setExpandedCollectionId(null), setSelectedWorkoutForPlan(null))}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg max-h-[85vh] flex flex-col">
            <div className="border-b border-gymnext-muted/30 px-4 py-3 shrink-0">
              <h3 className="text-sm font-semibold text-gray-800">
                Add planned workout
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {addWorkoutSource === 'choice' && 'Add from Favorites, a collection, or create new.'}
                {addWorkoutSource === 'favorites' && 'Pick a workout from Favorites.'}
                {addWorkoutSource === 'collection' && 'Pick a collection, then a workout.'}
                {addWorkoutSource === 'createNew' && 'Choose day and timer mode for this workout.'}
              </p>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto min-h-0">
              {addWorkoutSource === 'choice' && (
                <>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setAddWorkoutSource('favorites')}
                      className="w-full rounded border border-gymnext-muted/40 border-l-4 border-l-yellow-400 bg-white px-4 py-3 flex items-center gap-3 text-left text-sm font-medium text-gray-900 hover:bg-gymnext-background"
                    >
                      <svg className="h-5 w-5 shrink-0 text-yellow-500" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                      Add from Favorites
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddWorkoutSource('collection')}
                      className="w-full rounded border border-gymnext-muted/40 border-l-4 border-l-amber-800 bg-white px-4 py-3 flex items-center gap-3 text-left text-sm font-medium text-gray-900 hover:bg-gymnext-background"
                    >
                      <svg className="h-5 w-5 shrink-0 text-amber-800" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      Add from Collection
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddWorkoutSource('createNew')}
                      className="w-full rounded border border-gymnext-muted/40 border-l-4 bg-white px-4 py-3 flex items-center gap-3 text-left text-sm font-medium text-gray-900 hover:bg-gymnext-background"
                      style={{ borderLeftColor: '#6B21A8' }}
                    >
                      <svg className="h-5 w-5 shrink-0" style={{ color: '#6B21A8' }} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
                        <path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z" />
                        <path d="m2.5 21.5 1.4-1.4" />
                        <path d="m20.1 3.9 1.4-1.4" />
                        <path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z" />
                        <path d="m9.6 14.4 4.8-4.8" />
                      </svg>
                      Create New Workout
                    </button>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => { setCreateOpen(false); setAddWorkoutSource('choice') }}
                      className="rounded bg-gymnext-background px-3 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
              {addWorkoutSource === 'favorites' && (
                <>
                  <button
                    type="button"
                    onClick={() => { setAddWorkoutSource('choice'); setSelectedWorkoutForPlan(null) }}
                    className="text-xs text-gymnext-dark hover:text-gymnext hover:underline"
                  >
                    ← Back
                  </button>
                  <ul className="space-y-1 max-h-[40vh] overflow-y-auto">
                    {(favoriteWorkouts ?? []).length === 0 ? (
                      <li className="text-xs text-gray-500 py-2">No favorites yet.</li>
                    ) : (
                      (favoriteWorkouts ?? []).map((w) => {
                        const isSelected = selectedWorkoutForPlan?.id === w.id
                        const barColor = getWorkoutBarColor(w)
                        return (
                          <li key={w.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedWorkoutForPlan(isSelected ? null : w)}
                              disabled={createBusy}
                              className={`w-full rounded border px-3 py-2 text-left text-sm disabled:opacity-50 ${
                                isSelected
                                  ? 'border-gymnext bg-purple-50 border-2'
                                  : 'border-gray-200 hover:bg-gray-50'
                              }`}
                              style={{
                                ...(isSelected ? { borderColor: '#6B21A8' } : {}),
                                borderLeftWidth: 4,
                                borderLeftColor: barColor,
                              }}
                            >
                              <span className="font-medium text-gray-900">{getWorkoutDisplayName(w) || 'Workout'}</span>
                              {(getWorkoutDisplayDescription(w) || '').trim() && (
                                <span className="block text-xs text-gray-500 truncate">{getWorkoutDisplayDescription(w)}</span>
                              )}
                            </button>
                          </li>
                        )
                      })
                    )}
                  </ul>
                  {selectedWorkoutForPlan && (
                    <div className="flex justify-end pt-2 border-t border-gray-200 mt-2">
                      <button
                        type="button"
                        onClick={() => addPlannedFromWorkout(selectedWorkoutForPlan)}
                        disabled={createBusy}
                        className="rounded px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                        style={{ backgroundColor: '#6B21A8' }}
                      >
                        {createBusy ? 'Adding…' : 'Confirm'}
                      </button>
                    </div>
                  )}
                </>
              )}
              {addWorkoutSource === 'collection' && (
                <>
                  <button
                    type="button"
                    onClick={() => { setAddWorkoutSource('choice'); setExpandedCollectionId(null); setSelectedWorkoutForPlan(null) }}
                    className="text-xs text-gymnext-dark hover:text-gymnext hover:underline"
                  >
                    ← Back
                  </button>
                  <ul className="space-y-1 max-h-[45vh] overflow-y-auto">
                    {(collectionsExcludingFavorites ?? []).length === 0 ? (
                      <li className="text-xs text-gray-500 py-2">No collections yet.</li>
                    ) : (
                      (collectionsExcludingFavorites ?? []).map((c) => {
                        const isExpanded = expandedCollectionId === c.id
                        const workoutsInCollection = (c.workoutIds ?? [])
                          .map((id) => (workoutsById ?? new Map()).get(id))
                          .filter(Boolean) as Workout[]
                        return (
                          <li key={c.id} className="border border-gray-200 rounded overflow-hidden">
                            <button
                              type="button"
                              onClick={() => setExpandedCollectionId(isExpanded ? null : c.id)}
                              className="w-full px-3 py-2 flex items-center justify-between text-left text-sm font-medium text-gray-900 hover:bg-gray-50 border-l-4"
                              style={{ borderLeftColor: '#795548' }}
                            >
                              <span>{c.workoutCollectionName || 'Unnamed'}</span>
                              <span className="text-gray-400">{isExpanded ? '▼' : '▶'}</span>
                            </button>
                            {isExpanded && (
                              <ul className="border-t border-gray-100 bg-gray-50/50 p-2 space-y-1">
                                {workoutsInCollection.length === 0 ? (
                                  <li className="text-xs text-gray-500 py-1">No workouts in this collection.</li>
                                ) : (
                                  workoutsInCollection.map((w) => {
                                    const isSelected = selectedWorkoutForPlan?.id === w.id
                                    const barColor = getWorkoutBarColor(w)
                                    return (
                                      <li key={w.id}>
                                        <button
                                          type="button"
                                          onClick={() => setSelectedWorkoutForPlan(isSelected ? null : w)}
                                          disabled={createBusy}
                                          className={`w-full rounded border px-3 py-2 text-left text-sm disabled:opacity-50 ${
                                            isSelected
                                              ? 'border-gymnext bg-purple-50 border-2'
                                              : 'border-gray-200 bg-white hover:bg-gray-50'
                                          }`}
                                          style={{
                                            ...(isSelected ? { borderColor: '#6B21A8' } : {}),
                                            borderLeftWidth: 4,
                                            borderLeftColor: barColor,
                                          }}
                                        >
                                          <span className="font-medium text-gray-900">{getWorkoutDisplayName(w) || 'Workout'}</span>
                                          {(getWorkoutDisplayDescription(w) || '').trim() && (
                                            <span className="block text-xs text-gray-500 truncate">{getWorkoutDisplayDescription(w)}</span>
                                          )}
                                        </button>
                                      </li>
                                    )
                                  })
                                )}
                              </ul>
                            )}
                          </li>
                        )
                      })
                    )}
                  </ul>
                  {selectedWorkoutForPlan && (
                    <div className="flex justify-end pt-2 border-t border-gray-200 mt-2">
                      <button
                        type="button"
                        onClick={() => addPlannedFromWorkout(selectedWorkoutForPlan)}
                        disabled={createBusy}
                        className="rounded px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                        style={{ backgroundColor: '#6B21A8' }}
                      >
                        {createBusy ? 'Adding…' : 'Confirm'}
                      </button>
                    </div>
                  )}
                </>
              )}
              {addWorkoutSource === 'createNew' && (
                <>
                  <button
                    type="button"
                    onClick={() => setAddWorkoutSource('choice')}
                    className="text-xs text-gymnext-dark hover:text-gymnext hover:underline"
                  >
                    ← Back
                  </button>
                  <div>
                    <label
                      htmlFor="plan-mode"
                      className="block text-xs font-medium text-gray-700 mb-1"
                    >
                      Timer mode
                    </label>
                    <select
                      id="plan-mode"
                      value={createMode}
                      onChange={(e) => {
                        setCreateMode(Number(e.target.value))
                        setCreateOptions({})
                      }}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                    >
                      {CREATABLE_TIMER_MODES.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <CreateWorkoutOptions
                    mode={createMode}
                    options={createOptions}
                    onChange={setCreateOptions}
                    parseDurationInput={parseDurationInput}
                  />
                  {createError && (
                    <div className="text-xs text-red-600">{createError}</div>
                  )}
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => { setCreateOpen(false); setAddWorkoutSource('choice') }}
                      disabled={createBusy}
                      className="rounded bg-gymnext-background px-3 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleCreatePlanned}
                      disabled={createBusy || !canAddPlannedForSelectedDate || !hasValidDurationForMode(createMode, createOptions, parseDurationInput)}
                      className="rounded px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                      style={{ backgroundColor: '#6B21A8' }}
                    >
                      {createBusy ? 'Adding…' : 'Add to plan'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {createPlanOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !createPlanBusy && setCreatePlanOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
            <div className="border-b border-gymnext-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">Create new plan</h3>
              <p className="text-xs text-gray-500 mt-0.5">Give your plan a name and optional description.</p>
            </div>
            <form onSubmit={handleCreatePlanSubmit} className="p-4 space-y-4">
              <div>
                <label htmlFor="plan-name" className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                <input
                  id="plan-name"
                  type="text"
                  value={createPlanName}
                  onChange={(e) => setCreatePlanName(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  placeholder="Plan name"
                  required
                />
              </div>
              <div>
                <label htmlFor="plan-desc" className="block text-xs font-medium text-gray-700 mb-1">Description (optional)</label>
                <textarea
                  id="plan-desc"
                  rows={2}
                  value={createPlanDescription}
                  onChange={(e) => setCreatePlanDescription(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  placeholder="Optional description"
                />
              </div>
              {createPlanError && <p className="text-xs text-red-600">{createPlanError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreatePlanOpen(false)}
                  disabled={createPlanBusy}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createPlanBusy || !createPlanName.trim()}
                  className="rounded text-white text-sm font-medium px-3 py-2 hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  {createPlanBusy ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {planDeleteConfirmOpen && selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => setPlanDeleteConfirmOpen(false)}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <p className="text-sm text-gray-800">
              Delete this plan? It will be removed from your list.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setPlanDeleteConfirmOpen(false)}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onDeletePlan(selectedPlan.id)
                  setPlanDeleteConfirmOpen(false)
                }}
                className="rounded px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700"
              >
                Delete plan
              </button>
            </div>
          </div>
        </div>
      )}

      {deletePlannedConfirmWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => setDeletePlannedConfirmWorkout(null)}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <p className="text-sm text-gray-800">
              Remove this workout from the plan?
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setDeletePlannedConfirmWorkout(null)}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onDeletePlanned(deletePlannedConfirmWorkout)
                  setDeletePlannedConfirmWorkout(null)
                }}
                className="rounded px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {editPlanOpen && editPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !editPlanBusy && setEditPlanOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
            <div className="border-b border-gymnext-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">Edit plan</h3>
              <p className="text-xs text-gray-500 mt-0.5">Change the name and optional description.</p>
            </div>
            <form onSubmit={handleEditPlanSubmit} className="p-4 space-y-4">
              <div>
                <label htmlFor="edit-plan-name" className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                <input
                  id="edit-plan-name"
                  type="text"
                  value={editPlanName}
                  onChange={(e) => setEditPlanName(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  placeholder="Plan name"
                  required
                />
              </div>
              <div>
                <label htmlFor="edit-plan-desc" className="block text-xs font-medium text-gray-700 mb-1">Description (optional)</label>
                <textarea
                  id="edit-plan-desc"
                  rows={2}
                  value={editPlanDescription}
                  onChange={(e) => setEditPlanDescription(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  placeholder="Optional description"
                />
              </div>
              {editPlanError && <p className="text-xs text-red-600">{editPlanError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditPlanOpen(false)}
                  disabled={editPlanBusy}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editPlanBusy || !editPlanName.trim()}
                  className="rounded text-white text-sm font-medium px-3 py-2 hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  {editPlanBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editPlannedOpen && editPlannedWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !editPlannedBusy && setEditPlannedOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
            <div className="border-b border-gymnext-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">Edit workout</h3>
              <p className="text-xs text-gray-500 mt-0.5">Change the name and description for this planned workout.</p>
            </div>
            <form onSubmit={handleSavePlannedEdit} className="p-4 space-y-4">
              <div>
                <label htmlFor="edit-planned-name" className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                <input
                  id="edit-planned-name"
                  type="text"
                  value={editPlannedName}
                  onChange={(e) => setEditPlannedName(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  placeholder="Workout name"
                  required
                />
              </div>
              <div>
                <label htmlFor="edit-planned-desc" className="block text-xs font-medium text-gray-700 mb-1">Description (optional)</label>
                <textarea
                  id="edit-planned-desc"
                  rows={3}
                  value={editPlannedDescription}
                  onChange={(e) => setEditPlannedDescription(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  placeholder="Optional description"
                />
              </div>
              {editPlannedError && <p className="text-xs text-red-600">{editPlannedError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditPlannedOpen(false)}
                  disabled={editPlannedBusy}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editPlannedBusy || !editPlannedName.trim()}
                  className="rounded text-white text-sm font-medium px-3 py-2 hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  {editPlannedBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editSchedulePlannedWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !editScheduleBusy && setEditSchedulePlannedWorkout(null)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
            <div className="border-b border-gymnext-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">Edit workout schedule</h3>
              <p className="text-xs text-gray-500 mt-0.5">Change duration, rounds, and other schedule settings.</p>
            </div>
            <form onSubmit={handleSaveEditSchedule} className="p-4 space-y-4">
              <CreateWorkoutOptions
                mode={editScheduleMode}
                options={editScheduleOptions}
                onChange={setEditScheduleOptions}
                parseDurationInput={parseDurationInput}
              />
              {editScheduleError && <p className="text-xs text-red-600">{editScheduleError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditSchedulePlannedWorkout(null)}
                  disabled={editScheduleBusy}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editScheduleBusy || !hasValidDurationForMode(editScheduleMode, editScheduleOptions, parseDurationInput)}
                  className="rounded text-white text-sm font-medium px-3 py-2 hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  {editScheduleBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {movePlannedWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !moveBusy && setMovePlannedWorkout(null)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
            <div className="border-b border-gymnext-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">Move to Date</h3>
              <p className="text-xs text-gray-500 mt-0.5">Choose a new date for this planned workout.</p>
            </div>
            <form onSubmit={handleMoveToDate} className="p-4 space-y-4">
              <div>
                <label htmlFor="move-target-day" className="block text-xs font-medium text-gray-700 mb-1">Date</label>
                <input
                  id="move-target-day"
                  type="date"
                  value={moveTargetDay}
                  onChange={(e) => setMoveTargetDay(e.target.value.slice(0, 10))}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                />
              </div>
              {moveError && <p className="text-xs text-red-600">{moveError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setMovePlannedWorkout(null)}
                  disabled={moveBusy}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={moveBusy || !moveTargetDay}
                  className="rounded text-white text-sm font-medium px-3 py-2 hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  {moveBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {copyPlannedWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !copyBusy && setCopyPlannedWorkout(null)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
            <div className="border-b border-gymnext-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">Copy to another plan</h3>
              <p className="text-xs text-gray-500 mt-0.5">Choose a plan and date to add this workout.</p>
            </div>
            <form onSubmit={handleCopyToPlan} className="p-4 space-y-4">
              <div>
                <label htmlFor="copy-target-plan" className="block text-xs font-medium text-gray-700 mb-1">Plan</label>
                <select
                  id="copy-target-plan"
                  value={copyTargetPlanId}
                  onChange={(e) => setCopyTargetPlanId(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                >
                  <option value="">Select a plan</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.workoutPlanName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="copy-target-day" className="block text-xs font-medium text-gray-700 mb-1">Date</label>
                <input
                  id="copy-target-day"
                  type="date"
                  value={copyTargetDay}
                  onChange={(e) => setCopyTargetDay(e.target.value.slice(0, 10))}
                  min={todayYmd}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                />
              </div>
              {copyError && <p className="text-xs text-red-600">{copyError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCopyPlannedWorkout(null)}
                  disabled={copyBusy}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={copyBusy || !copyTargetPlanId || !copyTargetDay}
                  className="rounded text-white text-sm font-medium px-3 py-2 hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  {copyBusy ? 'Copying…' : 'Copy'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// --- Shared helpers for plans ---

function toYYYYMMDD(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getMondayOfWeek(date: Date): string {
  const d = new Date(date)
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return toYYYYMMDD(d)
}

function addDays(ymd: string, days: number): string {
  const d = new Date(ymd + 'T12:00:00.000Z')
  d.setUTCDate(d.getUTCDate() + days)
  return toYYYYMMDD(d)
}

const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

const CREATABLE_TIMER_MODES = [
  { value: 1, label: 'Standard' },
  { value: 2, label: 'Round' },
  { value: 4, label: 'Tabata' },
  { value: 5, label: 'EMOM' },
  { value: 6, label: 'Lap Timer' },
  { value: 7, label: 'Shot Clock' },
  { value: 10, label: 'Warmup' },
  { value: 11, label: 'Cooldown' },
  { value: 12, label: 'Sets with Rest' },
  { value: 13, label: 'Rest' },
] as const

function parseDurationInput(s: string): number {
  const t = s.trim()
  if (!t) return 0
  const parts = t.split(':')
  if (parts.length === 1) {
    const m = parseInt(parts[0]!, 10)
    return Number.isNaN(m) ? 0 : m * 60
  }
  if (parts.length === 2) {
    const m = parseInt(parts[0]!, 10)
    const sec = parseInt(parts[1]!, 10)
    return (Number.isNaN(m) ? 0 : m * 60) + (Number.isNaN(sec) ? 0 : sec)
  }
  if (parts.length === 3) {
    const h = parseInt(parts[0]!, 10)
    const m = parseInt(parts[1]!, 10)
    const sec = parseInt(parts[2]!, 10)
    return (
      (Number.isNaN(h) ? 0 : h * 3600) +
      (Number.isNaN(m) ? 0 : m * 60) +
      (Number.isNaN(sec) ? 0 : sec)
    )
  }
  return 0
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Warmup (10), Cooldown (11), and Rest (13) require a non-zero duration (no infinite). */
function isWarmupCooldownRestMode(mode: number): boolean {
  return mode === 10 || mode === 11 || mode === 13
}

function getTimeCapSeconds(
  options: Record<string, string | number>,
  parseDurationInput: (s: string) => number
): number {
  const t = options.timeCap
  if (t === undefined || t === null) return 0
  if (typeof t === 'number') return t
  return parseDurationInput(String(t))
}

/** Returns false if mode is Warmup/Cooldown/Rest and timeCap is 0 or invalid (those modes don't support infinite). */
function hasValidDurationForMode(
  mode: number,
  options: Record<string, string | number>,
  parseDurationInput: (s: string) => number
): boolean {
  if (!isWarmupCooldownRestMode(mode)) return true
  return getTimeCapSeconds(options, parseDurationInput) > 0
}

/** Parse workoutSchedule JSON into { mode, options, direction } for use with CreateWorkoutOptions / buildWorkoutFromCreateForm. */
function parseScheduleToOptions(scheduleStr: string | null | undefined): {
  mode: number
  options: Record<string, string | number>
  direction: boolean
} {
  const options: Record<string, string | number> = {}
  let mode = 1
  let direction = false
  if (!scheduleStr || typeof scheduleStr !== 'string') {
    return { mode: 1, options: {}, direction: false }
  }
  try {
    const schedule = JSON.parse(scheduleStr) as Record<string, unknown>
    mode = typeof schedule.timerMode === 'number' ? schedule.timerMode : 1
    const num = (key: string) => {
      const v = schedule[key]
      if (typeof v === 'number') return v
      return 0
    }
    const dur = (key: string) => {
      const v = schedule[key]
      if (typeof v === 'number') return v
      return 0
    }
    switch (mode) {
      case 1:
        options.timeCap = formatDuration(num('standardTimeCap') || dur('standardTimeCap'))
        break
      case 2:
        options.duration = formatDuration(num('commonIntervalDuration') || dur('commonIntervalDuration'))
        options.rounds = num('commonIntervalNumberOfRounds')
        options.restBetween = formatDuration(num('commonIntervalRestBetweenRounds') || dur('commonIntervalRestBetweenRounds'))
        break
      case 4:
        options.workDuration = formatDuration(num('tabataWorkDuration') || dur('tabataWorkDuration'))
        options.restDuration = formatDuration(num('tabataRestDuration') || dur('tabataRestDuration'))
        options.roundsPerTabata = num('roundsPerTabata')
        options.numberOfTabatas = num('numberOfTabatas')
        break
      case 5:
        options.intervalSeconds = num('emomIntervalDuration')
        options.intervals = num('emomNumberOfIntervals')
        break
      case 7:
        options.shotClockSeconds = num('shotClockDuration')
        break
      case 10:
        options.timeCap = formatDuration(num('warmupTimeCap') || dur('warmupTimeCap'))
        break
      case 11:
        options.timeCap = formatDuration(num('cooldownTimeCap') || dur('cooldownTimeCap'))
        break
      case 13:
        options.timeCap = formatDuration(num('restTimeCap') || dur('restTimeCap'))
        break
      case 12:
        options.sets = num('restDrivenNumberOfSets')
        options.restDrivenType = num('restDrivenType')
        options.fixedRest = formatDuration(num('restDrivenFixedRestDuration') || dur('restDrivenFixedRestDuration'))
        options.workRatio = num('restDrivenWorkRatio')
        options.restRatio = num('restDrivenRestRatio')
        break
      default:
        break
    }
    direction = schedule.direction === true
  } catch {
    // ignore
  }
  return { mode, options, direction }
}

function buildWorkoutFromCreateForm(
  mode: number,
  options: Record<string, string | number>
): Record<string, unknown> {
  const schedule: Record<string, unknown> = { timerMode: mode }
  const dir =
    options.direction === true || options.direction === 'true'
  const num = (key: string) => {
    const v = options[key]
    if (typeof v === 'number') return v
    if (typeof v === 'string') {
      const n = parseInt(v, 10)
      return Number.isNaN(n) ? 0 : n
    }
    return 0
  }
  const dur = (key: string) => {
    const v = options[key]
    if (typeof v === 'number') return v
    if (typeof v === 'string') return parseDurationInput(v)
    return 0
  }
  switch (mode) {
    case 1:
      schedule.standardTimeCap = dur('timeCap')
      break
    case 2:
      schedule.commonIntervalDuration = dur('duration')
      schedule.commonIntervalNumberOfRounds = num('rounds')
      schedule.commonIntervalRestBetweenRounds = dur('restBetween')
      break
    case 4:
      schedule.tabataWorkDuration = dur('workDuration')
      schedule.tabataRestDuration = dur('restDuration')
      schedule.roundsPerTabata = num('roundsPerTabata')
      schedule.numberOfTabatas = num('numberOfTabatas')
      break
    case 5:
      schedule.emomIntervalDuration = num('intervalSeconds')
      schedule.emomNumberOfIntervals = num('intervals')
      break
    case 7:
      schedule.shotClockDuration = num('shotClockSeconds')
      break
    case 10:
      schedule.warmupTimeCap = dur('timeCap')
      break
    case 11:
      schedule.cooldownTimeCap = dur('timeCap')
      break
    case 12:
      schedule.restDrivenNumberOfSets = num('sets')
      schedule.restDrivenType = num('restDrivenType')
      if (schedule.restDrivenType === 0) {
        schedule.restDrivenFixedRestDuration = dur('fixedRest')
      } else {
        schedule.restDrivenWorkRatio = num('workRatio')
        schedule.restDrivenRestRatio = num('restRatio')
      }
      break
    case 13:
      schedule.restTimeCap = dur('timeCap')
      break
    default:
      break
  }
  return {
    type: 'SingleSegmentWorkout',
    timerMode: mode,
    direction: dir,
    workoutSchedule: JSON.stringify(schedule),
  }
}

function CreateWorkoutOptions({
  mode,
  options,
  onChange,
  parseDurationInput,
}: {
  mode: number
  options: Record<string, string | number>
  onChange: (o: Record<string, string | number>) => void
  parseDurationInput: (s: string) => number
}) {
  const setOpt = (key: string, value: string | number) =>
    onChange({ ...options, [key]: value })
  const getOpt = (key: string, def: string | number) =>
    options[key] ?? def
  const durationInput = (
    key: string,
    label: string,
    placeholder = '0:00'
  ) => (
    <div key={key}>
      <label className="block text-xs font-medium text-gray-700">
        {label}
      </label>
      <input
        type="text"
        placeholder={placeholder}
        value={String(getOpt(key, '') ?? '')}
        onChange={(e) => setOpt(key, e.target.value)}
        className="mt-1 block w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
      />
    </div>
  )
  const numberInput = (
    key: string,
    label: string,
    def = 0,
    min = 0
  ) => (
    <div key={key}>
      <label className="block text-xs font-medium text-gray-700">
        {label}
      </label>
      <input
        type="number"
        min={min}
        value={Number(getOpt(key, def))}
        onChange={(e) =>
          setOpt(key, parseInt(e.target.value, 10) || 0)
        }
        className="mt-1 block w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
      />
    </div>
  )
  const directionSelect = () => (
    <div key="direction">
      <label className="block text-xs font-medium text-gray-700">
        Direction
      </label>
      <select
        value={getOpt('direction', false) ? 'up' : 'down'}
        onChange={(e) => setOpt('direction', e.target.value === 'up')}
        className="mt-1 block w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
      >
        <option value="up">Count up</option>
        <option value="down">Count down</option>
      </select>
    </div>
  )

  switch (mode) {
    case 1:
      return (
        <div className="space-y-3">
          {durationInput(
            'timeCap',
            'Time cap (0 = infinite)',
            '3:00'
          )}
          {directionSelect()}
        </div>
      )
    case 2:
      return (
        <div className="space-y-3">
          {durationInput('duration', 'Round duration', '1:00')}
          {numberInput(
            'rounds',
            'Number of rounds (0 = infinite)',
            3
          )}
          {durationInput(
            'restBetween',
            'Rest between rounds',
            '0:30'
          )}
        </div>
      )
    case 4:
      return (
        <div className="space-y-3">
          {durationInput('workDuration', 'Work duration', '0:20')}
          {durationInput('restDuration', 'Rest duration', '0:10')}
          {numberInput(
            'roundsPerTabata',
            'Rounds per tabata',
            8
          )}
          {numberInput(
            'numberOfTabatas',
            'Number of tabatas',
            1
          )}
        </div>
      )
    case 5:
      return (
        <div className="space-y-3">
          {numberInput(
            'intervalSeconds',
            'Interval (seconds)',
            60
          )}
          {numberInput('intervals', 'Number of intervals', 10)}
        </div>
      )
    case 6:
      return (
        <p className="text-xs text-gray-500">
          No options for lap timer.
        </p>
      )
    case 7:
      return (
        <div className="space-y-3">
          {numberInput(
            'shotClockSeconds',
            'Shot clock (seconds)',
            24
          )}
        </div>
      )
    case 10:
    case 11:
    case 13:
      return (
        <div className="space-y-3">
          {durationInput(
            'timeCap',
            mode === 13
              ? 'Rest duration (min 0:01)'
              : mode === 10
                ? 'Warmup duration (min 0:01)'
                : 'Cooldown duration (min 0:01)',
            '5:00'
          )}
          {directionSelect()}
        </div>
      )
    case 12:
      return (
        <div className="space-y-3">
          {numberInput('sets', 'Number of sets', 3)}
          <div>
            <label className="block text-xs font-medium text-gray-700">
              Rest type
            </label>
            <select
              value={Number(getOpt('restDrivenType', 0))}
              onChange={(e) =>
                setOpt(
                  'restDrivenType',
                  parseInt(e.target.value, 10)
                )
              }
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
            >
              <option value={0}>Fixed rest duration</option>
              <option value={1}>Work:rest ratio</option>
            </select>
          </div>
          {Number(getOpt('restDrivenType', 0)) === 0 ? (
            durationInput('fixedRest', 'Rest duration', '1:00')
          ) : (
            <>
              {numberInput('workRatio', 'Work ratio', 1)}
              {numberInput('restRatio', 'Rest ratio', 1)}
            </>
          )}
        </div>
      )
    default:
      return (
        <p className="text-xs text-gray-500">
          No options for this mode.
        </p>
      )
  }
}

