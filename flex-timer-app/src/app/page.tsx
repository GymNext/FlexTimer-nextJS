/* Main user app: Firebase Auth gating + favorites / collections / plans UI */
'use client'

import { useEffect, useMemo, useState, Fragment, forwardRef, useImperativeHandle, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import Image from 'next/image'
import toast from 'react-hot-toast'
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
  /** Timer Defaults from user settings (e.g. direction = count up/down, restDirection, warmup/cooldown). */
  timerDefaults?: {
    direction?: boolean
    restDirection?: number
    warmupDuration?: number
    warmupDirection?: boolean
    cooldownDuration?: number
    cooldownDirection?: boolean
  }
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
  const [reorderFavoritesError, setReorderFavoritesError] = useState<string | null>(null)
  const [reorderCollectionsError, setReorderCollectionsError] = useState<string | null>(null)
  const [reorderPlansError, setReorderPlansError] = useState<string | null>(null)
  const [collectionDetail, setCollectionDetail] = useState<{
    collection: WorkoutCollection
    workouts: Workout[]
  } | null>(null)
  const [collectionLoading, setCollectionLoading] = useState(false)
  const [collectionError, setCollectionError] = useState<string | null>(null)

  const [plannedWorkouts, setPlannedWorkouts] = useState<PlannedWorkout[]>([])
  const [optimisticPlannedWorkouts, setOptimisticPlannedWorkouts] = useState<PlannedWorkout[] | null>(null)
  const [plansLoading, setPlansLoading] = useState(false)
  const [plansError, setPlansError] = useState<string | null>(null)
  const [weekStart, setWeekStart] = useState<string>(() => getLocalYYYYMMDD(new Date()))
  const [planViewMode, setPlanViewMode] = useState<'week' | '3day' | '1day'>('1day')

  useEffect(() => {
    const today = getLocalYYYYMMDD(new Date())
    if (planViewMode === '1day') {
      setWeekStart(today)
    } else if (planViewMode === '3day') {
      setWeekStart(addDays(today, -1))
    } else {
      setWeekStart(getMondayOfWeekLocal(new Date()))
    }
  }, [planViewMode])

  const planDayCount = planViewMode === 'week' ? 7 : planViewMode === '3day' ? 3 : 1
  const weekEnd = useMemo(
    () => addDays(weekStart, planDayCount - 1),
    [weekStart, planDayCount]
  )

  useEffect(() => {
    setOptimisticPlannedWorkouts(null)
  }, [selectedPlanId, weekStart, planDayCount])

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

  async function handleReorderFavoritesToOrder(workoutIds: string[]) {
    if (!favoritesCollection) return
    try {
      await authedFetch(`/api/app/collections/${encodeURIComponent(favoritesCollection.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workoutIds }),
      })
      await reloadOverview()
    } catch (e) {
      console.error('[favorites reorder]', e)
      setReorderFavoritesError(e instanceof Error ? e.message : 'Failed to save order')
      await reloadOverview()
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
      toast.success('Removed from favorites')
    } catch (e) {
      console.error('[favorites remove]', e)
    }
  }

  async function handleSoftDeleteWorkout(workoutId: string) {
    try {
      await authedFetch(`/api/app/workouts/${encodeURIComponent(workoutId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      await reloadOverview()
      setSelectedFavoriteWorkout(null)
      if (collectionDetail?.collection.workoutIds.includes(workoutId)) {
        const collectionId = collectionDetail.collection.id
        const ids = collectionDetail.collection.workoutIds.filter((id) => id !== workoutId)
        await authedFetch(`/api/app/collections/${encodeURIComponent(collectionId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workoutIds: ids }),
        })
        await reloadOverview()
        await reloadCollectionDetail()
      }
      toast.success('Workout deleted')
    } catch (e) {
      console.error('[soft delete workout]', e)
      throw e
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
    workout:
      | { type: 'MultiSegmentWorkout' }
      | {
          timerMode: number
          workoutSchedule: string
          direction?: boolean
          restDirection?: number
        }
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
      workout:
        | { type: 'MultiSegmentWorkout' }
        | {
            timerMode: number
            workoutSchedule: string
            direction?: boolean
            restDirection?: number
          }
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
    toast.success('Workout saved')
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
    toast.success('Workout saved')
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
        toast.success('Removed from collection')
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

  async function handleReorderCollectionWorkout(collectionId: string, workoutIds: string[]) {
    try {
      await authedFetch(`/api/app/collections/${encodeURIComponent(collectionId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workoutIds }),
      })
      await reloadOverview()
      await reloadCollectionDetail()
    } catch (e) {
      console.error('[collection reorder]', e)
    }
  }

  async function handleReorderCollections(collectionIds: string[]) {
    const fullIds = favoritesCollection ? [favoritesCollection.id, ...collectionIds] : collectionIds
    try {
      await authedFetch('/api/app/collections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionIds: fullIds }),
      })
      await reloadOverview()
    } catch (e) {
      console.error('[collections reorder]', e)
      setReorderCollectionsError(e instanceof Error ? e.message : 'Failed to save order')
      await reloadOverview()
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
    toast.success('Collection updated')
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
      toast.success('Collection deleted')
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

  async function handleReorderPlans(planIds: string[]) {
    try {
      await authedFetch('/api/app/plans', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planIds }),
      })
      await reloadOverview()
    } catch (e) {
      console.error('[plans reorder]', e)
      setReorderPlansError(e instanceof Error ? e.message : 'Failed to save order')
      await reloadOverview()
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
      setOptimisticPlannedWorkouts(null)
    } catch (e) {
      setPlansError(
        e instanceof Error ? e.message : 'Failed to load planned workouts'
      )
      setPlannedWorkouts([])
      setOptimisticPlannedWorkouts(null)
    } finally {
      setPlansLoading(false)
    }
  }

  const byDay = useMemo(() => {
    const source = optimisticPlannedWorkouts ?? plannedWorkouts
    const map: Record<string, PlannedWorkout[]> = {}
    const weekDays = Array.from({ length: planDayCount }, (_, i) =>
      addDays(weekStart, i)
    )
    weekDays.forEach((d) => (map[d] = []))
    source.forEach((pw) => {
      const key = pw.day.slice(0, 10)
      if (!map[key]) map[key] = []
      map[key].push(pw)
    })
    weekDays.forEach((d) => {
      if (map[d]) map[d].sort((a, b) => a.ordinal - b.ordinal)
    })
    return map
  }, [optimisticPlannedWorkouts, plannedWorkouts, weekStart, planDayCount])

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

  function handlePlannedWorkoutDrop(dayKey: string, fromIndex: number, toIndex: number) {
    const items = [...(byDay[dayKey] ?? [])]
    if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex > items.length) return
    // toIndex is the gap (0=before first, 1=between 0 and 1, ..., n=after last). Ignore drop in gap above or below current row.
    if (toIndex === fromIndex) return
    if (toIndex === fromIndex + 1) return
    const [removed] = items.splice(fromIndex, 1)
    // insertAt in reduced list: if moving up (toIndex < fromIndex) use toIndex; if moving down (toIndex > fromIndex+1) use toIndex-1
    const insertAt = toIndex > fromIndex + 1 ? toIndex - 1 : toIndex
    items.splice(Math.max(0, Math.min(insertAt, items.length)), 0, removed!)
    // Update ordinals so byDay's sort preserves the new order when we set state
    items.forEach((pw, idx) => {
      pw.ordinal = idx
    })
    const weekDays = Array.from({ length: planDayCount }, (_, i) => addDays(weekStart, i))
    const fullList = weekDays.flatMap((d) => (d === dayKey ? items : (byDay[d] ?? [])))
    setOptimisticPlannedWorkouts(fullList)
    const planId = selectedPlanId
    if (!planId) return
    Promise.all(
      items.map((pw, idx) =>
        authedFetch(
          `/api/app/plans/${encodeURIComponent(pw.planId)}/planned-workouts/${encodeURIComponent(pw.id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ordinal: idx }),
          }
        )
      )
    )
      .then(() => {
        setPlannedWorkouts(fullList)
        setOptimisticPlannedWorkouts(null)
      })
      .catch((e) => {
        console.error('[planned drop reorder]', e)
        setOptimisticPlannedWorkouts(null)
      })
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
            Planning
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
              onReorderToOrder={handleReorderFavoritesToOrder}
              reorderError={reorderFavoritesError}
              onDismissReorderError={() => setReorderFavoritesError(null)}
              onRemoveFromFavorites={handleRemoveFromFavorites}
              onSoftDeleteWorkout={handleSoftDeleteWorkout}
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
              timerDefaultDirection={overview?.timerDefaults?.direction}
              timerDefaultRestDirection={overview?.timerDefaults?.restDirection}
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
              reorderCollectionsError={reorderCollectionsError}
              onDismissReorderCollectionsError={() => setReorderCollectionsError(null)}
              onRemoveWorkoutFromCollection={handleRemoveWorkoutFromCollection}
              onSoftDeleteWorkout={handleSoftDeleteWorkout}
              onCreateCollection={handleCreateCollection}
              onUpdateCollection={handleUpdateCollection}
              onDeleteCollection={handleDeleteCollection}
              onSaveWorkout={handleSaveCollectionWorkout}
              maxCollections={overview?.subscriptionLimits?.maxCollections ?? UNLIMITED}
              collectionsCount={overview?.counts?.collections ?? 0}
              maxFavorites={overview?.subscriptionLimits?.maxFavorites ?? UNLIMITED}
              favoritesCount={overview?.counts?.favorites ?? 0}
              createWorkoutInCollection={doCreateWorkoutInCollection}
              timerDefaultDirection={overview?.timerDefaults?.direction}
              timerDefaultRestDirection={overview?.timerDefaults?.restDirection}
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
              onPlannedWorkoutDrop={handlePlannedWorkoutDrop}
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
              reorderPlansError={reorderPlansError}
              onDismissReorderPlansError={() => setReorderPlansError(null)}
              favoriteWorkouts={favoriteWorkouts}
              collectionsExcludingFavorites={collectionsExcludingFavorites}
              workoutsById={overview?.workouts ? new Map(overview.workouts.map((w) => [w.id, w])) : new Map()}
              timerDefaults={overview?.timerDefaults}
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
  timerDefaultDirection,
  timerDefaultRestDirection,
  timerModeOptions,
  title = 'Create new favorite workout',
}: {
  onClose: () => void
  createWorkout: (payload: {
    workout:
      | { type: 'MultiSegmentWorkout' }
      | {
          timerMode: number
          workoutSchedule: string
          direction?: boolean
          restDirection?: number
        }
  }) => Promise<Workout>
  onSaveWorkout: (workoutId: string, data: Record<string, unknown>) => Promise<void>
  onCreated: (workout: Workout) => void
  timerDefaultDirection?: boolean
  timerDefaultRestDirection?: number
  /** When provided, use this list for workout type (e.g. favorites: only Standard, Round, Tabata, etc.). */
  timerModeOptions?: { value: number; label: string }[]
  title?: string
}) {
  const modeOptions = timerModeOptions ?? CREATABLE_TIMER_MODES
  const isMultiSegment = (m: number) => m === 100
  const [step, setStep] = useState(1)
  const [mode, setMode] = useState(1)
  const [options, setOptions] = useState<Record<string, string | number>>(() =>
    getDefaultOptionsForMode(1, timerDefaultDirection, timerDefaultRestDirection)
  )
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const built = useMemo(() => {
    if (isMultiSegment(mode)) return { workoutSchedule: '', direction: false }
    return buildWorkoutFromCreateForm(mode, options) as { workoutSchedule: string; direction: boolean }
  }, [mode, options])

  async function handleCreate() {
    if (!isMultiSegment(mode) && !hasValidDurationForMode(mode, options, parseDurationInput)) {
      setError(
        mode === 2
          ? 'Round duration must be greater than 0.'
          : mode === 3
            ? 'Add at least one interval. Work and rest durations must be greater than 0:00. Rounds must be at least 1.'
            : mode === 4
            ? 'Work duration and Rest duration must be greater than 0.'
            : mode === 5
              ? 'Interval and Number of intervals must be greater than 0.'
              : mode === 12
                ? 'Number of sets must be greater than 0. Rest duration must be greater than 0. Work ratio and rest ratio must be greater than 0.'
                : 'Warmup, Cooldown, and Rest require a duration greater than 0:00.'
      )
      return
    }
    setError(null)
    setBusy(true)
    try {
      if (isMultiSegment(mode)) {
        const created = await createWorkout({ workout: { type: 'MultiSegmentWorkout' } })
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
      } else {
        const created = await createWorkout({
          workout: {
            timerMode: mode,
            workoutSchedule: built.workoutSchedule,
            direction: built.direction,
            restDirection:
              (mode === 2 || mode === 4 || mode === 12) && typeof options.restDirection === 'number'
                ? options.restDirection
                : (timerDefaultRestDirection === 2 || timerDefaultRestDirection === 3
                    ? timerDefaultRestDirection
                    : 1),
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
      }
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
            {step === 2 && (mode === 3 ? 'Add and order your intervals.' : 'Configure the timer settings for this workout.')}
            {step === 3 && (mode === 3 ? 'Set number of rounds, rest between rounds, and direction.' : 'Optionally set a name and description.')}
            {step === 4 && 'Optionally set a name and description.'}
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
                    const newMode = Number(e.target.value)
                    setMode(newMode)
                    setOptions(
                      getDefaultOptionsForMode(
                        newMode,
                        timerDefaultDirection,
                        timerDefaultRestDirection
                      )
                    )
                  }}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                >
                  {modeOptions.map((m) => (
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
              {isMultiSegment(mode) ? (
                <p className="text-sm text-gray-600">
                  Multi-segment workout. You can add segments after creating.
                </p>
              ) : (
                <CreateWorkoutOptions
                  mode={mode}
                  options={options}
                  onChange={setOptions}
                  parseDurationInput={parseDurationInput}
                  mixedIntervalsStep={mode === 3 ? 1 : undefined}
                />
              )}
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
                  disabled={!isMultiSegment(mode) && !hasValidDurationForMode(mode, options, parseDurationInput)}
                  className="rounded text-white text-sm font-medium px-3 py-2 hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  Next
                </button>
              </div>
            </>
          )}
          {step === 3 && mode === 3 && (
            <>
              <CreateWorkoutOptions
                mode={3}
                options={options}
                onChange={setOptions}
                parseDurationInput={parseDurationInput}
                mixedIntervalsStep={2}
              />
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
                  onClick={() => setStep(4)}
                  className="rounded text-white text-sm font-medium px-3 py-2 hover:opacity-90"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  Next
                </button>
              </div>
            </>
          )}
          {step === 3 && mode !== 3 && (
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
                  disabled={busy || (!isMultiSegment(mode) && !hasValidDurationForMode(mode, options, parseDurationInput))}
                  className="rounded text-white text-sm font-medium px-3 py-2 hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  {busy ? 'Creating…' : 'Create workout'}
                </button>
              </div>
            </>
          )}
          {step === 4 && (
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
                  onClick={() => setStep(3)}
                  disabled={busy}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={busy || (!isMultiSegment(mode) && !hasValidDurationForMode(mode, options, parseDurationInput))}
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
  onReorderToOrder,
  reorderError,
  onDismissReorderError,
  onRemoveFromFavorites,
  onSoftDeleteWorkout,
  onSave,
  createDialogOpen,
  onOpenCreateDialog,
  onCloseCreateDialog,
  doCreateFavoriteWorkout,
  onCreatedWorkout,
  timerDefaultDirection,
  timerDefaultRestDirection,
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
  onReorderToOrder: (workoutIds: string[]) => void
  reorderError?: string | null
  onDismissReorderError?: () => void
  onRemoveFromFavorites: (workoutId: string) => Promise<void>
  onSoftDeleteWorkout?: (workoutId: string) => Promise<void>
  onSave: (workoutId: string, data: Record<string, unknown>) => Promise<void>
  createDialogOpen: boolean
  onOpenCreateDialog: () => void
  onCloseCreateDialog: () => void
  doCreateFavoriteWorkout: (payload: {
    workout:
      | { type: 'MultiSegmentWorkout' }
      | {
          timerMode: number
          workoutSchedule: string
          direction?: boolean
          restDirection?: number
        }
  }) => Promise<Workout>
  onCreatedWorkout: (workout: Workout) => void
  /** From user Timer Defaults: true = count up, false = count down. Used for Standard (and Warmup/Cooldown/Rest) default. */
  timerDefaultDirection?: boolean
  /** From user Timer Defaults. Used for rest timer direction when creating a workout. */
  timerDefaultRestDirection?: number
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
  const [deleteWorkoutConfirmOpen, setDeleteWorkoutConfirmOpen] = useState(false)
  const [deleteWorkoutBusy, setDeleteWorkoutBusy] = useState(false)

  const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false)
  const [bookmarkSelectedIds, setBookmarkSelectedIds] = useState<Set<string>>(new Set())
  const [bookmarkSaving, setBookmarkSaving] = useState(false)

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [unsavedConfirmOpen, setUnsavedConfirmOpen] = useState(false)
  type PendingUnsavedAction =
    | { type: 'switch'; workout: Workout | null }
    | { type: 'openEdit'; workout: Workout }
  const [pendingUnsavedAction, setPendingUnsavedAction] = useState<PendingUnsavedAction | null>(null)
  const [draggedFavoriteIndex, setDraggedFavoriteIndex] = useState<number | null>(null)
  const [dropIndicatorBeforeIndex, setDropIndicatorBeforeIndex] = useState<number | null>(null)
  const [optimisticOrderedIds, setOptimisticOrderedIds] = useState<string[] | null>(null)
  const detailPanelRef = useRef<{ save: () => Promise<void> }>(null)

  /** Reorder: toIndex = gap index (0=before first, 1=before second, ..., n=after last).
   *  After removing from fromIndex, insert at toIndex when moving up, toIndex-1 when moving down. */
  function reorderIds(ids: string[], fromIndex: number, toIndex: number): string[] {
    if (fromIndex === toIndex) return ids
    const list = [...ids]
    const [removed] = list.splice(fromIndex, 1)
    const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex
    list.splice(Math.max(0, Math.min(insertAt, list.length)), 0, removed)
    return list
  }

  const orderedWorkouts = useMemo(() => {
    if (!optimisticOrderedIds?.length || !favoritesCollection) return favoriteWorkouts
    const idOrder = new Map(optimisticOrderedIds.map((id, i) => [id, i]))
    return [...favoriteWorkouts].sort((a, b) => {
      const ai = idOrder.get(a.id) ?? 1e9
      const bi = idOrder.get(b.id) ?? 1e9
      return ai - bi
    })
  }, [favoriteWorkouts, optimisticOrderedIds, favoritesCollection])

  useEffect(() => {
    setOptimisticOrderedIds(null)
  }, [favoritesCollection?.workoutIds])

  useEffect(() => {
    if (reorderError) setOptimisticOrderedIds(null)
  }, [reorderError])

  function handleFavoriteDrop(draggedId: string, toIndex: number) {
    if (!favoritesCollection) return
    const currentIds = optimisticOrderedIds ?? favoritesCollection.workoutIds
    const fromIndex = currentIds.indexOf(draggedId)
    if (fromIndex === -1) return
    const toIndexClamped = Math.max(0, Math.min(toIndex, currentIds.length))
    const newIds = reorderIds(currentIds, fromIndex, toIndexClamped)
    setOptimisticOrderedIds(newIds)
    setDraggedFavoriteIndex(null)
    setDropIndicatorBeforeIndex(null)
    onReorderToOrder(newIds)
  }

  const maxFav = maxFavorites ?? UNLIMITED
  const count = favoritesCount ?? 0
  const atFavoritesLimit = maxFav < UNLIMITED && count >= maxFav
  const favoritesLabel =
    maxFav >= UNLIMITED
      ? favoritesCollection
        ? ` (${favoriteWorkouts.length})`
        : ''
      : favoritesCollection
        ? ` (${count}/${maxFav})`
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
        {reorderError && (
          <div className="px-4 py-2 flex items-center justify-between gap-2 bg-red-50 border-b border-red-200">
            <p className="text-xs text-red-800">{reorderError}</p>
            <button
              type="button"
              onClick={onDismissReorderError}
              className="text-red-600 hover:text-red-800 text-xs font-medium shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}
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
          <ul
            className="divide-y divide-gray-200 max-h-[60vh] overflow-y-auto"
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const draggedId = e.dataTransfer.getData('text/plain')
              if (!draggedId || !favoritesCollection) return
              const currentIds = optimisticOrderedIds ?? favoritesCollection.workoutIds
              const toIndex = dropIndicatorBeforeIndex ?? currentIds.length
              handleFavoriteDrop(draggedId, toIndex)
            }}
          >
            {orderedWorkouts.map((w, index) => {
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
              const isDragging = draggedFavoriteIndex === index
              function handleDragStart(e: React.DragEvent) {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', w.id)
                setDraggedFavoriteIndex(index)
                setDropIndicatorBeforeIndex(null)
              }
              function handleDragEnd() {
                setDraggedFavoriteIndex(null)
                setDropIndicatorBeforeIndex(null)
              }
              function handleDragOver(e: React.DragEvent) {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (draggedFavoriteIndex === null) return
                const rect = e.currentTarget.getBoundingClientRect()
                const midY = rect.top + rect.height / 2
                const insertBefore = e.clientY < midY ? index : index + 1
                setDropIndicatorBeforeIndex(insertBefore)
              }
              function handleDrop(e: React.DragEvent) {
                e.preventDefault()
                e.stopPropagation()
                const draggedId = e.dataTransfer.getData('text/plain')
                if (!draggedId) {
                  return
                }
                const currentIds = optimisticOrderedIds ?? favoritesCollection!.workoutIds
                const fromIndex = currentIds.indexOf(draggedId)
                if (fromIndex === -1) {
                  return
                }
                const rect = e.currentTarget.getBoundingClientRect()
                const midY = rect.top + rect.height / 2
                const toIndex = dropIndicatorBeforeIndex ?? (e.clientY < midY ? index : index + 1)
                handleFavoriteDrop(draggedId, toIndex)
              }
              return (
              <Fragment key={w.id}>
                {dropIndicatorBeforeIndex === index && (
                  <li
                    className="flex items-center px-3 py-1 list-none"
                    aria-hidden
                    onDragOver={(ev) => {
                      ev.preventDefault()
                      ev.stopPropagation()
                      ev.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={(ev) => {
                      ev.preventDefault()
                      ev.stopPropagation()
                      const id = ev.dataTransfer.getData('text/plain')
                      if (!id) return
                      handleFavoriteDrop(id, index)
                    }}
                  >
                    <div
                      className="h-1 flex-1 rounded-full min-w-0 bg-[#6B21A8]"
                    />
                  </li>
                )}
              <li
                data-index={index}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className={`pl-1 pr-4 py-3 flex items-center gap-3 border-l-8 hover:bg-gray-100 ${
                  isDragging ? 'opacity-50' : ''
                }`}
                style={{ borderLeftColor: barColor }}
              >
                <span
                  draggable
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  className="w-6 shrink-0 flex items-center justify-center text-gray-400 cursor-grab active:cursor-grabbing touch-none"
                  aria-hidden
                  title="Drag to reorder"
                  onClick={(e) => e.stopPropagation()}
                >
                  ⋮⋮
                </span>
                {isSelected && (
                  <span className="shrink-0 text-[#6B21A8]" aria-label="Current workout">
                    ✓
                  </span>
                )}
                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={handleSelectWorkoutClick}
                >
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {getWorkoutDisplayName(w) || w.workoutId}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {getWorkoutDisplayDescription(w) || '—'}
                  </p>
                </div>
              </li>
              </Fragment>
            )
            })}
            {dropIndicatorBeforeIndex === orderedWorkouts.length && (
              <li
                className="flex items-center px-3 py-1 list-none"
                aria-hidden
                onDragOver={(ev) => {
                  ev.preventDefault()
                  ev.stopPropagation()
                  ev.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(ev) => {
                  ev.preventDefault()
                  ev.stopPropagation()
                  const id = ev.dataTransfer.getData('text/plain')
                  if (id) handleFavoriteDrop(id, orderedWorkouts.length)
                }}
              >
                <div
                  className="h-1 flex-1 rounded-full min-w-0 bg-[#6B21A8]"
                />
              </li>
            )}
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
                    <div className="absolute right-0 top-full mt-1 z-50 w-[185px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        onClick={() => {
                          setMoreMenuOpen(false)
                          if (hasUnsavedChanges) {
                            setPendingUnsavedAction({ type: 'openEdit', workout: selectedWorkout })
                            setUnsavedConfirmOpen(true)
                          } else {
                            openEdit(selectedWorkout)
                          }
                        }}
                      >
                        Edit workout
                      </button>
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
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        onClick={() => {
                          setMoreMenuOpen(false)
                          setRemoveConfirmOpen(true)
                        }}
                      >
                        Remove from favorites
                      </button>
                      <div className="my-1 border-t border-gray-200" aria-hidden />
                      {onSoftDeleteWorkout && (
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                          disabled={deleteWorkoutBusy}
                          onClick={() => {
                            setMoreMenuOpen(false)
                            setDeleteWorkoutConfirmOpen(true)
                          }}
                        >
                          Delete workout
                        </button>
                      )}
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
                horizontalScheduleLayout
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
                    toast.success('Bookmarks updated')
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

      {deleteWorkoutConfirmOpen && selectedWorkout && onSoftDeleteWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !deleteWorkoutBusy && setDeleteWorkoutConfirmOpen(false)}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <p className="text-sm text-gray-800">
              Delete this workout? It can be recovered from deleted items.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                disabled={deleteWorkoutBusy}
                onClick={() => setDeleteWorkoutConfirmOpen(false)}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteWorkoutBusy}
                onClick={async () => {
                  setDeleteWorkoutBusy(true)
                  try {
                    await onSoftDeleteWorkout(selectedWorkout.id)
                    setDeleteWorkoutConfirmOpen(false)
                  } finally {
                    setDeleteWorkoutBusy(false)
                  }
                }}
                className="rounded px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {deleteWorkoutBusy ? 'Deleting…' : 'Delete workout'}
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
            </div>
            <form onSubmit={handleEditSubmit} className="p-4 space-y-4">
              <div>
                <label htmlFor="fav-edit-name" className="block text-xs font-medium text-gray-700 mb-1">Name (optional)</label>
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
          timerDefaultDirection={timerDefaultDirection}
          timerDefaultRestDirection={timerDefaultRestDirection}
          timerModeOptions={FAVORITE_CREATABLE_TIMER_MODES}
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
    horizontalScheduleLayout?: boolean
  }
>(function FavoritesDetailPanel({
  workout,
  onSave,
  onClose,
  scheduleOnly = false,
  onDirtyChange,
  horizontalScheduleLayout = false,
}: {
  workout: Workout
  onSave: (workoutId: string, data: Record<string, unknown>) => Promise<void>
  onClose: () => void
  scheduleOnly?: boolean
  onDirtyChange?: (dirty: boolean) => void
  horizontalScheduleLayout?: boolean
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
      !hasValidDurationForMode(scheduleMode, { ...scheduleOptions, direction: scheduleDirection ? 1 : 0 }, parseDurationInput)
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
          direction: scheduleDirection ? 1 : 0,
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
            options={{ ...scheduleOptions, direction: scheduleDirection ? 1 : 0 }}
            onChange={(o) => {
              setScheduleOptions(o)
              setScheduleDirection(Number(o.direction) !== 0 || o.direction === 'true')
              setIsDirty(true)
            }}
            parseDurationInput={parseDurationInput}
            horizontalLayout={horizontalScheduleLayout}
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
  reorderCollectionsError,
  onDismissReorderCollectionsError,
  onRemoveWorkoutFromCollection,
  onSoftDeleteWorkout,
  onCreateCollection,
  onUpdateCollection,
  onDeleteCollection,
  onSaveWorkout,
  maxCollections,
  collectionsCount,
  maxFavorites,
  favoritesCount,
  createWorkoutInCollection,
  timerDefaultDirection,
  timerDefaultRestDirection,
}: {
  collections: WorkoutCollection[]
  collectionDetail: { collection: WorkoutCollection; workouts: Workout[] } | null
  allCollections: WorkoutCollection[]
  onUpdateCollectionWorkoutIds: (collectionId: string, workoutIds: string[]) => Promise<void>
  onReloadCollectionDetail?: () => Promise<void>
  collectionLoading: boolean
  collectionError: string | null
  openCollectionDetail: (collectionId: string) => void
  onReorderWorkout: (collectionId: string, workoutIds: string[]) => void
  onReorderCollections?: (collectionIds: string[]) => void
  reorderCollectionsError?: string | null
  onDismissReorderCollectionsError?: () => void
  onRemoveWorkoutFromCollection: (collectionId: string, workoutId: string) => Promise<void>
  onSoftDeleteWorkout?: (workoutId: string) => Promise<void>
  onCreateCollection: (name: string, description: string | null) => Promise<WorkoutCollection>
  onUpdateCollection: (collectionId: string, name: string, description: string | null) => Promise<void>
  onDeleteCollection: (collectionId: string) => Promise<void>
  onSaveWorkout: (workoutId: string, data: Record<string, unknown>) => Promise<void>
  maxCollections?: number
  collectionsCount?: number
  maxFavorites?: number
  favoritesCount?: number
  createWorkoutInCollection?: (
    collectionId: string,
    payload: {
      workout:
        | { type: 'MultiSegmentWorkout' }
        | {
            timerMode: number
            workoutSchedule: string
            direction?: boolean
            restDirection?: number
          }
    }
  ) => Promise<Workout>
  timerDefaultDirection?: boolean
  timerDefaultRestDirection?: number
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
    | { type: 'deleteWorkoutFromCollection'; workout: Workout }
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
      case 'deleteWorkoutFromCollection':
        setDeleteWorkoutConfirmWorkout(pendingUnsavedAction.workout)
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

  const [collectionWorkoutMenuOpenId, setCollectionWorkoutMenuOpenId] = useState<string | null>(null)
  const [collectionWorkoutMenuAnchorRect, setCollectionWorkoutMenuAnchorRect] = useState<{ top: number; left: number; right: number; bottom: number } | null>(null)
  const [removeFromCollectionConfirmWorkout, setRemoveFromCollectionConfirmWorkout] = useState<Workout | null>(null)
  const [deleteWorkoutConfirmWorkout, setDeleteWorkoutConfirmWorkout] = useState<Workout | null>(null)
  const [deleteWorkoutBusy, setDeleteWorkoutBusy] = useState(false)

  const [collectionBookmarkDialogOpen, setCollectionBookmarkDialogOpen] = useState(false)
  const [collectionBookmarkWorkout, setCollectionBookmarkWorkout] = useState<Workout | null>(null)
  const [collectionBookmarkSelectedIds, setCollectionBookmarkSelectedIds] = useState<Set<string>>(new Set())
  const [collectionBookmarkSaving, setCollectionBookmarkSaving] = useState(false)

  const [collectionCreateDialogOpen, setCollectionCreateDialogOpen] = useState(false)

  const [draggedCollectionIndex, setDraggedCollectionIndex] = useState<number | null>(null)
  const [dropIndicatorBeforeIndex, setDropIndicatorBeforeIndex] = useState<number | null>(null)
  const [optimisticOrderedIds, setOptimisticOrderedIds] = useState<string[] | null>(null)

  const [draggedWorkoutIndex, setDraggedWorkoutIndex] = useState<number | null>(null)
  const [workoutDropIndicatorBeforeIndex, setWorkoutDropIndicatorBeforeIndex] = useState<number | null>(null)
  const [optimisticWorkoutIds, setOptimisticWorkoutIds] = useState<string[] | null>(null)

  /** Reorder: toIndex = gap index (0..n). Insert at toIndex when moving up, toIndex-1 when moving down. */
  function reorderIds(ids: string[], fromIndex: number, toIndex: number): string[] {
    if (fromIndex === toIndex) return ids
    const list = [...ids]
    const [removed] = list.splice(fromIndex, 1)
    const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex
    list.splice(Math.max(0, Math.min(insertAt, list.length)), 0, removed)
    return list
  }

  const orderedCollections = useMemo(() => {
    if (!optimisticOrderedIds?.length || !collections.length) return collections
    const idOrder = new Map(optimisticOrderedIds.map((id, i) => [id, i]))
    return [...collections].sort((a, b) => {
      const ai = idOrder.get(a.id) ?? 1e9
      const bi = idOrder.get(b.id) ?? 1e9
      return ai - bi
    })
  }, [collections, optimisticOrderedIds])

  useEffect(() => {
    setOptimisticOrderedIds(null)
  }, [collections])

  useEffect(() => {
    if (reorderCollectionsError) setOptimisticOrderedIds(null)
  }, [reorderCollectionsError])

  const orderedWorkoutsInCollection = useMemo(() => {
    if (!collectionDetail || !optimisticWorkoutIds?.length) return collectionDetail?.workouts ?? []
    const idOrder = new Map(optimisticWorkoutIds.map((id, i) => [id, i]))
    return [...collectionDetail.workouts].sort((a, b) => {
      const ai = idOrder.get(a.id) ?? 1e9
      const bi = idOrder.get(b.id) ?? 1e9
      return ai - bi
    })
  }, [collectionDetail?.workouts, collectionDetail?.collection.workoutIds, optimisticWorkoutIds])

  useEffect(() => {
    setOptimisticWorkoutIds(null)
  }, [collectionDetail?.collection.id, (collectionDetail?.collection.workoutIds ?? []).join(',')])

  function handleWorkoutDrop(collectionId: string, draggedId: string, toIndex: number) {
    const currentIds = optimisticWorkoutIds ?? collectionDetail?.collection.workoutIds ?? []
    const fromIndex = currentIds.indexOf(draggedId)
    if (fromIndex === -1) return
    const toIndexClamped = Math.max(0, Math.min(toIndex, currentIds.length))
    const newIds = reorderIds(currentIds, fromIndex, toIndexClamped)
    setOptimisticWorkoutIds(newIds)
    setDraggedWorkoutIndex(null)
    setWorkoutDropIndicatorBeforeIndex(null)
    onReorderWorkout(collectionId, newIds)
  }

  function handleCollectionDrop(draggedId: string, toIndex: number) {
    if (!onReorderCollections) return
    const currentIds = optimisticOrderedIds ?? collections.map((c) => c.id)
    const fromIndex = currentIds.indexOf(draggedId)
    if (fromIndex === -1) return
    const toIndexClamped = Math.max(0, Math.min(toIndex, currentIds.length))
    const newIds = reorderIds(currentIds, fromIndex, toIndexClamped)
    setOptimisticOrderedIds(newIds)
    setDraggedCollectionIndex(null)
    setDropIndicatorBeforeIndex(null)
    onReorderCollections(newIds)
  }

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
    maxColl >= UNLIMITED ? `(${collections.length})` : `(${count}/${maxColl})`

  const maxFav = maxFavorites ?? UNLIMITED
  const atFavoritesLimit = maxFav < UNLIMITED && (favoritesCount ?? 0) >= maxFav

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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.8fr)]">
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
        {reorderCollectionsError && onDismissReorderCollectionsError && (
          <div className="px-4 py-2 flex items-center justify-between gap-2 bg-red-50 border-b border-red-200">
            <p className="text-xs text-red-800">{reorderCollectionsError}</p>
            <button
              type="button"
              onClick={onDismissReorderCollectionsError}
              className="text-red-600 hover:text-red-800 text-xs font-medium shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}
        {collections.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">
            You do not have any collections yet.
          </p>
        ) : (
          <ul
            className=""
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const draggedId = e.dataTransfer.getData('text/plain')
              if (!draggedId || !onReorderCollections) return
              const currentIds = optimisticOrderedIds ?? collections.map((c) => c.id)
              const toIndex = dropIndicatorBeforeIndex ?? currentIds.length
              handleCollectionDrop(draggedId, toIndex)
            }}
          >
            {orderedCollections.map((c, index) => {
              const isSelected = collectionDetail?.collection.id === c.id
              return (
              <Fragment key={c.id}>
                {dropIndicatorBeforeIndex === index && (
                  <li
                    className="flex items-center px-3 py-1 list-none border-t-0"
                    aria-hidden
                    onDragOver={(ev) => {
                      ev.preventDefault()
                      ev.stopPropagation()
                      ev.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={(ev) => {
                      ev.preventDefault()
                      ev.stopPropagation()
                      const id = ev.dataTransfer.getData('text/plain')
                      if (id && onReorderCollections) handleCollectionDrop(id, index)
                    }}
                  >
                    <div className="h-1 flex-1 rounded-full min-w-0 bg-[#6B21A8]" />
                  </li>
                )}
                <li
                  role="button"
                  tabIndex={0}
                  data-index={index}
                  onClick={() => openCollectionDetail(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openCollectionDetail(c.id)
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (draggedCollectionIndex === null || !onReorderCollections) return
                    const rect = e.currentTarget.getBoundingClientRect()
                    const midY = rect.top + rect.height / 2
                    const insertBefore = e.clientY < midY ? index : index + 1
                    setDropIndicatorBeforeIndex(insertBefore)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const draggedId = e.dataTransfer.getData('text/plain')
                    if (!draggedId || !onReorderCollections) return
                    const currentIds = optimisticOrderedIds ?? collections.map((c) => c.id)
                    const fromIndex = currentIds.indexOf(draggedId)
                    if (fromIndex === -1) return
                    const rect = e.currentTarget.getBoundingClientRect()
                    const midY = rect.top + rect.height / 2
                    const toIndex = dropIndicatorBeforeIndex ?? (e.clientY < midY ? index : index + 1)
                    handleCollectionDrop(draggedId, Math.max(0, Math.min(toIndex, currentIds.length)))
                  }}
                  className={`px-4 py-3 flex items-center gap-3 cursor-pointer border-l-8 bg-white ${index > 0 ? 'border-t border-gray-200' : ''} ${
                    isSelected ? '' : 'hover:bg-gray-100'
                  } ${draggedCollectionIndex === index ? 'opacity-50' : ''}`}
                  style={{
                    borderLeftColor: isSelected ? '#b45309' : '#d1d5db',
                  }}
                >
                  <span
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', c.id)
                      setDraggedCollectionIndex(index)
                      setDropIndicatorBeforeIndex(null)
                    }}
                    onDragEnd={() => {
                      setDraggedCollectionIndex(null)
                      setDropIndicatorBeforeIndex(null)
                    }}
                    className="w-6 shrink-0 flex items-center justify-center text-gray-400 cursor-grab active:cursor-grabbing touch-none"
                    aria-hidden
                    title="Drag to reorder"
                    onClick={(e) => e.stopPropagation()}
                  >
                    ⋮⋮
                  </span>
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
                </li>
              </Fragment>
              )
            })}
            {dropIndicatorBeforeIndex === orderedCollections.length && (
              <li
                className="flex items-center px-3 py-1 list-none border-t-0"
                aria-hidden
                onDragOver={(ev) => {
                  ev.preventDefault()
                  ev.stopPropagation()
                  ev.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(ev) => {
                  ev.preventDefault()
                  ev.stopPropagation()
                  const id = ev.dataTransfer.getData('text/plain')
                  if (id && onReorderCollections) handleCollectionDrop(id, orderedCollections.length)
                }}
              >
                <div className="h-1 flex-1 rounded-full min-w-0 bg-[#6B21A8]" />
              </li>
            )}
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
                    <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        onClick={() => {
                          setCollectionMoreMenuOpen(false)
                          if (hasUnsavedChanges) {
                            setPendingUnsavedAction({ type: 'editCollection', collection: collectionDetail.collection })
                            setUnsavedConfirmOpen(true)
                          } else {
                            openEdit(collectionDetail.collection)
                          }
                        }}
                      >
                        Edit collection
                      </button>
                      <div className="my-1 border-t border-gray-200" aria-hidden />
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
              <ul
                className=""
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const draggedId = e.dataTransfer.getData('text/plain')
                  if (!draggedId) return
                  const currentIds = optimisticWorkoutIds ?? collectionDetail.collection.workoutIds
                  const toIndex = workoutDropIndicatorBeforeIndex ?? currentIds.length
                  handleWorkoutDrop(collectionDetail.collection.id, draggedId, toIndex)
                }}
              >
                {orderedWorkoutsInCollection.map((w, index) => {
                  const barColor = getWorkoutBarColor(w)
                  const isExpanded = expandedWorkoutId === w.id
                  const isDragging = draggedWorkoutIndex === index
                  return (
                  <Fragment key={w.id}>
                    {workoutDropIndicatorBeforeIndex === index && (
                      <li
                        className="flex items-center px-3 py-1 list-none border-t-0"
                        aria-hidden
                        onDragOver={(ev) => {
                          ev.preventDefault()
                          ev.stopPropagation()
                          ev.dataTransfer.dropEffect = 'move'
                        }}
                        onDrop={(ev) => {
                          ev.preventDefault()
                          ev.stopPropagation()
                          const id = ev.dataTransfer.getData('text/plain')
                          if (id) handleWorkoutDrop(collectionDetail.collection.id, id, index)
                        }}
                      >
                        <div className="h-1 flex-1 rounded-full min-w-0 bg-[#6B21A8]" />
                      </li>
                    )}
                    <li
                      className={`pl-1 pr-3 py-2 flex items-center gap-3 border-l-8 bg-white ${index > 0 ? 'border-t border-gray-200' : ''} ${isDragging ? 'opacity-50' : ''} hover:bg-gymnext-background/50`}
                      style={{ borderLeftColor: barColor }}
                      data-index={index}
                      onDragOver={(e) => {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        if (draggedWorkoutIndex === null) return
                        const rect = e.currentTarget.getBoundingClientRect()
                        const midY = rect.top + rect.height / 2
                        const insertBefore = e.clientY < midY ? index : index + 1
                        setWorkoutDropIndicatorBeforeIndex(insertBefore)
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        const draggedId = e.dataTransfer.getData('text/plain')
                        if (!draggedId) return
                        const currentIds = optimisticWorkoutIds ?? collectionDetail.collection.workoutIds
                        const fromIndex = currentIds.indexOf(draggedId)
                        if (fromIndex === -1) return
                        const rect = e.currentTarget.getBoundingClientRect()
                        const midY = rect.top + rect.height / 2
                        const toIndex = workoutDropIndicatorBeforeIndex ?? (e.clientY < midY ? index : index + 1)
                        handleWorkoutDrop(collectionDetail.collection.id, draggedId, Math.max(0, Math.min(toIndex, currentIds.length)))
                      }}
                    >
                      <span
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', w.id)
                          setDraggedWorkoutIndex(index)
                          setWorkoutDropIndicatorBeforeIndex(null)
                        }}
                        onDragEnd={() => {
                          setDraggedWorkoutIndex(null)
                          setWorkoutDropIndicatorBeforeIndex(null)
                        }}
                        className="w-6 shrink-0 flex items-center justify-center text-gray-400 cursor-grab active:cursor-grabbing touch-none"
                        aria-hidden
                        title="Drag to reorder"
                        onClick={(e) => e.stopPropagation()}
                      >
                        ⋮⋮
                      </span>
                      <div
                        className="min-w-0 flex-1 cursor-pointer py-0.5"
                        onClick={() => handleExpandWorkoutClick(isExpanded ? null : w.id)}
                      >
                        <div className="text-sm font-medium text-gray-900">
                          {getWorkoutDisplayName(w) || w.workoutId}
                        </div>
                        <div className="text-sm text-gray-600 mt-0.5">
                          {getWorkoutDisplayDescription(w) || '—'}
                        </div>
                      </div>
                      <div className="shrink-0 relative" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect()
                            if (collectionWorkoutMenuOpenId === w.id) {
                              setCollectionWorkoutMenuOpenId(null)
                              setCollectionWorkoutMenuAnchorRect(null)
                            } else {
                              setCollectionWorkoutMenuOpenId(w.id)
                              setCollectionWorkoutMenuAnchorRect({ top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom })
                            }
                          }}
                          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                          aria-label="More options"
                          aria-expanded={collectionWorkoutMenuOpenId === w.id}
                        >
                          ⋯
                        </button>
                        {collectionWorkoutMenuOpenId === w.id && collectionWorkoutMenuAnchorRect && typeof document !== 'undefined' && createPortal(
                          <>
                            <div
                              className="fixed inset-0 z-[100]"
                              aria-hidden
                              onClick={() => {
                                setCollectionWorkoutMenuOpenId(null)
                                setCollectionWorkoutMenuAnchorRect(null)
                              }}
                            />
                            <div
                              className="fixed z-[101] w-[185px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                              style={{
                                top: collectionWorkoutMenuAnchorRect.bottom + 4,
                                right: typeof window !== 'undefined' ? window.innerWidth - collectionWorkoutMenuAnchorRect.right : 0,
                              }}
                            >
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm text-gray-900 hover:bg-gray-100"
                                onClick={() => {
                                  setCollectionWorkoutMenuOpenId(null)
                                  setCollectionWorkoutMenuAnchorRect(null)
                                  if (hasUnsavedChanges) {
                                    setPendingUnsavedAction({ type: 'editWorkoutMeta', workout: w })
                                    setUnsavedConfirmOpen(true)
                                  } else {
                                    openEditMeta(w)
                                  }
                                }}
                              >
                                Edit workout
                              </button>
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm text-gray-900 hover:bg-gray-100"
                                onClick={() => {
                                  setCollectionWorkoutMenuOpenId(null)
                                  setCollectionWorkoutMenuAnchorRect(null)
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
                                className="w-full text-left px-3 py-2 text-sm text-gray-900 hover:bg-gray-100"
                                onClick={() => {
                                  setCollectionWorkoutMenuOpenId(null)
                                  setCollectionWorkoutMenuAnchorRect(null)
                                  if (hasUnsavedChanges) {
                                    setPendingUnsavedAction({ type: 'removeFromCollection', workout: w })
                                    setUnsavedConfirmOpen(true)
                                  } else {
                                    setRemoveFromCollectionConfirmWorkout(w)
                                  }
                                }}
                              >
                                Remove from collection
                              </button>
                              <div className="my-1 border-t border-gray-200" aria-hidden />
                              {onSoftDeleteWorkout && (
                                <button
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                  onClick={() => {
                                    setCollectionWorkoutMenuOpenId(null)
                                    setCollectionWorkoutMenuAnchorRect(null)
                                    if (hasUnsavedChanges) {
                                      setPendingUnsavedAction({ type: 'deleteWorkoutFromCollection', workout: w })
                                      setUnsavedConfirmOpen(true)
                                    } else {
                                      setDeleteWorkoutConfirmWorkout(w)
                                    }
                                  }}
                                >
                                  Delete workout
                                </button>
                              )}
                            </div>
                          </>,
                          document.body
                        )}
                      </div>
                    </li>
                    {isExpanded && (
                      <li className="border-t border-gray-200 bg-gray-50/80 list-none">
                        <div className="relative">
                          <div className="p-4 max-h-[60vh] overflow-y-auto">
                            <FavoritesDetailPanel
                              workout={w}
                              scheduleOnly
                              horizontalScheduleLayout
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
                      </li>
                    )}
                  </Fragment>
                  )
                })}
                {workoutDropIndicatorBeforeIndex === orderedWorkoutsInCollection.length && (
                  <li
                    className="flex items-center px-3 py-1 list-none border-t-0"
                    aria-hidden
                    onDragOver={(ev) => {
                      ev.preventDefault()
                      ev.stopPropagation()
                      ev.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={(ev) => {
                      ev.preventDefault()
                      ev.stopPropagation()
                      const id = ev.dataTransfer.getData('text/plain')
                      if (id) handleWorkoutDrop(collectionDetail.collection.id, id, orderedWorkoutsInCollection.length)
                    }}
                  >
                    <div className="h-1 flex-1 rounded-full min-w-0 bg-[#6B21A8]" />
                  </li>
                )}
              </ul>
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
                    toast.success('Bookmarks updated')
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
          timerDefaultDirection={timerDefaultDirection}
          timerDefaultRestDirection={timerDefaultRestDirection}
          timerModeOptions={FAVORITE_CREATABLE_TIMER_MODES}
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

      {deleteWorkoutConfirmWorkout && onSoftDeleteWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !deleteWorkoutBusy && setDeleteWorkoutConfirmWorkout(null)}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <p className="text-sm text-gray-800">
              Delete this workout? It can be recovered from deleted items.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                disabled={deleteWorkoutBusy}
                onClick={() => setDeleteWorkoutConfirmWorkout(null)}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteWorkoutBusy}
                onClick={async () => {
                  setDeleteWorkoutBusy(true)
                  try {
                    await onSoftDeleteWorkout(deleteWorkoutConfirmWorkout.id)
                    setDeleteWorkoutConfirmWorkout(null)
                    setExpandedWorkoutId(null)
                  } finally {
                    setDeleteWorkoutBusy(false)
                  }
                }}
                className="rounded px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {deleteWorkoutBusy ? 'Deleting…' : 'Delete workout'}
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
            </div>
            <form onSubmit={handleEditMetaSubmit} className="p-4 space-y-4">
              <div>
                <label htmlFor="coll-edit-workout-name" className="block text-xs font-medium text-gray-700 mb-1">Name (optional)</label>
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
  onPlannedWorkoutDrop,
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
  reorderPlansError,
  onDismissReorderPlansError,
  favoriteWorkouts,
  collectionsExcludingFavorites,
  workoutsById,
  timerDefaults,
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
  onPlannedWorkoutDrop: (dayKey: string, fromIndex: number, toIndex: number) => void
  onDeletePlanned: (pw: PlannedWorkout) => void
  user: User
  reloadPlanned: () => void
  onCreatePlan: (name: string, description: string | null) => Promise<WorkoutPlan>
  onUpdatePlan: (planId: string, name: string, description: string | null) => Promise<void>
  onDeletePlan: (planId: string) => Promise<void>
  maxPlans?: number
  plansCount?: number
  subscriptionTier?: SubscriptionTier
  onReorderPlans?: (planIds: string[]) => void
  reorderPlansError?: string | null
  onDismissReorderPlansError?: () => void
  favoriteWorkouts?: Workout[]
  collectionsExcludingFavorites?: WorkoutCollection[]
  workoutsById?: Map<string, Workout>
  timerDefaults?: {
    direction?: boolean
    restDirection?: number
    warmupDuration?: number
    warmupDirection?: boolean
    cooldownDuration?: number
    cooldownDirection?: boolean
  }
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
  const todayYmd = getLocalYYYYMMDD(new Date())
  const [createDate, setCreateDate] = useState<string>(() => todayYmd)
  const [createMode, setCreateMode] = useState<number>(1)
  const [createOptions, setCreateOptions] = useState<
    Record<string, string | number>
  >({})
  const [createError, setCreateError] = useState<string | null>(null)
  const [createBusy, setCreateBusy] = useState(false)

  const [planMoreMenuOpen, setPlanMoreMenuOpen] = useState(false)
  const [planDeleteConfirmOpen, setPlanDeleteConfirmOpen] = useState(false)
  const [expandedPlannedWorkoutId, setExpandedPlannedWorkoutId] = useState<string | null>(null)
  const [draggedPlanned, setDraggedPlanned] = useState<{ dateKey: string; index: number } | null>(null)
  const [plannedDropIndicator, setPlannedDropIndicator] = useState<{ dateKey: string; beforeIndex: number } | null>(null)
  const [plannedWorkoutMenuId, setPlannedWorkoutMenuId] = useState<string | null>(null)
  const [plannedWorkoutMenuAnchorRect, setPlannedWorkoutMenuAnchorRect] = useState<DOMRect | null>(null)
  const [copyPlannedWorkout, setCopyPlannedWorkout] = useState<PlannedWorkout | null>(null)
  const [copyTargetPlanId, setCopyTargetPlanId] = useState<string>('')
  const [copyTargetDay, setCopyTargetDay] = useState<string>(() => getLocalYYYYMMDD(new Date()))
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

  const [draggedPlanIndex, setDraggedPlanIndex] = useState<number | null>(null)
  const [dropIndicatorBeforeIndex, setDropIndicatorBeforeIndex] = useState<number | null>(null)
  const [optimisticOrderedIds, setOptimisticOrderedIds] = useState<string[] | null>(null)

  /** Reorder: toIndex = gap index (0..n). Insert at toIndex when moving up, toIndex-1 when moving down. */
  function reorderIds(ids: string[], fromIndex: number, toIndex: number): string[] {
    if (fromIndex === toIndex) return ids
    const list = [...ids]
    const [removed] = list.splice(fromIndex, 1)
    const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex
    list.splice(Math.max(0, Math.min(insertAt, list.length)), 0, removed)
    return list
  }

  const orderedPlans = useMemo(() => {
    if (!optimisticOrderedIds?.length || !plans.length) return plans
    const idOrder = new Map(optimisticOrderedIds.map((id, i) => [id, i]))
    return [...plans].sort((a, b) => {
      const ai = idOrder.get(a.id) ?? 1e9
      const bi = idOrder.get(b.id) ?? 1e9
      return ai - bi
    })
  }, [plans, optimisticOrderedIds])

  useEffect(() => {
    setOptimisticOrderedIds(null)
  }, [plans])
  useEffect(() => {
    if (reorderPlansError) setOptimisticOrderedIds(null)
  }, [reorderPlansError])

  function handlePlanDrop(draggedId: string, toIndex: number) {
    if (!onReorderPlans) return
    const currentIds = optimisticOrderedIds ?? plans.map((p) => p.id)
    const fromIndex = currentIds.indexOf(draggedId)
    if (fromIndex === -1) return
    const toIndexClamped = Math.max(0, Math.min(toIndex, currentIds.length))
    const newIds = reorderIds(currentIds, fromIndex, toIndexClamped)
    setOptimisticOrderedIds(newIds)
    setDraggedPlanIndex(null)
    setDropIndicatorBeforeIndex(null)
    onReorderPlans(newIds)
  }

  const selectedPlan =
    selectedPlanId === null
      ? null
      : plans.find((p) => p.id === selectedPlanId) ?? null

  const maxP = maxPlans ?? UNLIMITED
  const planCount = plansCount ?? 0
  const atPlansLimit = maxP < UNLIMITED && planCount >= maxP
  const plansLabel = maxP >= UNLIMITED ? `(${plans.length})` : `(${planCount}/${maxP})`

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
    setEditScheduleOptions({ ...parsed.options, direction: parsed.direction ? 1 : 0 })
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
      reloadPlanned()
      setEditSchedulePlannedWorkout(null)
      setExpandedPlannedWorkoutId(null)
      toast.success('Workout schedule saved')
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
      setExpandedPlannedWorkoutId(null)
      toast.success('Planned workout saved')
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
      toast.success('Workout copied to plan')
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
      toast.success('Workout moved to date')
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

  /** Add from favorite or collection: copy workout into planned workout, set sourceWorkoutId to workout.id, ordinal = end of list for that day. */
  async function addPlannedFromWorkout(workout: Workout) {
    if (!selectedPlan) return
    setCreateBusy(true)
    setCreateError(null)
    try {
      const dayKey = createDate.slice(0, 10)
      const ordinal = (byDay[dayKey] ?? []).length
      const res = await authedFetch(
        `/api/app/plans/${encodeURIComponent(selectedPlan.id)}/planned-workouts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            day: createDate,
            ordinal,
            workout: workoutToPlanDayEntry(workout),
            sourceWorkoutId: workout.id,
            clientToday: todayYmd,
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

  /** Create from scratch: workout from form, sourceWorkoutId null, ordinal = end of list for that day. plannedWorkoutId and plan/day set by API. */
  async function handleCreatePlanned() {
    if (!selectedPlan) return
    if (!hasValidDurationForMode(createMode, createOptions, parseDurationInput)) {
      setCreateError('Warmup, Cooldown, and Rest require a duration greater than 0:00.')
      return
    }
    setCreateError(null)
    setCreateBusy(true)
    try {
      const workout = buildWorkoutFromCreateForm(
        createMode,
        Object.keys(createOptions).length === 0
          ? getDefaultOptionsForMode(
              createMode,
              timerDefaults?.direction,
              timerDefaults?.restDirection,
              timerDefaults?.warmupDuration,
              timerDefaults?.warmupDirection,
              timerDefaults?.cooldownDuration,
              timerDefaults?.cooldownDirection
            )
          : createOptions
      )
      const dayKey = createDate.slice(0, 10)
      const ordinal = (byDay[dayKey] ?? []).length
      const res = await authedFetch(
        `/api/app/plans/${encodeURIComponent(
          selectedPlan.id
        )}/planned-workouts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            day: createDate,
            ordinal,
            workout,
            sourceWorkoutId: null,
            clientToday: todayYmd,
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
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.8fr)]">
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
          {reorderPlansError && onDismissReorderPlansError && (
            <div className="px-4 py-2 flex items-center justify-between gap-2 bg-red-50 border-b border-red-200">
              <p className="text-xs text-red-800">{reorderPlansError}</p>
              <button
                type="button"
                onClick={onDismissReorderPlansError}
                className="text-red-600 hover:text-red-800 text-xs font-medium shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}
          {plans.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">
              You do not have any plans yet. Create one to get started.
            </p>
          ) : (
            <ul
              className=""
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const draggedId = e.dataTransfer.getData('text/plain')
                if (!draggedId || !onReorderPlans) return
                const currentIds = optimisticOrderedIds ?? plans.map((p) => p.id)
                const toIndex = dropIndicatorBeforeIndex ?? currentIds.length
                handlePlanDrop(draggedId, toIndex)
              }}
            >
              {orderedPlans.map((p, index) => {
                const isSelected = selectedPlan?.id === p.id
                return (
                <Fragment key={p.id}>
                  {dropIndicatorBeforeIndex === index && (
                    <li
                      className="flex items-center px-3 py-1 list-none border-t-0"
                      aria-hidden
                      onDragOver={(ev) => {
                        ev.preventDefault()
                        ev.stopPropagation()
                        ev.dataTransfer.dropEffect = 'move'
                      }}
                      onDrop={(ev) => {
                        ev.preventDefault()
                        ev.stopPropagation()
                        const id = ev.dataTransfer.getData('text/plain')
                        if (id && onReorderPlans) handlePlanDrop(id, index)
                      }}
                    >
                      <div className="h-1 flex-1 rounded-full min-w-0 bg-[#6B21A8]" />
                    </li>
                  )}
                  <li
                    data-index={index}
                    className={`pl-1 pr-4 py-3 flex items-center gap-3 cursor-pointer border-l-8 bg-white ${index > 0 ? 'border-t border-gray-200' : ''} ${
                      isSelected ? '' : 'hover:bg-gray-100'
                    } ${draggedPlanIndex === index ? 'opacity-50' : ''}`}
                    style={{ borderLeftColor: isSelected ? '#6B21A8' : '#d1d5db' }}
                    onClick={() => setSelectedPlanId(isSelected ? null : p.id)}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      if (draggedPlanIndex === null || !onReorderPlans) return
                      const rect = e.currentTarget.getBoundingClientRect()
                      const midY = rect.top + rect.height / 2
                      const insertBefore = e.clientY < midY ? index : index + 1
                      setDropIndicatorBeforeIndex(insertBefore)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const draggedId = e.dataTransfer.getData('text/plain')
                      if (!draggedId || !onReorderPlans) return
                      const currentIds = optimisticOrderedIds ?? plans.map((plan) => plan.id)
                      const fromIndex = currentIds.indexOf(draggedId)
                      if (fromIndex === -1) return
                      const rect = e.currentTarget.getBoundingClientRect()
                      const midY = rect.top + rect.height / 2
                      const toIndex = dropIndicatorBeforeIndex ?? (e.clientY < midY ? index : index + 1)
                      handlePlanDrop(draggedId, Math.max(0, Math.min(toIndex, currentIds.length)))
                    }}
                  >
                    <span
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', p.id)
                        setDraggedPlanIndex(index)
                        setDropIndicatorBeforeIndex(null)
                      }}
                      onDragEnd={() => {
                        setDraggedPlanIndex(null)
                        setDropIndicatorBeforeIndex(null)
                      }}
                      className="w-6 shrink-0 flex items-center justify-center text-gray-400 cursor-grab active:cursor-grabbing touch-none"
                      aria-hidden
                      title="Drag to reorder"
                      onClick={(e) => e.stopPropagation()}
                    >
                      ⋮⋮
                    </span>
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
                  </li>
                </Fragment>
              )
              })}
              {dropIndicatorBeforeIndex === orderedPlans.length && (
                <li
                  className="flex items-center px-3 py-1 list-none border-t-0"
                  aria-hidden
                  onDragOver={(ev) => {
                    ev.preventDefault()
                    ev.stopPropagation()
                    ev.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(ev) => {
                    ev.preventDefault()
                    ev.stopPropagation()
                    const id = ev.dataTransfer.getData('text/plain')
                    if (id && onReorderPlans) handlePlanDrop(id, orderedPlans.length)
                  }}
                >
                  <div className="h-1 flex-1 rounded-full min-w-0 bg-[#6B21A8]" />
                </li>
              )}
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
                  <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      onClick={() => {
                        setPlanMoreMenuOpen(false)
                        openEditPlan(selectedPlan)
                      }}
                    >
                      Edit plan
                    </button>
                    {selectedPlan.id !== 'personal' && (
                      <>
                        <div className="my-1 border-t border-gray-200" aria-hidden />
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
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="border-b border-gymnext-muted/30 bg-gymnext-background px-4 py-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setWeekStart(addDays(weekStart, -planDayCount))}
                className="rounded border border-gymnext-muted/50 bg-white px-2.5 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-background"
              >
                ← Prev
              </button>
              <span className="text-xs text-gray-600">
                {planViewMode === '1day'
                  ? new Date(weekStart + 'T12:00:00').toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : <>
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
                    </>}
              </span>
              <button
                type="button"
                onClick={() => setWeekStart(addDays(weekStart, planDayCount))}
                className="rounded border border-gymnext-muted/50 bg-white px-2.5 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-background"
              >
                Next →
              </button>
            </div>
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
            <div className="grid grid-cols-1 divide-y divide-gray-200">
              {Array.from({ length: planDayCount }, (_, i) => {
                const dateKey = addDays(weekStart, i)
                const items = byDay[dateKey] ?? []
                const dayDate = new Date(dateKey + 'T12:00:00')
                const dayName = dayDate.toLocaleDateString(undefined, {
                  weekday: 'short',
                })
                return (
                  <div key={dateKey} className="min-h-[140px] flex flex-col">
                    <div className="px-3 py-2 bg-gymnext-background border-b border-gymnext-muted/30 flex items-center gap-2">
                      <div className="flex-1 min-w-0" aria-hidden />
                      <div className="text-center shrink-0">
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
                      <div className="flex-1 min-w-0 flex justify-end">
                        {dateKey >= todayYmd && (
                          <button
                            type="button"
                            onClick={() => {
                              setCreateDate(dateKey)
                              setAddWorkoutSource('choice')
                              setExpandedCollectionId(null)
                              setCreateError(null)
                              setCreateOpen(true)
                            }}
                            className="shrink-0 rounded px-2 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                            style={{ backgroundColor: '#6B21A8' }}
                          >
                            Add workout
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="p-2 flex-1 space-y-0">
                      {items.length === 0 && dateKey < todayYmd && (
                        <p className="text-[11px] text-gray-400 italic px-1 py-2">
                          Rest day
                        </p>
                      )}
                      {items.length > 0 && (
                        <ul
                          className=""
                          onDragOver={(e) => {
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'move'
                          }}
                          onDrop={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            const raw = e.dataTransfer.getData('text/plain')
                            if (!raw) return
                            let dateKeyDrag: string
                            let fromIndex: number
                            try {
                              const parsed = JSON.parse(raw) as { dateKey: string; index: number }
                              dateKeyDrag = parsed.dateKey
                              fromIndex = parsed.index
                            } catch {
                              return
                            }
                            if (dateKeyDrag !== dateKey) {
                              setDraggedPlanned(null)
                              setPlannedDropIndicator(null)
                              return
                            }
                            const toIndex =
                              plannedDropIndicator?.dateKey === dateKey
                                ? plannedDropIndicator.beforeIndex
                                : items.length
                            setDraggedPlanned(null)
                            setPlannedDropIndicator(null)
                            onPlannedWorkoutDrop(dateKey, fromIndex, toIndex)
                          }}
                        >
                          {items.map((pw, index) => {
                          const w = pw.workout
                          const barColor = getWorkoutBarColor(w)
                          const isPast = dateKey < todayYmd
                          const isDragging =
                            draggedPlanned?.dateKey === dateKey && draggedPlanned?.index === index
                          return (
                            <Fragment key={pw.id}>
                              {/* Drop zone above this row: overlaps row above so no visible gap when not dragging */}
                              <li
                                className={`flex items-center list-none border-t-0 -mt-1 pt-1 ${plannedDropIndicator?.dateKey === dateKey && plannedDropIndicator.beforeIndex === index ? 'px-3 pb-1 relative z-10' : 'px-3'}`}
                                aria-hidden
                                onDragOver={(ev) => {
                                  if (isPast) return
                                  ev.preventDefault()
                                  ev.stopPropagation()
                                  ev.dataTransfer.dropEffect = 'move'
                                  if (draggedPlanned && draggedPlanned.dateKey === dateKey) {
                                    setPlannedDropIndicator({ dateKey, beforeIndex: index })
                                  }
                                }}
                                onDrop={(ev) => {
                                  ev.preventDefault()
                                  ev.stopPropagation()
                                  const raw = ev.dataTransfer.getData('text/plain')
                                  if (!raw) return
                                  try {
                                    const parsed = JSON.parse(raw) as { dateKey: string; index: number }
                                    if (parsed.dateKey !== dateKey) return
                                    const toIndex = index
                                    setDraggedPlanned(null)
                                    setPlannedDropIndicator(null)
                                    onPlannedWorkoutDrop(dateKey, parsed.index, toIndex)
                                  } catch {
                                    setDraggedPlanned(null)
                                    setPlannedDropIndicator(null)
                                  }
                                }}
                              >
                                <div className={`flex-1 min-w-0 rounded-full ${plannedDropIndicator?.dateKey === dateKey && plannedDropIndicator.beforeIndex === index ? 'h-1 bg-[#6B21A8]' : 'min-h-0 h-0 overflow-hidden'}`} />
                              </li>
                              <li
                                className={`pl-1 pr-3 py-2 flex items-center gap-3 border-l-8 bg-white ${index > 0 ? 'border-t border-gray-200' : ''} ${isDragging ? 'opacity-50' : ''} hover:bg-gymnext-background/50`}
                                style={{ borderLeftColor: barColor }}
                                data-index={index}
                                onDragOver={(e) => {
                                  if (isPast) return
                                  e.preventDefault()
                                  e.dataTransfer.dropEffect = 'move'
                                  if (draggedPlanned === null) return
                                  if (draggedPlanned.dateKey !== dateKey) return
                                  const rect = e.currentTarget.getBoundingClientRect()
                                  const midY = rect.top + rect.height / 2
                                  const insertBefore = e.clientY < midY ? index : index + 1
                                  setPlannedDropIndicator({ dateKey, beforeIndex: insertBefore })
                                }}
                                onDrop={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  const raw = e.dataTransfer.getData('text/plain')
                                  if (!raw) return
                                  try {
                                    const parsed = JSON.parse(raw) as { dateKey: string; index: number }
                                    if (parsed.dateKey !== dateKey) {
                                      setDraggedPlanned(null)
                                      setPlannedDropIndicator(null)
                                      return
                                    }
                                    const rect = e.currentTarget.getBoundingClientRect()
                                    const midY = rect.top + rect.height / 2
                                    const toIndex = plannedDropIndicator?.dateKey === dateKey
                                      ? plannedDropIndicator.beforeIndex
                                      : e.clientY < midY ? index : index + 1
                                    setDraggedPlanned(null)
                                    setPlannedDropIndicator(null)
                                    onPlannedWorkoutDrop(dateKey, parsed.index, toIndex)
                                  } catch {
                                    setDraggedPlanned(null)
                                    setPlannedDropIndicator(null)
                                  }
                                }}
                              >
                                {!isPast ? (
                                  <span
                                    draggable
                                    onDragStart={(e) => {
                                      e.dataTransfer.effectAllowed = 'move'
                                      e.dataTransfer.setData(
                                        'text/plain',
                                        JSON.stringify({ dateKey, index })
                                      )
                                      setDraggedPlanned({ dateKey, index })
                                      setPlannedDropIndicator(null)
                                    }}
                                    onDragEnd={() => {
                                      setDraggedPlanned(null)
                                      setPlannedDropIndicator(null)
                                    }}
                                    className="w-6 shrink-0 flex items-center justify-center text-gray-400 cursor-grab active:cursor-grabbing touch-none text-[10px]"
                                    aria-hidden
                                    title="Drag to reorder"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    ⋮⋮
                                  </span>
                                ) : (
                                  <span
                                    className="w-6 shrink-0 flex items-center justify-center text-gray-400 text-[10px] select-none"
                                    aria-hidden
                                  >
                                    ⋮⋮
                                  </span>
                                )}
                                <div
                                  className="min-w-0 flex-1 py-0.5 cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (isPast) return
                                    if (expandedPlannedWorkoutId === pw.id) {
                                      setExpandedPlannedWorkoutId(null)
                                      setEditSchedulePlannedWorkout(null)
                                    } else {
                                      setExpandedPlannedWorkoutId(pw.id)
                                      openEditSchedulePlanned(pw)
                                    }
                                  }}
                                >
                                  <div className="text-sm font-medium text-gray-900">
                                    {getWorkoutDisplayName(w) || 'Workout'}
                                  </div>
                                  <div className="text-sm text-gray-600 mt-0.5">
                                    {((w.workoutDescription ?? getWorkoutDisplayDescription(w)) || '').trim() || '—'}
                                  </div>
                                </div>
                                <div className="shrink-0 relative" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      const rect = e.currentTarget.getBoundingClientRect()
                                      if (plannedWorkoutMenuId === pw.id) {
                                        setPlannedWorkoutMenuId(null)
                                        setPlannedWorkoutMenuAnchorRect(null)
                                      } else {
                                        setPlannedWorkoutMenuId(pw.id)
                                        setPlannedWorkoutMenuAnchorRect(rect)
                                      }
                                    }}
                                    className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                                    aria-label="More options"
                                    aria-expanded={plannedWorkoutMenuId === pw.id}
                                  >
                                    ⋯
                                  </button>
                                  {plannedWorkoutMenuId === pw.id && plannedWorkoutMenuAnchorRect && typeof document !== 'undefined' && createPortal(
                                    <>
                                      <div
                                        className="fixed inset-0 z-[100]"
                                        aria-hidden
                                        onClick={() => {
                                          setPlannedWorkoutMenuId(null)
                                          setPlannedWorkoutMenuAnchorRect(null)
                                        }}
                                      />
                                      <div
                                        className="fixed z-[101] w-[185px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                                        style={{
                                          top: plannedWorkoutMenuAnchorRect.bottom + 4,
                                          right: typeof window !== 'undefined' ? window.innerWidth - plannedWorkoutMenuAnchorRect.right : 0,
                                        }}
                                      >
                                        {!isPast && (
                                          <>
                                        <button
                                          type="button"
                                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                          onClick={() => {
                                            setPlannedWorkoutMenuId(null)
                                            setPlannedWorkoutMenuAnchorRect(null)
                                            openEditPlanned(pw)
                                          }}
                                        >
                                          Edit workout
                                        </button>
                                        </>
                                        )}
                                        <button
                                          type="button"
                                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                          onClick={() => {
                                            setPlannedWorkoutMenuId(null)
                                            setPlannedWorkoutMenuAnchorRect(null)
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
                                            setPlannedWorkoutMenuAnchorRect(null)
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
                                            setPlannedWorkoutMenuAnchorRect(null)
                                            setDeletePlannedConfirmWorkout(pw)
                                          }}
                                        >
                                          Delete
                                        </button>
                                        </>
                                        )}
                                      </div>
                                    </>,
                                    document.body
                                  )}
                                </div>
                              </li>
                              {expandedPlannedWorkoutId === pw.id && (
                                <li className="border-t border-gray-200 bg-gray-50/80 list-none">
                                  <div className="p-4">
                                    <div className="mb-3">
                                      <label className="block text-xs font-medium text-gray-700 mb-1">
                                        Timer mode
                                      </label>
                                      <p className="text-sm text-gray-900 py-1.5">
                                        {PLANNED_WORKOUT_CREATABLE_TIMER_MODES.find((m) => m.value === editScheduleMode)?.label ?? 'Standard'}
                                      </p>
                                    </div>
                                    <form onSubmit={handleSaveEditSchedule} className="space-y-4">
                                      <CreateWorkoutOptions
                                        mode={editScheduleMode}
                                        options={editScheduleOptions}
                                        onChange={setEditScheduleOptions}
                                        parseDurationInput={parseDurationInput}
                                        horizontalLayout
                                      />
                                      {editScheduleError && <p className="text-xs text-red-600">{editScheduleError}</p>}
                                      <div className="flex justify-end gap-2">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setExpandedPlannedWorkoutId(null)
                                            setEditSchedulePlannedWorkout(null)
                                            setEditScheduleError(null)
                                          }}
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
                                </li>
                              )}
                            </Fragment>
                          )
                        })}
                              {/* Drop zone after last row: overlaps row above so no visible gap when not dragging */}
                              <li
                                className={`flex items-center list-none border-t-0 -mt-1 pt-1 ${plannedDropIndicator?.dateKey === dateKey && plannedDropIndicator.beforeIndex === items.length ? 'px-3 pb-1 relative z-10' : 'px-3'}`}
                                aria-hidden
                                onDragOver={(ev) => {
                                  if (dateKey >= todayYmd) {
                                    ev.preventDefault()
                                    ev.stopPropagation()
                                    ev.dataTransfer.dropEffect = 'move'
                                    if (draggedPlanned && draggedPlanned.dateKey === dateKey) {
                                      setPlannedDropIndicator({ dateKey, beforeIndex: items.length })
                                    }
                                  }
                                }}
                                onDrop={(ev) => {
                                  ev.preventDefault()
                                  ev.stopPropagation()
                                  const raw = ev.dataTransfer.getData('text/plain')
                                  if (!raw) return
                                  try {
                                    const parsed = JSON.parse(raw) as { dateKey: string; index: number }
                                    if (parsed.dateKey !== dateKey) return
                                    const toIndex = items.length
                                    setDraggedPlanned(null)
                                    setPlannedDropIndicator(null)
                                    onPlannedWorkoutDrop(dateKey, parsed.index, toIndex)
                                  } catch {
                                    setDraggedPlanned(null)
                                    setPlannedDropIndicator(null)
                                  }
                                }}
                              >
                                <div className={`flex-1 min-w-0 rounded-full ${plannedDropIndicator?.dateKey === dateKey && plannedDropIndicator.beforeIndex === items.length ? 'h-1 bg-[#6B21A8]' : 'min-h-0 h-0 overflow-hidden'}`} />
                              </li>
                        </ul>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {selectedPlan && !plansLoading && (
            <div className="flex justify-center py-3 border-b border-gymnext-muted/30 bg-gymnext-background">
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
              {(addWorkoutSource === 'favorites' || addWorkoutSource === 'collection' || addWorkoutSource === 'createNew') && (createError || plannedDateRestrictionMessage) && (
                <div className="text-xs text-red-600 rounded border border-red-200 bg-red-50 px-3 py-2">
                  {createError ?? plannedDateRestrictionMessage}
                </div>
              )}
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
                      onClick={() => {
                        setAddWorkoutSource('createNew')
                        setCreateOptions(
                          getDefaultOptionsForMode(
                            createMode,
                            timerDefaults?.direction,
                            timerDefaults?.restDirection,
                            timerDefaults?.warmupDuration,
                            timerDefaults?.warmupDirection,
                            timerDefaults?.cooldownDuration,
                            timerDefaults?.cooldownDirection
                          )
                        )
                      }}
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
                                ...(isSelected
                                  ? {
                                      borderTopColor: '#6B21A8',
                                      borderRightColor: '#6B21A8',
                                      borderBottomColor: '#6B21A8',
                                    }
                                  : {}),
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
                    <div className="pt-2 border-t border-gray-200 mt-2 space-y-2">
                      <div className="flex justify-end">
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
                                            ...(isSelected
                                              ? {
                                                  borderTopColor: '#6B21A8',
                                                  borderRightColor: '#6B21A8',
                                                  borderBottomColor: '#6B21A8',
                                                }
                                              : {}),
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
                    <div className="pt-2 border-t border-gray-200 mt-2 space-y-2">
                      <div className="flex justify-end">
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
                        const newMode = Number(e.target.value)
                        setCreateMode(newMode)
                        setCreateOptions(
                          getDefaultOptionsForMode(
                            newMode,
                            timerDefaults?.direction,
                            timerDefaults?.restDirection,
                            timerDefaults?.warmupDuration,
                            timerDefaults?.warmupDirection,
                            timerDefaults?.cooldownDuration,
                            timerDefaults?.cooldownDirection
                          )
                        )
                      }}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                    >
                      {PLANNED_WORKOUT_CREATABLE_TIMER_MODES.map((m) => (
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
            </div>
            <form onSubmit={handleSavePlannedEdit} className="p-4 space-y-4">
              <div>
                <label htmlFor="edit-planned-name" className="block text-xs font-medium text-gray-700 mb-1">Name (optional)</label>
                <input
                  id="edit-planned-name"
                  type="text"
                  value={editPlannedName}
                  onChange={(e) => setEditPlannedName(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  placeholder="Workout name"
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
                  disabled={editPlannedBusy}
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

      {editSchedulePlannedWorkout && !expandedPlannedWorkoutId && (
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

/** Returns YYYY-MM-DD in UTC (for consistent date math with addDays / API). */
function toYYYYMMDD(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Returns YYYY-MM-DD in the user's local timezone (for "today" and past/future comparisons). */
function getLocalYYYYMMDD(d: Date): string {
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Returns the Monday of the given week in the user's local timezone (YYYY-MM-DD). */
function getMondayOfWeekLocal(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return getLocalYYYYMMDD(d)
}

function getMondayOfWeek(date: Date): string {
  const d = new Date(date)
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return toYYYYMMDD(d)
}

/** Add days to a YYYY-MM-DD string, interpreting and returning dates in the user's local timezone (so grid dates match "today"). */
function addDays(ymd: string, days: number): string {
  const [y, m, day] = ymd.split('-').map(Number)
  const d = new Date(y, m - 1, day)
  d.setDate(d.getDate() + days)
  return getLocalYYYYMMDD(d)
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

/** Workout types shown when creating a favorite (only these 7). Multi-Segment uses sentinel mode 100. */
const FAVORITE_CREATABLE_TIMER_MODES: { value: number; label: string }[] = [
  { value: 1, label: 'Standard' },
  { value: 2, label: 'Round' },
  { value: 4, label: 'Tabata' },
  { value: 3, label: 'Mixed Intervals' },
  { value: 5, label: 'EMOM' },
  { value: 12, label: 'Sets with Rest' },
  { value: 100, label: 'Multi-Segment' },
]

/** Timer modes for planned workouts: Warmup and Cooldown first; no Lap Timer / Shot Clock; includes Mixed Intervals and Multi-Segment. */
const PLANNED_WORKOUT_CREATABLE_TIMER_MODES: { value: number; label: string }[] = [
  { value: 10, label: 'Warmup' },
  { value: 11, label: 'Cooldown' },
  { value: 1, label: 'Standard' },
  { value: 2, label: 'Round' },
  { value: 3, label: 'Mixed Intervals' },
  { value: 4, label: 'Tabata' },
  { value: 5, label: 'EMOM' },
  { value: 12, label: 'Sets with Rest' },
  { value: 13, label: 'Rest' },
  { value: 100, label: 'Multi-Segment' },
]

/** Default form options per mode so "Add to plan" / create workout use these values.
 * timerDefaultDirection: from user Timer Defaults (true = count up, false = count down). Used for Standard, Round, Warmup, Cooldown, Rest.
 * timerDefaultRestDirection: from user Timer Defaults (1=Match Workout, 2=Up, 3=Down). Used for Round, Tabata, Sets with Rest.
 * warmupDuration/cooldownDuration: seconds from user Timer Defaults; formatted as timeCap for modes 10 and 11. */
function getDefaultOptionsForMode(
  mode: number,
  timerDefaultDirection?: boolean,
  timerDefaultRestDirection?: number,
  warmupDuration?: number,
  warmupDirection?: boolean,
  cooldownDuration?: number,
  cooldownDirection?: boolean
): Record<string, string | number> {
  const dirNum = (d: boolean | number | undefined) => (d === true || d === 1 || d === 2 || d === 3 ? 1 : 0)
  switch (mode) {
    case 1:
      return { timeCap: '10:00', direction: dirNum(timerDefaultDirection) }
    case 2:
      return {
        duration: '1:00',
        rounds: 5,
        restBetween: '0:00',
        direction: dirNum(timerDefaultDirection),
        restDirection:
          timerDefaultRestDirection === 2 || timerDefaultRestDirection === 3
            ? timerDefaultRestDirection
            : 1,
      }
    case 4:
      return {
        workDuration: '0:20',
        restDuration: '0:10',
        roundsPerTabata: 8,
        numberOfTabatas: 1,
        restBetweenTabatas: '0:00',
        direction: dirNum(timerDefaultDirection),
        restDirection:
          timerDefaultRestDirection === 2 || timerDefaultRestDirection === 3
            ? timerDefaultRestDirection
            : 1,
      }
    case 5:
      return {
        intervalSeconds: 60,
        intervals: 10,
        direction: dirNum(timerDefaultDirection),
      }
    case 3:
      return {
        customIntervalsJson: JSON.stringify([{ type: 'duration', duration: '1:00' }]),
        customIntervalNumberOfRounds: 1,
        customIntervalRestBetweenRounds: '0:00',
        direction: dirNum(timerDefaultDirection),
      }
    case 7:
      return { shotClockSeconds: 24 }
    case 10:
      return {
        timeCap:
          warmupDuration != null && warmupDuration > 0
            ? formatDuration(warmupDuration)
            : '10:00',
        direction: dirNum(warmupDirection ?? timerDefaultDirection),
      }
    case 11:
      return {
        timeCap:
          cooldownDuration != null && cooldownDuration > 0
            ? formatDuration(cooldownDuration)
            : '10:00',
        direction: dirNum(cooldownDirection ?? timerDefaultDirection),
      }
    case 13:
      return { timeCap: '5:00', direction: dirNum(timerDefaultDirection) }
    case 12:
      return {
        sets: 5,
        restDrivenType: 0,
        fixedRest: '2:00',
        workRatio: 1,
        restRatio: 1,
        restDirection:
          timerDefaultRestDirection === 2 || timerDefaultRestDirection === 3
            ? timerDefaultRestDirection
            : 1,
      }
    case 100:
      return {}
    default:
      return {}
  }
}

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

/** Returns false if mode is Warmup/Cooldown/Rest and timeCap is 0 or invalid (those modes don't support infinite).
 * For Tabata (4), returns false if workDuration or restDuration is 0 or invalid.
 * For Round (2), returns false if duration (round duration) is 0 or invalid.
 * For EMOM (5), returns false if intervalSeconds or intervals is 0 or invalid.
 * For Sets with Rest (12), returns false if sets <= 0, or (when fixed rest) rest duration <= 0, or (when work:rest ratio) work/rest ratio <= 0. */
function hasValidDurationForMode(
  mode: number,
  options: Record<string, string | number>,
  parseDurationInput: (s: string) => number
): boolean {
  if (mode === 2) {
    const durationSec =
      options.duration != null ? parseDurationInput(String(options.duration)) : 0
    return durationSec > 0
  }
  if (mode === 4) {
    const workSec =
      options.workDuration != null
        ? parseDurationInput(String(options.workDuration))
        : 0
    const restSec =
      options.restDuration != null
        ? parseDurationInput(String(options.restDuration))
        : 0
    return workSec > 0 && restSec > 0
  }
  if (mode === 5) {
    const intervalSeconds = Number(options.intervalSeconds ?? 0)
    const intervals = Number(options.intervals ?? 0)
    return intervalSeconds > 0 && intervals > 0
  }
  if (mode === 3) {
    const rounds = Number(options.customIntervalNumberOfRounds ?? 0)
    if (rounds < 1) return false
    try {
      const raw = options.customIntervalsJson
      const arr = typeof raw === 'string' ? (JSON.parse(raw) as Array<{ type: string; duration?: string; restDuration?: string; repeats?: number }>) : []
      if (arr.length === 0) return false
      for (const it of arr) {
        const t = typeof it.type === 'string' ? it.type : ''
        if (t === 'duration') {
          if (parseDurationInput(String(it.duration ?? '')) <= 0) return false
        } else if (t === 'rest') {
          if (parseDurationInput(String(it.restDuration ?? '')) <= 0) return false
        } else if (t === 'durationRepeated') {
          if (parseDurationInput(String(it.duration ?? '')) <= 0) return false
          if (typeof it.repeats !== 'number' || it.repeats < 1) return false
        } else if (t === 'durationRestRepeated') {
          if (parseDurationInput(String(it.duration ?? '')) <= 0) return false
          if (parseDurationInput(String(it.restDuration ?? '')) <= 0) return false
          if (typeof it.repeats !== 'number' || it.repeats < 1) return false
        }
      }
      return true
    } catch {
      return false
    }
  }
  if (mode === 12) {
    const sets = Number(options.sets ?? 0)
    if (sets <= 0) return false
    const restDrivenType = Number(options.restDrivenType ?? 0)
    if (restDrivenType === 0) {
      const fixedRestSec =
        options.fixedRest != null
          ? parseDurationInput(String(options.fixedRest))
          : 0
      return fixedRestSec > 0
    }
    const workRatio = Number(options.workRatio ?? 0)
    const restRatio = Number(options.restRatio ?? 0)
    return workRatio > 0 && restRatio > 0
  }
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
      case 3: {
        const types = Array.isArray(schedule.customIntervalTypes)
          ? (schedule.customIntervalTypes as string[])
          : []
        const durations = Array.isArray(schedule.customIntervalDurations)
          ? (schedule.customIntervalDurations as number[])
          : []
        const restDurations = Array.isArray(schedule.customIntervalRestDurations)
          ? (schedule.customIntervalRestDurations as number[])
          : []
        const repeats = Array.isArray(schedule.customIntervalRepeats)
          ? (schedule.customIntervalRepeats as number[])
          : []
        const intervals: Array<{ type: string; duration?: string; restDuration?: string; repeats?: number }> = types.map((type, i) => {
          const item: { type: string; duration?: string; restDuration?: string; repeats?: number } = { type }
          if (type === 'duration' || type === 'durationRepeated' || type === 'durationRestRepeated') {
            item.duration = formatDuration(durations[i] ?? 0)
          }
          if (type === 'rest' || type === 'durationRestRepeated') {
            item.restDuration = formatDuration(restDurations[i] ?? 0)
          }
          if (type === 'durationRepeated' || type === 'durationRestRepeated') {
            item.repeats = repeats[i] ?? 1
          }
          return item
        })
        options.customIntervalsJson = JSON.stringify(intervals)
        options.customIntervalNumberOfRounds = num('customIntervalNumberOfRounds') || 1
        options.customIntervalRestBetweenRounds = formatDuration(num('customIntervalRestBetweenRounds') || dur('customIntervalRestBetweenRounds'))
        break
      }
      case 4:
        options.workDuration = formatDuration(num('tabataWorkDuration') || dur('tabataWorkDuration'))
        options.restDuration = formatDuration(num('tabataRestDuration') || dur('tabataRestDuration'))
        options.roundsPerTabata = num('roundsPerTabata')
        options.numberOfTabatas = num('numberOfTabatas')
        options.restBetweenTabatas = formatDuration(num('restBetweenTabatas') || dur('restBetweenTabatas'))
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
        options.workRatio = Math.max(1, num('restDrivenWorkRatio'))
        options.restRatio = Math.max(1, num('restDrivenRestRatio'))
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
  options: Record<string, string | number>,
  parseDurationInputFn?: (s: string) => number
): Record<string, unknown> {
  const parseDuration = (s: string): number => {
    if (typeof parseDurationInputFn === 'function') return parseDurationInputFn(s)
    const t = String(s).trim()
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
      return (Number.isNaN(h) ? 0 : h * 3600) + (Number.isNaN(m) ? 0 : m * 60) + (Number.isNaN(sec) ? 0 : sec)
    }
    return 0
  }
  const schedule: Record<string, unknown> = { timerMode: mode }
  const dir =
    Number(options.direction) !== 0 || options.direction === 'true'
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
    if (typeof v === 'string') return parseDuration(v)
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
    case 3: {
      const types: string[] = []
      const durations: number[] = []
      const restDurations: number[] = []
      const repeats: number[] = []
      try {
        const raw = options.customIntervalsJson
        const arr = typeof raw === 'string' ? (JSON.parse(raw) as Array<{ type: string; duration?: string; restDuration?: string; repeats?: number }>) : []
        for (const it of arr) {
          const t = typeof it.type === 'string' ? it.type : 'duration'
          types.push(t)
          if (t === 'duration' || t === 'durationRepeated' || t === 'durationRestRepeated') {
            durations.push(it.duration != null ? parseDuration(String(it.duration)) : 0)
          } else {
            durations.push(0)
          }
          if (t === 'rest' || t === 'durationRestRepeated') {
            restDurations.push(it.restDuration != null ? parseDuration(String(it.restDuration)) : 0)
          } else {
            restDurations.push(0)
          }
          if (t === 'durationRepeated' || t === 'durationRestRepeated') {
            repeats.push(typeof it.repeats === 'number' && it.repeats > 0 ? it.repeats : 1)
          } else {
            repeats.push(0)
          }
        }
      } catch {
        // leave arrays empty
      }
      schedule.customIntervalTypes = types
      schedule.customIntervalDurations = durations
      schedule.customIntervalRestDurations = restDurations
      schedule.customIntervalRepeats = repeats
      schedule.customIntervalNumberOfRounds = Math.max(1, num('customIntervalNumberOfRounds'))
      schedule.customIntervalRestBetweenRounds = dur('customIntervalRestBetweenRounds')
      break
    }
    case 4:
      schedule.tabataWorkDuration = dur('workDuration')
      schedule.tabataRestDuration = dur('restDuration')
      schedule.roundsPerTabata = num('roundsPerTabata')
      schedule.numberOfTabatas = num('numberOfTabatas')
      schedule.restBetweenTabatas = dur('restBetweenTabatas')
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
        schedule.restDrivenWorkRatio = 1
        schedule.restDrivenRestRatio = 1
      } else {
        schedule.restDrivenWorkRatio = Math.max(1, num('workRatio'))
        schedule.restDrivenRestRatio = Math.max(1, num('restRatio'))
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
  horizontalLayout = false,
  /** When 1, show only intervals list. When 2, show only rounds/rest/direction. Used by CreateWorkoutDialog for Mixed Intervals. */
  mixedIntervalsStep,
}: {
  mode: number
  options: Record<string, string | number>
  onChange: (o: Record<string, string | number>) => void
  parseDurationInput: (s: string) => number
  /** When true, show up to 4 values per row (e.g. on favorites schedule edit). */
  horizontalLayout?: boolean
  mixedIntervalsStep?: 1 | 2
}) {
  const layoutClass = horizontalLayout
    ? 'grid grid-cols-2 lg:grid-cols-4 gap-3'
    : 'space-y-3'
  const setOpt = (key: string, value: string | number) =>
    onChange({ ...options, [key]: value })
  const getOpt = (key: string, def: string | number) =>
    options[key] ?? def
  const modeNum = Number(mode)
  const isMixedIntervals = modeNum === 3 || mode === 3 || String(mode).trim() === '3'
  const restBetweenRepetitionsLabel = horizontalLayout ? 'Rest b/w repetitions' : 'Rest between repetitions'
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
    min = 0,
    max?: number
  ) => (
    <div key={key}>
      <label className="block text-xs font-medium text-gray-700">
        {label}
      </label>
      <input
        type="number"
        min={min}
        max={max}
        value={Number(getOpt(key, def))}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          const val = Number.isNaN(n) ? def : n
          const clamped = Math.min(max ?? 999999, Math.max(min, val))
          setOpt(key, clamped)
        }}
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
        value={Number(getOpt('direction', 0)) ? 'up' : 'down'}
        onChange={(e) => setOpt('direction', e.target.value === 'up' ? 1 : 0)}
        className="mt-1 block w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
      >
        <option value="up">Count up</option>
        <option value="down">Count down</option>
      </select>
    </div>
  )
  /** Rest direction from user Timer Defaults: 1=Match Workout, 2=Up, 3=Down. Only these three options. */
  const restDirectionSelect = () => (
    <div key="restDirection">
      <label className="block text-xs font-medium text-gray-700">
        Rest direction
      </label>
      <select
        value={String(Number(getOpt('restDirection', 1)))}
        onChange={(e) => setOpt('restDirection', parseInt(e.target.value, 10) || 1)}
        className="mt-1 block w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
      >
        <option value="1">Match Workout</option>
        <option value="2">Always Up</option>
        <option value="3">Always Down</option>
      </select>
    </div>
  )

  switch (modeNum) {
    case 3: {
      type CustomIntervalItem = { type: string; duration?: string; restDuration?: string; repeats?: number }
      let intervals: CustomIntervalItem[] = []
      try {
        const raw = getOpt('customIntervalsJson', '[]')
        intervals = typeof raw === 'string' ? (JSON.parse(raw) as CustomIntervalItem[]) : []
        if (!Array.isArray(intervals)) intervals = []
      } catch {
        intervals = []
      }
      const setIntervals = (next: CustomIntervalItem[]) => {
        onChange({ ...options, customIntervalsJson: JSON.stringify(next) })
      }
      const addInterval = (type: 'duration' | 'rest' | 'durationRepeated' | 'durationRestRepeated') => {
        if (type === 'duration') setIntervals([...intervals, { type: 'duration', duration: '1:00' }])
        else if (type === 'rest') setIntervals([...intervals, { type: 'rest', restDuration: '0:30' }])
        else if (type === 'durationRepeated') setIntervals([...intervals, { type: 'durationRepeated', duration: '1:00', repeats: 3 }])
        else setIntervals([...intervals, { type: 'durationRestRepeated', duration: '0:45', restDuration: '0:15', repeats: 4 }])
      }
      const updateInterval = (index: number, updates: Partial<CustomIntervalItem>) => {
        const next = intervals.map((it, i) => (i === index ? { ...it, ...updates } : it))
        setIntervals(next)
      }
      const removeInterval = (index: number) => setIntervals(intervals.filter((_, i) => i !== index))
      const moveInterval = (index: number, dir: 'up' | 'down') => {
        const target = dir === 'up' ? index - 1 : index + 1
        if (target < 0 || target >= intervals.length) return
        const next = [...intervals]
        ;[next[index], next[target]] = [next[target], next[index]]
        setIntervals(next)
      }
      const typeLabels: Record<string, string> = {
        duration: 'Work Interval',
        rest: 'Rest Interval',
        durationRepeated: 'Work Block',
        durationRestRepeated: 'Work/Rest Block',
      }
      if (mixedIntervalsStep === 2) {
        return (
          <div className={layoutClass}>
            {numberInput('customIntervalNumberOfRounds', 'Repetitions', 1, 1)}
            {Number(getOpt('customIntervalNumberOfRounds', 1)) > 1 &&
              durationInput('customIntervalRestBetweenRounds', restBetweenRepetitionsLabel, '0:00')}
            {directionSelect()}
          </div>
        )
      }
      return (
        <div className="space-y-4">
          <div>
            <div className="mb-2">
              <span className="text-xs font-medium text-gray-700">Add</span>
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              <button type="button" onClick={() => addInterval('duration')} className="rounded border border-gray-300 px-2 py-1 text-xs bg-white hover:bg-gray-50">Work Interval</button>
              <button type="button" onClick={() => addInterval('rest')} className="rounded border border-gray-300 px-2 py-1 text-xs bg-white hover:bg-gray-50">Rest Interval</button>
              <button type="button" onClick={() => addInterval('durationRepeated')} className="rounded border border-gray-300 px-2 py-1 text-xs bg-white hover:bg-gray-50">Work Block</button>
              <button type="button" onClick={() => addInterval('durationRestRepeated')} className="rounded border border-gray-300 px-2 py-1 text-xs bg-white hover:bg-gray-50">Work/Rest Block</button>
            </div>
            <ul className="space-y-2 max-h-[40vh] overflow-y-auto">
              {intervals.map((it, index) => (
                <li key={index} className="rounded border border-gray-200 bg-gray-50/50 p-2 flex flex-wrap items-end gap-2">
                  <span className="text-xs font-medium text-gray-800 min-w-[7rem] shrink-0">{typeLabels[it.type] ?? it.type}</span>
                  {(it.type === 'duration' || it.type === 'durationRepeated' || it.type === 'durationRestRepeated') && (
                    <div>
                      <label className="block text-xs text-gray-500">Work</label>
                      <input
                        type="text"
                        placeholder="0:00"
                        value={it.duration ?? ''}
                        onChange={(e) => updateInterval(index, { duration: e.target.value })}
                        className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                    </div>
                  )}
                  {(it.type === 'rest' || it.type === 'durationRestRepeated') && (
                    <div>
                      <label className="block text-xs text-gray-500">Rest</label>
                      <input
                        type="text"
                        placeholder="0:00"
                        value={it.restDuration ?? ''}
                        onChange={(e) => updateInterval(index, { restDuration: e.target.value })}
                        className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                    </div>
                  )}
                  {(it.type === 'durationRepeated' || it.type === 'durationRestRepeated') && (
                    <div>
                      <label className="block text-xs text-gray-500">Repeats</label>
                      <input
                        type="number"
                        min={1}
                        value={it.repeats ?? 1}
                        onChange={(e) => updateInterval(index, { repeats: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                        className="w-14 rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                    </div>
                  )}
                  <div className="flex gap-0.5 ml-auto">
                    <button type="button" onClick={() => moveInterval(index, 'up')} disabled={index === 0} className="h-7 w-7 inline-flex items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40" aria-label="Move up">↑</button>
                    <button type="button" onClick={() => moveInterval(index, 'down')} disabled={index === intervals.length - 1} className="h-7 w-7 inline-flex items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40" aria-label="Move down">↓</button>
                    <button
                      type="button"
                      onClick={() => removeInterval(index)}
                      className="h-7 w-7 inline-flex items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                      aria-label="Remove"
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {intervals.length === 0 && (
              <p className="text-xs text-gray-500">Add at least one interval above.</p>
            )}
          </div>
          {mixedIntervalsStep === undefined && (
            <div className={layoutClass}>
              {numberInput('customIntervalNumberOfRounds', 'Repetitions', 1, 1)}
              {Number(getOpt('customIntervalNumberOfRounds', 1)) > 1 &&
                durationInput('customIntervalRestBetweenRounds', restBetweenRepetitionsLabel, '0:00')}
              {directionSelect()}
            </div>
          )}
        </div>
      )
    }
    case 1:
      return (
        <div className={layoutClass}>
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
        <div className={layoutClass}>
          {durationInput('duration', 'Round duration', '1:00')}
          {numberInput(
            'rounds',
            horizontalLayout ? 'Number of rounds' : 'Number of rounds (0 = infinite)',
            5
          )}
          {durationInput(
            'restBetween',
            'Rest between rounds',
            '0:00'
          )}
          {directionSelect()}
          {restDirectionSelect()}
        </div>
      )
    case 4:
      return (
        <div className={layoutClass}>
          {durationInput('workDuration', 'Work duration', '0:20')}
          {durationInput('restDuration', 'Rest duration', '0:10')}
          {numberInput(
            'roundsPerTabata',
            'Rounds per tabata',
            8,
            1,
            99
          )}
          {numberInput(
            'numberOfTabatas',
            'Number of tabatas',
            1,
            1,
            99
          )}
          {Number(getOpt('numberOfTabatas', 1)) > 1 &&
            durationInput(
              'restBetweenTabatas',
              'Rest between tabatas',
              '0:00'
            )}
          {directionSelect()}
          {restDirectionSelect()}
        </div>
      )
    case 5:
      return (
        <div className={layoutClass}>
          {numberInput(
            'intervalSeconds',
            'Interval (seconds)',
            60,
            1
          )}
          {numberInput('intervals', 'Number of intervals', 10, 1)}
          {directionSelect()}
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
        <div className={layoutClass}>
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
        <div className={layoutClass}>
          {durationInput(
            'timeCap',
            mode === 13
              ? 'Rest duration (min 0:01)'
              : mode === 10
                ? 'Warmup duration'
                : 'Cooldown duration',
            '5:00'
          )}
          {directionSelect()}
        </div>
      )
    case 12:
      return (
        <div className={layoutClass}>
          {numberInput('sets', 'Number of sets', 5, 1)}
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
            durationInput('fixedRest', 'Rest duration', '2:00')
          ) : (
            <>
              {numberInput('workRatio', 'Work ratio', 1, 1)}
              {numberInput('restRatio', 'Rest ratio', 1, 1)}
            </>
          )}
          {restDirectionSelect()}
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

