/* Main user app: Firebase Auth gating + favorites / collections / plans UI */
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
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
} from '@/types/user'
import {
  getWorkoutDisplayDescription,
  getWorkoutDisplayName,
} from '@/lib/json-workout-format'

type TabId = 'favorites' | 'collections' | 'plans'

interface OverviewData {
  workouts: Workout[]
  workoutPlans: WorkoutPlan[]
  workoutCollections: WorkoutCollection[]
}

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewError, setOverviewError] = useState<string | null>(null)

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
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading…</p>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <SignInScreen authError={authError} />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col">
      <AppHeader user={user} />
      <section className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        <UserAppLayout
          user={user}
          overview={overview}
          overviewLoading={overviewLoading}
          overviewError={overviewError}
          reloadOverview={() => loadOverview(user)}
        />
      </section>
      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-3 text-xs text-gray-500 flex items-center justify-between">
          <span>FlexTimer user app</span>
          <Link
            href="/admin"
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            Admin console
          </Link>
        </div>
      </footer>
    </main>
  )
}

function AppHeader({ user }: { user: User }) {
  async function handleSignOut() {
    await signOut(auth)
  }

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-semibold">
            FT
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-gray-900">
              FlexTimer
            </span>
            <span className="text-xs text-gray-500">
              Workouts, collections & plans
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs text-gray-600">
            {user.email ?? user.displayName ?? 'Signed in'}
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
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
    <div className="w-full max-w-md rounded-xl bg-white shadow-sm border border-gray-200 p-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-gray-900">
          Sign in to FlexTimer
        </h1>
        <p className="text-xs text-gray-500">
          Use your existing FlexTimer account credentials. All sign-ins use
          Firebase Auth.
        </p>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => handleProviderSignIn('google')}
          className="w-full inline-flex items-center justify-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <span>Continue with Google</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => handleProviderSignIn('facebook')}
          className="w-full inline-flex items-center justify-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <span>Continue with Facebook</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => handleProviderSignIn('apple')}
          className="w-full inline-flex items-center justify-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <span>Continue with Apple</span>
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
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        {error && (
          <p className="text-xs text-red-600 whitespace-pre-line">{error}</p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
}: {
  user: User
  overview: OverviewData | null
  overviewLoading: boolean
  overviewError: string | null
  reloadOverview: () => void
}) {
  const [activeTab, setActiveTab] = useState<TabId>('favorites')
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [collectionDetail, setCollectionDetail] = useState<{
    collection: WorkoutCollection
    workouts: Workout[]
  } | null>(null)
  const [collectionLoading, setCollectionLoading] = useState(false)
  const [collectionError, setCollectionError] = useState<string | null>(null)

  const [plannedWorkouts, setPlannedWorkouts] = useState<PlannedWorkout[]>([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [plansError, setPlansError] = useState<string | null>(null)
  const [weekStart, setWeekStart] = useState<string>(() => getMondayOfWeek(new Date()))

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

  async function openCollectionDetail(collectionId: string) {
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
      await openCollectionDetail(collectionId)
      await reloadOverview()
    } catch (e) {
      console.error('[collection reorder]', e)
    }
  }

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart])

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
    const weekDays = DAY_NAMES.map((_, i) => addDays(weekStart, i))
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
  }, [plannedWorkouts, weekStart])

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

  const selectedPlan =
    sortedPlans.find((p) => p.id === selectedPlanId) ?? sortedPlans[0] ?? null

  useEffect(() => {
    if (selectedPlan && !selectedPlanId) {
      setSelectedPlanId(selectedPlan.id)
      loadPlannedWorkoutsForPlan(selectedPlan.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlan?.id])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Your workouts
          </h2>
          <p className="text-xs text-gray-500">
            Favorites, collections, and plans from your FlexTimer account.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
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
              onReorder={handleReorderFavorites}
            />
          )}
          {activeTab === 'collections' && (
            <CollectionsSection
              collections={collectionsExcludingFavorites}
              collectionDetail={collectionDetail}
              collectionLoading={collectionLoading}
              collectionError={collectionError}
              openCollectionDetail={openCollectionDetail}
              onReorderWorkout={handleReorderCollectionWorkout}
            />
          )}
          {activeTab === 'plans' && (
            <PlansSection
              plans={sortedPlans}
              selectedPlanId={selectedPlanId}
              setSelectedPlanId={(id) => {
                setSelectedPlanId(id)
                loadPlannedWorkoutsForPlan(id)
              }}
              weekStart={weekStart}
              setWeekStart={setWeekStart}
              weekEnd={weekEnd}
              byDay={byDay}
              plansLoading={plansLoading}
              plansError={plansError}
              onReorderPlanned={handleReorderPlannedWithinDay}
              onDeletePlanned={handleDeletePlanned}
              user={user}
              reloadPlanned={() => {
                if (selectedPlanId) loadPlannedWorkoutsForPlan(selectedPlanId)
              }}
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
          ? 'bg-gray-900 text-white shadow-sm'
          : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  )
}

function FavoritesSection({
  favoritesCollection,
  favoriteWorkouts,
  onReorder,
}: {
  favoritesCollection: WorkoutCollection | undefined
  favoriteWorkouts: Workout[]
  onReorder: (index: number, direction: 'up' | 'down') => void
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">
          Favorites
          {favoritesCollection
            ? ` (${favoriteWorkouts.length})`
            : ''}
        </h3>
      </div>
      {!favoritesCollection ? (
        <p className="px-4 py-6 text-sm text-gray-500">
          No favorites collection found. Mark workouts as favorites in the
          FlexTimer app and they will appear here.
        </p>
      ) : favoriteWorkouts.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500">
          No workouts in favorites yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Name
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                  Description
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">
                  Order
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {favoriteWorkouts.map((w, index) => (
                <tr key={w.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {getWorkoutDisplayName(w) || w.workoutId}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {getWorkoutDisplayDescription(w) || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onReorder(index, 'up')}
                        className="h-7 w-7 inline-flex items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                        aria-label="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => onReorder(index, 'down')}
                        className="h-7 w-7 inline-flex items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                        aria-label="Move down"
                      >
                        ↓
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CollectionsSection({
  collections,
  collectionDetail,
  collectionLoading,
  collectionError,
  openCollectionDetail,
  onReorderWorkout,
}: {
  collections: WorkoutCollection[]
  collectionDetail: { collection: WorkoutCollection; workouts: Workout[] } | null
  collectionLoading: boolean
  collectionError: string | null
  openCollectionDetail: (collectionId: string) => void
  onReorderWorkout: (
    collectionId: string,
    index: number,
    direction: 'up' | 'down'
  ) => void
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)]">
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h3 className="text-sm font-medium text-gray-700">
            Collections ({collections.length})
          </h3>
        </div>
        {collections.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">
            You do not have any collections yet.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {collections.map((c) => (
              <li key={c.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {c.workoutCollectionName}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {c.workoutIds.length} workouts
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openCollectionDetail(c.id)}
                  className="rounded border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Manage
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h3 className="text-sm font-medium text-gray-700">
            Collection workouts
          </h3>
        </div>
        {collectionLoading && (
          <p className="px-4 py-6 text-sm text-gray-500">Loading collection…</p>
        )}
        {collectionError && (
          <div className="px-4 py-2 text-xs text-red-700 bg-red-50">
            {collectionError}
          </div>
        )}
        {!collectionLoading && !collectionDetail && !collectionError && (
          <p className="px-4 py-6 text-sm text-gray-500">
            Select a collection to see its workouts.
          </p>
        )}
        {collectionDetail && (
          <div className="space-y-3 px-4 py-4">
            <div>
              <p className="text-sm font-medium text-gray-900">
                {collectionDetail.collection.workoutCollectionName}
              </p>
              <p className="text-xs text-gray-500">
                {collectionDetail.collection.workoutCollectionDescription ||
                  'No description'}
              </p>
            </div>
            {collectionDetail.workouts.length === 0 ? (
              <p className="text-sm text-gray-500">
                This collection has no workouts yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                        Name
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                        Description
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">
                        Order
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {collectionDetail.workouts.map((w, index) => (
                      <tr key={w.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-sm font-medium text-gray-900">
                          {getWorkoutDisplayName(w) || w.workoutId}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-600">
                          {getWorkoutDisplayDescription(w) || '—'}
                        </td>
                        <td className="px-3 py-2 text-sm text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                onReorderWorkout(
                                  collectionDetail.collection.id,
                                  index,
                                  'up'
                                )
                              }
                              className="h-7 w-7 inline-flex items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
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
                              className="h-7 w-7 inline-flex items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                              aria-label="Move down"
                            >
                              ↓
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
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
  plansLoading,
  plansError,
  onReorderPlanned,
  onDeletePlanned,
  user,
  reloadPlanned,
}: {
  plans: WorkoutPlan[]
  selectedPlanId: string | null
  setSelectedPlanId: (id: string) => void
  weekStart: string
  setWeekStart: (value: string) => void
  weekEnd: string
  byDay: Record<string, PlannedWorkout[]>
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
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [createDate, setCreateDate] = useState<string>(() =>
    toYYYYMMDD(new Date())
  )
  const [createMode, setCreateMode] = useState<number>(1)
  const [createOptions, setCreateOptions] = useState<
    Record<string, string | number>
  >({})
  const [createError, setCreateError] = useState<string | null>(null)
  const [createBusy, setCreateBusy] = useState(false)

  const selectedPlan =
    plans.find((p) => p.id === selectedPlanId) ?? plans[0] ?? null

  async function authedFetch(input: string, init?: RequestInit) {
    const token = await user.getIdToken()
    const headers: HeadersInit = {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    }
    return fetch(input, { ...init, headers })
  }

  async function handleCreatePlanned() {
    if (!selectedPlan) return
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
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h3 className="text-sm font-medium text-gray-700">
              Plans ({plans.length})
            </h3>
          </div>
          {plans.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500">
              You do not have any plans yet.
            </p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {plans.map((p) => (
                <li
                  key={p.id}
                  className={`px-4 py-3 flex items-center justify-between gap-3 cursor-pointer ${
                    selectedPlan && selectedPlan.id === p.id
                      ? 'bg-blue-50'
                      : 'hover:bg-gray-50'
                  }`}
                  onClick={() => setSelectedPlanId(p.id)}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {p.workoutPlanName}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {p.workoutPlanDescription || 'No description'}
                    </p>
                  </div>
                  <span className="text-[11px] rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">
                    {p.isPersonal ? 'Personal' : 'Shared'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-gray-700">
                Weekly plan
              </h3>
              <p className="text-xs text-gray-500">
                Reorder workouts within a day or remove from the plan.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                disabled={!selectedPlan}
                className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Add planned workout
              </button>
              <button
                type="button"
                onClick={() => setWeekStart(addDays(weekStart, -7))}
                className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
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
                onClick={() => setWeekStart(addDays(weekStart, 7))}
                className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
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
          {!plansLoading && !selectedPlan && (
            <p className="px-4 py-6 text-sm text-gray-500">
              Select a plan to view its schedule.
            </p>
          )}
          {selectedPlan && !plansLoading && (
            <div className="grid grid-cols-1 md:grid-cols-7 divide-y md:divide-y-0 md:divide-x divide-gray-200">
              {DAY_NAMES.map((name, i) => {
                const dateKey = addDays(weekStart, i)
                const items = byDay[dateKey] ?? []
                const dayDate = new Date(dateKey + 'T12:00:00')
                return (
                  <div key={dateKey} className="min-h-[140px] flex flex-col">
                    <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-center">
                      <div className="text-[11px] font-medium uppercase text-gray-500">
                        {name}
                      </div>
                      <div className="text-xs font-medium text-gray-900">
                        {dayDate.toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </div>
                    </div>
                    <div className="p-2 flex-1 space-y-2">
                      {items.length === 0 ? (
                        <p className="text-[11px] text-gray-400">
                          No workouts
                        </p>
                      ) : (
                        items.map((pw, index) => {
                          const w = pw.workout
                          return (
                            <div
                              key={pw.id}
                              className="rounded border border-gray-200 bg-white shadow-sm px-2 py-1.5 space-y-0.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-medium text-gray-900 truncate">
                                  {getWorkoutDisplayName(w) || 'Workout'}
                                </p>
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onReorderPlanned(
                                        dateKey,
                                        index,
                                        'up'
                                      )
                                    }
                                    className="h-5 w-5 inline-flex items-center justify-center rounded border border-gray-300 text-[10px] text-gray-600 hover:bg-gray-100"
                                    aria-label="Move up"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onReorderPlanned(
                                        dateKey,
                                        index,
                                        'down'
                                      )
                                    }
                                    className="h-5 w-5 inline-flex items-center justify-center rounded border border-gray-300 text-[10px] text-gray-600 hover:bg-gray-100"
                                    aria-label="Move down"
                                  >
                                    ↓
                                  </button>
                                </div>
                              </div>
                              <p className="text-[11px] text-gray-500 line-clamp-2">
                                {getWorkoutDisplayDescription(w) || '—'}
                              </p>
                              <button
                                type="button"
                                onClick={() => onDeletePlanned(pw)}
                                className="mt-1 text-[11px] text-red-600 hover:text-red-700"
                              >
                                Remove from plan
                              </button>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {createOpen && selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !createBusy && setCreateOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gray-200 bg-white shadow-lg">
            <div className="border-b border-gray-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">
                Add planned workout
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Choose a day and timer mode for this workout.
              </p>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label
                  htmlFor="plan-day"
                  className="block text-xs font-medium text-gray-700 mb-1"
                >
                  Day
                </label>
                <input
                  id="plan-day"
                  type="date"
                  value={createDate}
                  onChange={(e) =>
                    setCreateDate(e.target.value.slice(0, 10))
                  }
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
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
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                  onClick={() => setCreateOpen(false)}
                  disabled={createBusy}
                  className="rounded bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreatePlanned}
                  disabled={createBusy}
                  className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {createBusy ? 'Adding…' : 'Add to plan'}
                </button>
              </div>
            </div>
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
        className="mt-1 block w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
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
        className="mt-1 block w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
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
        className="mt-1 block w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
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
              ? 'Rest duration'
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
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
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

