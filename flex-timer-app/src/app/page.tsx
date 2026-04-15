/* Main user app: Firebase Auth gating + favorites / collections / plans UI */
'use client'

import {
  useEffect,
  useMemo,
  useState,
  Fragment,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useRef,
} from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import toast from 'react-hot-toast'
import {
  ArchiveRestore,
  Bookmark,
  CalendarCheck2,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronUp,
  Star,
  LayoutGrid,
  Library,
  Link2,
  Newspaper,
  Settings,
  Share2,
  Users,
} from 'lucide-react'
import headerIcon from './icon.png'
import { PlanKindIcon, planVisualKindFromPlan } from '@/components/PlanKindIcon'
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
import {
  PENDING_INVITES_NAV_CHANGED_EVENT,
  usePendingInvitationsNavBadges,
} from '@/hooks/usePendingInvitationsNavBadges'
import { useHubJoinRequestNavBadges } from '@/hooks/useHubJoinRequestNavBadges'
import { NavCountBadge } from '@/components/NavCountBadge'
import { workoutToPlanDayEntry } from '@/lib/workout-to-plan-day-entry'
import { ConnectFeedSection } from '@/components/ConnectFeedSection'
import { ConnectSharedContentSection } from '@/components/ConnectSharedContentSection'
import { LibraryBookmarksSection } from '@/components/LibraryBookmarksSection'
import { ConnectionsSection } from '@/components/ConnectionsSection'
import { MembershipsSection } from '@/components/MembershipsSection'
import { MyHubsSection } from '@/components/MyHubsSection'
import { PlanningTodaySection, type PlanAheadLookTarget } from '@/components/PlanningTodaySection'
import { PlanShareDialogs } from '@/components/PlanShareDialogs'
import { ContentShareDialogs } from '@/components/ContentShareDialogs'
import { RecoverDeletedItemsSection } from '@/components/RecoverDeletedItemsSection'
import { UserSettingsScreen } from '@/components/UserSettingsScreen'
import { GroupPublicProfileDialog } from '@/components/GroupPublicProfileDialog'
import { PublicUserProfileDialog } from '@/components/PublicUserProfileDialog'
import type {
  Workout,
  WorkoutCollection,
  WorkoutPlan,
  PlannedWorkout,
  WorkoutSegment,
} from '@/types/user'
import type { PublicUserProfileView } from '@/types/public-profile'
import { UNLIMITED } from '@/lib/subscription-limits-constants'
import type { SubscriptionLimits, SubscriptionTier } from '@/lib/subscription-limits-constants'
import {
  EMPTY_USER_HUB_LOOKUP_IDS,
  HUB_LOOKUP_ROWS,
  resolveHubLookupLabels,
  type UserHubLookupIds,
  type UserHubLookupLabels,
} from '@/types/hub-profile'
import {
  getWorkoutDisplayDescription,
  getWorkoutDetailDescription,
  getWorkoutDisplayName,
  getScheduleDisplayDescription,
  getSegmentDisplayName,
  getTimerModeColor,
  getWorkoutBarColor,
  timerModeToDisplayString,
  getCollectionDisplayDescription,
} from '@/lib/json-workout-format'
import { formatSharedOnLine } from '@/lib/format-shared-at'

type MainNavId = 'home' | 'library' | 'planning' | 'connect' | 'connections' | 'settings' | 'support'
type LibrarySubTabId = 'favorites' | 'collections' | 'bookmarks'
type ConnectSubTabId = 'feed' | 'shared-content' | 'hubs'
type PlanningSubTabId = 'today' | 'plans' | 'plan-ahead'

/** Row from GET /api/app/following-plans (`users/{uid}/workoutPlanSubscriptions`, status active). */
type FollowingPlanRow = {
  subscriptionDocumentId: string
  subscriberUserId: string
  ownerUserId: string
  remotePlanId: string
  status: string
  remotePlanName: string | null
  remotePlanHandle: string | null
  /** Coach plan description (live or subscription snapshot). */
  remotePlanDescription?: string | null
  ordinal: number
  subscriberFullName: string | null
  subscriberHandle: string | null
  /** Resolved for UI: owner allowed editing on the connection share (otherwise read-only). */
  shareAllowEditing: boolean
  /** Resolved for UI: future scheduled workouts hidden from this follow / share. */
  shareHideFutureWorkouts: boolean
  /** From live coach plan (GET /api/app/following-plans); drives subscription “Your access” copy. */
  remotePlanIsPersonal?: boolean
  /** 0 = private training, 1 = group training; omitted when personal or plan unavailable. */
  remotePlanTrainingIntent?: 0 | 1
}

function normalizeFollowingPlanRows(raw: FollowingPlanRow[] | undefined): FollowingPlanRow[] {
  return (raw ?? []).map((r) => ({
    ...r,
    shareAllowEditing: Boolean(r.shareAllowEditing),
    shareHideFutureWorkouts: r.shareHideFutureWorkouts !== false,
  }))
}
type ConnectionsSubTabId = 'connections' | 'memberships'

type LibraryShareTarget = { kind: 'workout' | 'collection'; id: string; title: string }

interface OverviewData {
  workouts: Workout[]
  workoutPlans: WorkoutPlan[]
  workoutCollections: WorkoutCollection[]
  handle?: string | null
  handleKey?: string | null
  bio?: string | null
  firstName?: string | null
  lastName?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
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
  hubLookupIds: UserHubLookupIds
  hubLookupLabels: UserHubLookupLabels
}

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewError, setOverviewError] = useState<string | null>(null)

  const [mainNav, setMainNav] = useState<MainNavId>('home')
  const [connectionsTab, setConnectionsTab] = useState<ConnectionsSubTabId>('connections')
  const [libraryTab, setLibraryTab] = useState<LibrarySubTabId>('favorites')
  const [connectTab, setConnectTab] = useState<ConnectSubTabId>('feed')
  const [planningTab, setPlanningTab] = useState<PlanningSubTabId>('plan-ahead')
  /** Plan Ahead schedule columns; forced to Full View when opening Plan Ahead from Today’s Plan. */
  const [planAheadColumnCount, setPlanAheadColumnCount] = useState<1 | 2>(2)

  const { connectionInvites, membershipInvites, refreshPendingInvitations } =
    usePendingInvitationsNavBadges(user)
  const { pendingHubJoinRequests, refreshHubJoinRequestBadges } = useHubJoinRequestNavBadges(user)

  const resetToDefaultRef = useRef<(() => void) | null>(null)
  const openHandleEditorRef = useRef<(() => void) | null>(null)
  const openUserProfileEditorRef = useRef<(() => void) | null>(null)
  const registerOpenHandleEditor = useCallback((fn: () => void) => {
    openHandleEditorRef.current = fn
  }, [])
  const registerOpenUserProfileEditor = useCallback((fn: () => void) => {
    openUserProfileEditorRef.current = fn
  }, [])
  const openHandleEditor = useCallback(() => {
    openHandleEditorRef.current?.()
  }, [])
  const openUserProfileEditor = useCallback(() => {
    openUserProfileEditorRef.current?.()
  }, [])

  useEffect(() => {
    // Fail-safe: if Firebase auth init hangs (rare), don't trap the UI on Loading forever.
    const authInitTimeout = window.setTimeout(() => {
      setAuthLoading(false)
      setAuthError((prev) => prev ?? 'Authentication is taking too long. Please reload.')
    }, 15000)
    const unsubscribe = onAuthStateChanged(
      auth,
      (current) => {
        window.clearTimeout(authInitTimeout)
        setUser(current)
        setAuthLoading(false)
        setAuthError(null)
        if (!current) {
          setOverview(null)
        }
      },
      (error) => {
        window.clearTimeout(authInitTimeout)
        console.error('[auth]', error)
        setAuthError(error.message ?? 'Failed to initialize authentication')
        setAuthLoading(false)
      }
    )
    return () => {
      window.clearTimeout(authInitTimeout)
      unsubscribe()
    }
  }, [])

  async function loadOverview(currentUser: User | null) {
    if (!currentUser) return
    setOverviewLoading(true)
    setOverviewError(null)
    try {
      const token = await currentUser.getIdToken()
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), 20000)
      const res = await fetch('/api/app/overview', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      })
      window.clearTimeout(timeoutId)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const raw = (await res.json()) as OverviewData & {
        hubLookupIds?: UserHubLookupIds
        hubLookupLabels?: UserHubLookupLabels
      }
      const hubLookupIds = raw.hubLookupIds ?? EMPTY_USER_HUB_LOOKUP_IDS
      setOverview({
        ...raw,
        hubLookupIds,
        hubLookupLabels: raw.hubLookupLabels ?? resolveHubLookupLabels(hubLookupIds),
      })
    } catch (e) {
      console.error('[overview]', e)
      setOverview(null)
      setOverviewError(
        e instanceof DOMException && e.name === 'AbortError'
          ? 'Loading your data timed out. Please reload.'
          : e instanceof Error
            ? e.message
            : 'Failed to load your data'
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

  useEffect(() => {
    if (mainNav === 'connections') {
      void refreshPendingInvitations()
    }
  }, [mainNav, connectionsTab, refreshPendingInvitations])

  useEffect(() => {
    if (mainNav === 'connect') {
      void refreshHubJoinRequestBadges()
    }
  }, [mainNav, refreshHubJoinRequestBadges])

  useEffect(() => {
    const handler = () => {
      void refreshPendingInvitations()
    }
    window.addEventListener(PENDING_INVITES_NAV_CHANGED_EVENT, handler)
    return () => window.removeEventListener(PENDING_INVITES_NAV_CHANGED_EVENT, handler)
  }, [refreshPendingInvitations])

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
    <main className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-neutral-100">
      <AppHeader
        user={user}
        handle={overview?.handle}
        handleKey={overview?.handleKey}
        bio={overview?.bio}
        firstName={overview?.firstName}
        lastName={overview?.lastName}
        hubLookupIds={overview?.hubLookupIds}
        hubLookupLabels={overview?.hubLookupLabels}
        subscriptionTier={overview?.subscriptionLimits?.tier ?? 'basic'}
        onLogoClick={() => {
          resetToDefaultRef.current?.()
        }}
        onProfileUpdated={(profile) =>
          setOverview((prev) => (prev ? { ...prev, ...profile } : prev))
        }
        registerOpenHandleEditor={registerOpenHandleEditor}
        registerOpenUserProfileEditor={registerOpenUserProfileEditor}
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        <MainNavSidebar
          mainNav={mainNav}
          connectionsTab={connectionsTab}
          libraryTab={libraryTab}
          connectTab={connectTab}
          planningTab={planningTab}
          pendingConnectionInvites={connectionInvites}
          pendingMembershipInvites={membershipInvites}
          pendingHubJoinRequests={pendingHubJoinRequests}
          setMainNav={setMainNav}
          setConnectionsTab={setConnectionsTab}
          setLibraryTab={setLibraryTab}
          setConnectTab={setConnectTab}
          setPlanningTab={setPlanningTab}
          setPlanAheadColumnCount={setPlanAheadColumnCount}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f1f1f1]">
          <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-8 pt-5 lg:px-8 lg:pb-8 lg:pt-6">
            <div className="flex min-h-0 w-full max-w-full flex-1 flex-col">
            <UserAppLayout
              user={user}
              overview={overview}
              overviewLoading={overviewLoading}
              overviewError={overviewError}
              reloadOverview={() => loadOverview(user)}
              mainNav={mainNav}
              setMainNav={setMainNav}
              connectionsTab={connectionsTab}
              setConnectionsTab={setConnectionsTab}
              libraryTab={libraryTab}
              setLibraryTab={setLibraryTab}
              connectTab={connectTab}
              setConnectTab={setConnectTab}
              planningTab={planningTab}
              setPlanningTab={setPlanningTab}
              planAheadColumnCount={planAheadColumnCount}
              setPlanAheadColumnCount={setPlanAheadColumnCount}
              registerResetToDefault={(fn) => {
                resetToDefaultRef.current = fn
              }}
              openHandleEditor={openHandleEditor}
              onProfileUpdated={(profile) =>
                setOverview((prev) => (prev ? { ...prev, ...profile } : prev))
              }
            />
            </div>
          </section>
          <footer className="shrink-0 border-t border-neutral-200 bg-white">
            <div className="flex items-center justify-center px-4 py-3 text-xs text-gray-500 lg:px-8">
              <span>GymNext Flex Timer · © 1804282 Ontario Limited dba GymNext</span>
            </div>
          </footer>
        </div>
      </div>
    </main>
  )
}

function AppHeader({
  user,
  handle,
  handleKey,
  bio,
  firstName,
  lastName,
  hubLookupIds,
  hubLookupLabels,
  subscriptionTier = 'basic',
  onLogoClick,
  onProfileUpdated,
  registerOpenHandleEditor,
  registerOpenUserProfileEditor,
}: {
  user: User
  handle?: string | null
  handleKey?: string | null
  bio?: string | null
  firstName?: string | null
  lastName?: string | null
  hubLookupIds?: UserHubLookupIds
  hubLookupLabels?: UserHubLookupLabels
  subscriptionTier?: SubscriptionTier
  onLogoClick: () => void
  onProfileUpdated: (profile: {
    handle?: string | null
    handleKey?: string | null
    bio?: string | null
    firstName?: string | null
    lastName?: string | null
    hubLookupIds?: UserHubLookupIds
    hubLookupLabels?: UserHubLookupLabels
  }) => void
  registerOpenHandleEditor?: (open: () => void) => void
  registerOpenUserProfileEditor?: (open: () => void) => void
}) {
  const [upgradePromptOpen, setUpgradePromptOpen] = useState(false)
  const [userInfoDialogOpen, setUserInfoDialogOpen] = useState(false)
  const [userEditorOpen, setUserEditorOpen] = useState(false)
  const [handleEditorOpen, setHandleEditorOpen] = useState(false)
  const handleWithoutAt = (h: string | null | undefined) => (h ?? '').trim().replace(/^@/, '')
  const [handleDraft, setHandleDraft] = useState(
    handleWithoutAt(handle) || handleKey || ''
  )
  const [handleSaving, setHandleSaving] = useState(false)
  const [bioDraft, setBioDraft] = useState(bio ?? '')
  const [firstNameDraft, setFirstNameDraft] = useState(firstName ?? '')
  const [lastNameDraft, setLastNameDraft] = useState(lastName ?? '')
  const [userProfileSaving, setUserProfileSaving] = useState(false)

  useEffect(() => {
    setBioDraft(bio ?? '')
  }, [bio])
  useEffect(() => {
    setFirstNameDraft(firstName ?? '')
  }, [firstName])
  useEffect(() => {
    setLastNameDraft(lastName ?? '')
  }, [lastName])
  useEffect(() => {
    setHandleDraft(handleWithoutAt(handle) || handleKey || '')
  }, [handle, handleKey])

  useEffect(() => {
    if (!registerOpenHandleEditor) return
    registerOpenHandleEditor(() => {
      setUserInfoDialogOpen(false)
      setHandleEditorOpen(true)
    })
    return () => registerOpenHandleEditor(() => {})
  }, [registerOpenHandleEditor])

  useEffect(() => {
    if (!registerOpenUserProfileEditor) return
    registerOpenUserProfileEditor(() => {
      setUserInfoDialogOpen(false)
      setUserEditorOpen(true)
    })
    return () => registerOpenUserProfileEditor(() => {})
  }, [registerOpenUserProfileEditor])

  async function handleSignOut() {
    await signOut(auth)
  }

  const tierLabel =
    subscriptionTier === 'pro'
      ? 'Pro Tier'
      : subscriptionTier === 'classic'
        ? 'Classic Tier'
        : 'Basic Tier'
  const isPro = subscriptionTier === 'pro'
  const firestoreFullName = [firstName?.trim(), lastName?.trim()].filter(Boolean).join(' ')
  const preferredUserName =
    firestoreFullName || user.displayName?.trim() || user.email?.trim() || 'Signed in'
  const headerAtHandle = handleWithoutAt(handle) || handleKey?.trim() || ''
  const headerUserLabel = headerAtHandle
    ? `${preferredUserName} (@${headerAtHandle})`
    : preferredUserName

  async function handleSaveUserProfile() {
    if (userProfileSaving) return
    setUserProfileSaving(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bio: bioDraft,
          firstName: firstNameDraft,
          lastName: lastNameDraft,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as {
        handle?: string | null
        handleKey?: string | null
        bio?: string | null
        firstName?: string | null
        lastName?: string | null
        hubLookupIds?: UserHubLookupIds
        hubLookupLabels?: UserHubLookupLabels
      }
      onProfileUpdated({
        handle: data.handle ?? handle ?? null,
        handleKey: data.handleKey ?? handleKey ?? null,
        bio: data.bio ?? null,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        hubLookupIds: data.hubLookupIds,
        hubLookupLabels: data.hubLookupLabels,
      })
      setUserEditorOpen(false)
      toast.success('Profile saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setUserProfileSaving(false)
    }
  }

  async function handleSaveHandle() {
    if (handleSaving) return
    setHandleSaving(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ handle: handleDraft }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as {
        handle?: string | null
        handleKey?: string | null
        bio?: string | null
        firstName?: string | null
        lastName?: string | null
        hubLookupIds?: UserHubLookupIds
        hubLookupLabels?: UserHubLookupLabels
      }
      onProfileUpdated({
        handle: data.handle ?? null,
        handleKey: data.handleKey ?? null,
        bio: data.bio ?? bio ?? null,
        firstName: data.firstName ?? firstName ?? null,
        lastName: data.lastName ?? lastName ?? null,
        hubLookupIds: data.hubLookupIds,
        hubLookupLabels: data.hubLookupLabels,
      })
      setHandleEditorOpen(false)
      toast.success('Handle saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save handle')
    } finally {
      setHandleSaving(false)
    }
  }

  return (
    <header className="relative z-[102] shrink-0 border-b border-neutral-800 bg-neutral-950 text-white">
      <div className="flex h-14 w-full items-center gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 shrink-0 items-center">
          <button
            type="button"
            onClick={onLogoClick}
            className="flex min-w-0 items-center gap-2 rounded-md hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-white/40"
            aria-label="Go to home"
          >
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white/10">
              <Image
                src={headerIcon}
                alt="Flex Timer"
                width={32}
                height={32}
                className="h-8 w-8 object-contain"
              />
            </span>
            <div className="hidden min-w-0 flex-col items-start sm:flex">
              <span className="truncate text-sm font-semibold text-white">
                GymNext Flex Timer
              </span>
              <span className="max-w-[12rem] truncate text-xs text-neutral-400 sm:max-w-md lg:max-w-xl">
                The world&apos;s most advanced interval timer
              </span>
            </div>
          </button>
        </div>
        <div className="min-w-0 flex-1" aria-hidden="true" />
        <div className="flex shrink-0 items-center justify-end gap-3 sm:gap-4">
          <div className="hidden min-w-0 flex-col items-end text-right sm:flex">
            <button
              type="button"
              onClick={() => setUserInfoDialogOpen(true)}
              className="cursor-pointer text-right text-xs font-medium text-white hover:text-neutral-200 hover:underline"
              title="View account info"
            >
              {headerUserLabel}
            </button>
            {isPro ? (
              <span className="text-xs text-neutral-400">{tierLabel}</span>
            ) : (
              <button
                type="button"
                onClick={() => setUpgradePromptOpen(true)}
                className="cursor-pointer text-xs text-neutral-400 hover:text-white hover:underline"
                title="Upgrade to Pro"
              >
                {tierLabel}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setUserInfoDialogOpen(true)}
            className="sm:hidden rounded-md p-2 text-neutral-200 hover:bg-white/10"
            aria-label="Account info"
          >
            <svg
              className="h-6 w-6"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded border border-neutral-600 bg-transparent px-3 py-1.5 text-xs font-medium text-neutral-100 hover:bg-neutral-800"
          >
            Sign out
          </button>
        </div>
      </div>

      {upgradePromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => setUpgradePromptOpen(false)}
          />
          <div className="relative w-full max-w-sm rounded-lg bg-white shadow-lg p-4 space-y-4">
            <p className="text-sm text-gray-800">
              You can upgrade to Pro in the Flex Timer mobile app.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setUpgradePromptOpen(false)}
                className="rounded bg-gymnext px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {userInfoDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => setUserInfoDialogOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg overflow-hidden">
            <div className="border-b border-gymnext-muted/30 px-4 py-3">
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
                  <div className="h-16 w-16 rounded-full bg-gymnext-muted/30 flex items-center justify-center text-xl font-medium text-gray-600">
                    {(firestoreFullName?.[0] ?? user.displayName?.[0] ?? user.email?.[0] ?? '?').toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {firestoreFullName || user.displayName?.trim() || '—'}
                  </p>
                  {user.email && (
                    <p className="text-xs text-gray-500 truncate">{user.email}</p>
                  )}
                </div>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-gray-500 font-medium">First name</dt>
                <dd className="text-gray-900">{firstName?.trim() || '—'}</dd>
                <dt className="text-gray-500 font-medium">Last name</dt>
                <dd className="text-gray-900">{lastName?.trim() || '—'}</dd>
                {headerAtHandle && (
                  <>
                    <dt className="text-gray-500 font-medium">Handle</dt>
                    <dd className="text-gray-900">@{headerAtHandle}</dd>
                  </>
                )}
                {bio?.trim() && (
                  <>
                    <dt className="text-gray-500 font-medium">Bio</dt>
                    <dd className="min-w-0 max-w-full whitespace-pre-wrap break-words text-gray-900">
                      {bio.trim()}
                    </dd>
                  </>
                )}
                {HUB_LOOKUP_ROWS.map((row) => {
                  const text = hubLookupLabels?.[row.key]
                  if (!text) return null
                  return (
                    <Fragment key={row.key}>
                      <dt className="text-gray-500 font-medium">{row.label}</dt>
                      <dd className="text-gray-900">{text}</dd>
                    </Fragment>
                  )
                })}
                {user.phoneNumber && (
                  <>
                    <dt className="text-gray-500 font-medium">Phone</dt>
                    <dd className="text-gray-900">{user.phoneNumber}</dd>
                  </>
                )}
              </dl>
            </div>
            <div className="px-4 pb-4 space-y-3">
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setUserInfoDialogOpen(false)}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
                >
                  Close
                </button>
              </div>
              <p className="text-[11px] text-gray-500 text-center">
                <span className="font-medium text-gray-600">User ID:</span>{' '}
                <span className="font-mono break-all">{user.uid}</span>
              </p>
            </div>
          </div>
        </div>
      )}
      {userEditorOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => {
              if (userProfileSaving) return
              setBioDraft(bio ?? '')
              setFirstNameDraft(firstName ?? '')
              setLastNameDraft(lastName ?? '')
              setUserEditorOpen(false)
            }}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg overflow-hidden">
            <div className="border-b border-gymnext-muted/30 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-800">Edit user</h2>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="profile-first-name" className="block text-xs font-medium text-gray-700">
                    First name
                  </label>
                  <input
                    id="profile-first-name"
                    type="text"
                    value={firstNameDraft}
                    onChange={(e) => setFirstNameDraft(e.target.value)}
                    autoComplete="given-name"
                    className="mt-1 w-full rounded border border-gymnext-muted/40 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gymnext/40"
                    placeholder="First name"
                  />
                </div>
                <div>
                  <label htmlFor="profile-last-name" className="block text-xs font-medium text-gray-700">
                    Last name
                  </label>
                  <input
                    id="profile-last-name"
                    type="text"
                    value={lastNameDraft}
                    onChange={(e) => setLastNameDraft(e.target.value)}
                    autoComplete="family-name"
                    className="mt-1 w-full rounded border border-gymnext-muted/40 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gymnext/40"
                    placeholder="Last name"
                  />
                </div>
              </div>
              <label htmlFor="profile-bio" className="block text-xs font-medium text-gray-700">
                Bio
              </label>
              <textarea
                id="profile-bio"
                value={bioDraft}
                onChange={(e) => setBioDraft(e.target.value)}
                rows={4}
                className="w-full rounded border border-gymnext-muted/40 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gymnext/40"
                placeholder="Tell people a little about yourself"
              />
            </div>
            <div className="flex justify-end gap-2 px-4 pb-4">
              <button
                type="button"
                disabled={userProfileSaving}
                onClick={() => {
                  setBioDraft(bio ?? '')
                  setFirstNameDraft(firstName ?? '')
                  setLastNameDraft(lastName ?? '')
                  setUserEditorOpen(false)
                }}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveUserProfile}
                disabled={userProfileSaving}
                className="rounded bg-gymnext px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {userProfileSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
      {handleEditorOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => {
              if (handleSaving) return
              setHandleDraft(handleWithoutAt(handle) || handleKey || '')
              setHandleEditorOpen(false)
            }}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg overflow-hidden">
            <div className="border-b border-gymnext-muted/30 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-800">Edit handle</h2>
            </div>
            <div className="p-4 space-y-3">
              <label htmlFor="profile-handle" className="block text-xs font-medium text-gray-700">
                Handle
              </label>
              <input
                id="profile-handle"
                type="text"
                value={handleDraft}
                onChange={(e) => setHandleDraft(e.target.value)}
                className="w-full rounded border border-gymnext-muted/40 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gymnext/40"
                placeholder="@yourname"
              />
              <p className="text-xs text-gray-500">
                1-64 characters. Letters, numbers, period, underscore, and dash.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-4 pb-4">
              <button
                type="button"
                disabled={handleSaving}
                onClick={() => {
                  setHandleDraft(handleWithoutAt(handle) || handleKey || '')
                  setHandleEditorOpen(false)
                }}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveHandle}
                disabled={handleSaving}
                className="rounded bg-gymnext px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {handleSaving ? 'Saving…' : 'Save handle'}
              </button>
            </div>
          </div>
        </div>
      )}
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
          Sign in to GymNext Flex Timer
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
  mainNav,
  setMainNav,
  connectionsTab,
  setConnectionsTab,
  libraryTab,
  setLibraryTab,
  connectTab,
  setConnectTab,
  planningTab,
  setPlanningTab,
  planAheadColumnCount,
  setPlanAheadColumnCount,
  registerResetToDefault,
  openHandleEditor,
  onProfileUpdated,
}: {
  user: User
  overview: OverviewData | null
  overviewLoading: boolean
  overviewError: string | null
  reloadOverview: () => void
  mainNav: MainNavId
  setMainNav: (id: MainNavId) => void
  connectionsTab: ConnectionsSubTabId
  setConnectionsTab: (id: ConnectionsSubTabId) => void
  libraryTab: LibrarySubTabId
  setLibraryTab: (id: LibrarySubTabId) => void
  connectTab: ConnectSubTabId
  setConnectTab: (id: ConnectSubTabId) => void
  planningTab: PlanningSubTabId
  setPlanningTab: (id: PlanningSubTabId) => void
  planAheadColumnCount: 1 | 2
  setPlanAheadColumnCount: (count: 1 | 2) => void
  registerResetToDefault: (fn: () => void) => void
  openHandleEditor: () => void
  onProfileUpdated: (profile: {
    handle?: string | null
    handleKey?: string | null
    bio?: string | null
    firstName?: string | null
    lastName?: string | null
    hubLookupIds?: UserHubLookupIds
    hubLookupLabels?: UserHubLookupLabels
  }) => void
}) {
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
  const [selectedPlanId, setSelectedPlanIdRaw] = useState<string | null>(null)
  /** Second plan on Plan Ahead: same schedule editor as the first column when both are selected. */
  const [selectedPlanIdSecondary, setSelectedPlanIdSecondary] = useState<string | null>(null)
  const [selectedFollowingSubscriptionId, setSelectedFollowingSubscriptionId] = useState<string | null>(null)
  const [followingPlans, setFollowingPlans] = useState<FollowingPlanRow[]>([])
  const [followingPlansLoading, setFollowingPlansLoading] = useState(false)
  const [followingPlansError, setFollowingPlansError] = useState<string | null>(null)
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
  const [expandWorkoutIdAfterCollectionOpen, setExpandWorkoutIdAfterCollectionOpen] = useState<string | null>(null)
  const [libraryShareTarget, setLibraryShareTarget] = useState<LibraryShareTarget | null>(null)

  const [plannedWorkouts, setPlannedWorkouts] = useState<PlannedWorkout[]>([])
  const [plannedWorkoutsSecondary, setPlannedWorkoutsSecondary] = useState<PlannedWorkout[]>([])
  const [optimisticPlannedWorkouts, setOptimisticPlannedWorkouts] = useState<PlannedWorkout[] | null>(null)
  const [plansLoading, setPlansLoading] = useState(false)
  const [plansError, setPlansError] = useState<string | null>(null)
  const [weekStart, setWeekStart] = useState<string>(() => getLocalYYYYMMDD(new Date()))
  const [weekStartSecondary, setWeekStartSecondary] = useState<string>(() => getLocalYYYYMMDD(new Date()))
  const [planViewMode, setPlanViewMode] = useState<'week' | '3day' | '1day'>('3day')
  const [planViewModeSecondary, setPlanViewModeSecondary] = useState<'week' | '3day' | '1day'>('3day')

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

  useEffect(() => {
    const today = getLocalYYYYMMDD(new Date())
    if (planViewModeSecondary === '1day') {
      setWeekStartSecondary(today)
    } else if (planViewModeSecondary === '3day') {
      setWeekStartSecondary(addDays(today, -1))
    } else {
      setWeekStartSecondary(getMondayOfWeekLocal(new Date()))
    }
  }, [planViewModeSecondary])

  const planDayCount = planViewMode === 'week' ? 7 : planViewMode === '3day' ? 3 : 1
  const planDayCountSecondary =
    planViewModeSecondary === 'week' ? 7 : planViewModeSecondary === '3day' ? 3 : 1
  const weekEnd = useMemo(
    () => addDays(weekStart, planDayCount - 1),
    [weekStart, planDayCount]
  )
  const weekEndSecondary = useMemo(
    () => addDays(weekStartSecondary, planDayCountSecondary - 1),
    [weekStartSecondary, planDayCountSecondary]
  )

  useEffect(() => {
    setOptimisticPlannedWorkouts(null)
  }, [selectedPlanId, weekStart, planDayCount])

  useEffect(() => {
    if (planningTab === 'plans') {
      setSelectedPlanIdSecondary(null)
      setPlannedWorkoutsSecondary([])
    }
  }, [planningTab])

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

  const sortedPlans = useMemo(() => {
    const list = [...(overview?.workoutPlans ?? [])]
    const bucket = (p: WorkoutPlan) => {
      if (p.isPersonal) return 0
      if (p.trainingIntent === 1) return 2
      return 1
    }
    return list.sort((a, b) => {
      const ba = bucket(a)
      const bb = bucket(b)
      if (ba !== bb) return ba - bb
      return a.ordinal - b.ordinal || a.id.localeCompare(b.id)
    })
  }, [overview?.workoutPlans])

  const selectOwnedPlanIdClearingFollowIfOwned = useCallback(
    (id: string | null) => {
      if (id !== null && sortedPlans.some((p) => p.id === id)) {
        setSelectedFollowingSubscriptionId(null)
      }
      setSelectedPlanIdRaw(id)
    },
    [sortedPlans]
  )

  const goToPlansWithOwnedPlanSelected = useCallback(
    (planId: string) => {
      setMainNav('planning')
      setPlanningTab('plans')
      selectOwnedPlanIdClearingFollowIfOwned(planId)
    },
    [selectOwnedPlanIdClearingFollowIfOwned, setMainNav, setPlanningTab]
  )

  /** Activity feed (etc.): jump to Plan Ahead with a followed plan selected when the user already subscribes. */
  const goToPlanAheadWithFollowedPlanActive = useCallback(
    (ownerUserId: string, remotePlanId: string) => {
      const row = followingPlans.find(
        (f) => f.ownerUserId === ownerUserId && f.remotePlanId === remotePlanId
      )
      if (!row) {
        toast.error('Could not open this plan. Try refreshing your followed plans.')
        return
      }
      setMainNav('planning')
      setPlanningTab('plan-ahead')
      setPlanAheadColumnCount(1)
      setSelectedPlanIdSecondary(null)
      setSelectedFollowingSubscriptionId(row.subscriptionDocumentId)
      setSelectedPlanIdRaw(row.remotePlanId)
    },
    [followingPlans]
  )

  const scheduleComparePlan = useMemo(
    () =>
      selectedPlanIdSecondary
        ? sortedPlans.find((p) => p.id === selectedPlanIdSecondary) ?? null
        : null,
    [sortedPlans, selectedPlanIdSecondary]
  )

  useEffect(() => {
    if (selectedPlanId && selectedPlanIdSecondary && selectedPlanId === selectedPlanIdSecondary) {
      setSelectedPlanIdSecondary(null)
    }
  }, [selectedPlanId, selectedPlanIdSecondary])

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

  async function handleDuplicateFavoriteWorkout(workoutId: string, collectionIds: string[]) {
    const res = await authedFetch('/api/app/workouts/duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceWorkoutId: workoutId, collectionIds }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      throw new Error(typeof json.error === 'string' ? json.error : `HTTP ${res.status}`)
    }
    const created = (await res.json()) as Workout
    await reloadOverview()
    await reloadCollectionDetail()
    if (collectionIds.includes('favorite')) {
      setSelectedFavoriteWorkout(created)
    }
    toast.success('Workout duplicated')
    return created
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

  async function handleCreatePlan(
    name: string,
    description: string | null,
    isPersonal: boolean,
    trainingIntent?: 0 | 1
  ) {
    const res = await authedFetch('/api/app/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        description: description?.trim() || null,
        isPersonal,
        ...(!isPersonal ? { trainingIntent: trainingIntent ?? 0 } : {}),
      }),
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

  const consumeExpandWorkoutRequest = useCallback(() => {
    setExpandWorkoutIdAfterCollectionOpen(null)
  }, [])

  const goToLibraryWithOwnedWorkoutSelected = useCallback(
    (workoutId: string) => {
      const w = overview?.workouts?.find((x) => x.id === workoutId)
      if (!w) {
        toast.error('Workout not found in your library.')
        return
      }
      setMainNav('library')
      if (favoritesCollection?.workoutIds.includes(workoutId)) {
        setLibraryTab('favorites')
        setSelectedFavoriteWorkout(w)
        setExpandWorkoutIdAfterCollectionOpen(null)
        return
      }
      const coll = sortedCollections.find(
        (c) => c.id !== 'favorite' && Array.isArray(c.workoutIds) && c.workoutIds.includes(workoutId),
      )
      if (coll) {
        setLibraryTab('collections')
        setExpandWorkoutIdAfterCollectionOpen(workoutId)
        if (collectionDetail?.collection.id !== coll.id) {
          void openCollectionDetail(coll.id)
        }
        return
      }
      toast.error('Could not find this workout in a collection. Open Library to edit it.')
    },
    [
      overview?.workouts,
      favoritesCollection,
      sortedCollections,
      setMainNav,
      setLibraryTab,
      collectionDetail?.collection.id,
      openCollectionDetail,
    ],
  )

  const goToLibraryWithOwnedCollectionSelected = useCallback(
    (collectionId: string) => {
      if (!sortedCollections.some((c) => c.id === collectionId)) {
        toast.error('Collection not found in your library.')
        return
      }
      setMainNav('library')
      setLibraryTab('collections')
      setExpandWorkoutIdAfterCollectionOpen(null)
      if (collectionDetail?.collection.id !== collectionId) {
        void openCollectionDetail(collectionId)
      }
    },
    [sortedCollections, setMainNav, setLibraryTab, collectionDetail?.collection.id, openCollectionDetail],
  )

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
    description: string | null,
    trainingIntent?: 0 | 1
  ) {
    const res = await authedFetch(
      `/api/app/plans/${encodeURIComponent(planId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workoutPlanName: name,
          workoutPlanDescription: description,
          ...(trainingIntent === 0 || trainingIntent === 1 ? { trainingIntent } : {}),
        }),
      }
    )
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to update plan')
    }
    await reloadOverview()
  }

  async function handleSetPlanShowInSchedule(planId: string, showInSchedule: boolean) {
    const res = await authedFetch(`/api/app/plans/${encodeURIComponent(planId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showInSchedule }),
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(data.error || 'Failed to update plan')
    }
    await reloadOverview()
  }

  async function handleReorderPlansInSection(
    planSection: 'personal' | 'privateTraining' | 'groupTraining',
    planIds: string[]
  ) {
    try {
      await authedFetch('/api/app/plans', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planSection, planIds }),
      })
      await reloadOverview()
    } catch (e) {
      console.error('[plans reorder]', e)
      setReorderPlansError(e instanceof Error ? e.message : 'Failed to save order')
      await reloadOverview()
    }
  }

  async function handleReorderSubscriptions(subscriptionDocumentIds: string[]) {
    try {
      await authedFetch('/api/app/following-plans', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionDocumentIds }),
      })
      await refetchFollowingPlansQuiet()
    } catch (e) {
      console.error('[subscriptions reorder]', e)
      setReorderPlansError(e instanceof Error ? e.message : 'Failed to save subscription order')
      await refetchFollowingPlansQuiet()
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
      setSelectedPlanIdRaw((cur) => (cur === planId ? null : cur))
      setSelectedPlanIdSecondary((cur) => (cur === planId ? null : cur))
      setSelectedFollowingSubscriptionId(null)
    } catch (e) {
      console.error('[plan delete]', e)
    }
  }

  async function fetchPlannedWorkoutsForSelection(
    followingSubId: string | null,
    ownedPlanId: string | null
  ) {
    if (!followingSubId && !ownedPlanId) {
      setPlannedWorkouts([])
      setPlannedWorkoutsSecondary([])
      setOptimisticPlannedWorkouts(null)
      setPlansError(null)
      setPlansLoading(false)
      return
    }
    setPlansLoading(true)
    setPlansError(null)
    try {
      const res = followingSubId
        ? await authedFetch(
            `/api/app/following-plans/${encodeURIComponent(followingSubId)}/planned-workouts?from=${encodeURIComponent(weekStart)}&to=${encodeURIComponent(weekEnd)}`
          )
        : await authedFetch(
            `/api/app/plans/${encodeURIComponent(
              ownedPlanId!
            )}/planned-workouts?from=${encodeURIComponent(weekStart)}&to=${encodeURIComponent(weekEnd)}`
          )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as { plannedWorkouts: PlannedWorkout[] }
      setPlannedWorkouts(data.plannedWorkouts ?? [])
      setOptimisticPlannedWorkouts(null)
    } catch (e) {
      setPlansError(e instanceof Error ? e.message : 'Failed to load planned workouts')
      setPlannedWorkouts([])
      setPlannedWorkoutsSecondary([])
      setOptimisticPlannedWorkouts(null)
    } finally {
      setPlansLoading(false)
    }
  }

  const refreshPlannedWorkoutsDisplay = useCallback(async () => {
    if (selectedFollowingSubscriptionId) {
      await fetchPlannedWorkoutsForSelection(selectedFollowingSubscriptionId, selectedPlanId)
      setPlannedWorkoutsSecondary([])
      return
    }
    if (mainNav !== 'planning' || planningTab !== 'plan-ahead') {
      await fetchPlannedWorkoutsForSelection(null, selectedPlanId)
      setPlannedWorkoutsSecondary([])
      return
    }
    try {
      if (selectedPlanId) {
        const res = await authedFetch(
          `/api/app/plans/${encodeURIComponent(selectedPlanId)}/planned-workouts?from=${encodeURIComponent(weekStart)}&to=${encodeURIComponent(weekEnd)}`
        )
        if (res.ok) {
          const data = (await res.json()) as { plannedWorkouts?: PlannedWorkout[] }
          setPlannedWorkouts(data.plannedWorkouts ?? [])
        }
      } else {
        setPlannedWorkouts([])
      }
      const secId =
        selectedPlanIdSecondary && selectedPlanIdSecondary !== selectedPlanId ? selectedPlanIdSecondary : null
      if (secId) {
        const res2 = await authedFetch(
          `/api/app/plans/${encodeURIComponent(secId)}/planned-workouts?from=${encodeURIComponent(weekStartSecondary)}&to=${encodeURIComponent(weekEndSecondary)}`
        )
        if (res2.ok) {
          const data2 = (await res2.json()) as { plannedWorkouts?: PlannedWorkout[] }
          setPlannedWorkoutsSecondary(data2.plannedWorkouts ?? [])
        }
      } else {
        setPlannedWorkoutsSecondary([])
      }
      setOptimisticPlannedWorkouts(null)
    } catch {
      /* leave lists unchanged on error */
    }
  }, [
    selectedFollowingSubscriptionId,
    selectedPlanId,
    selectedPlanIdSecondary,
    weekStart,
    weekEnd,
    weekStartSecondary,
    weekEndSecondary,
    mainNav,
    planningTab,
  ])

  function updatePlannedWorkoutMetadataInPlace(
    plannedWorkoutId: string,
    patch: { workoutName?: string | null; workoutDescription?: string | null; workoutDetails?: string | null }
  ) {
    const updater = (list: PlannedWorkout[]) =>
      list.map((pw) =>
        pw.id === plannedWorkoutId
          ? {
              ...pw,
              workout: {
                ...pw.workout,
                workoutName: patch.workoutName !== undefined ? patch.workoutName : pw.workout.workoutName,
                workoutDescription:
                  patch.workoutDescription !== undefined ? patch.workoutDescription : pw.workout.workoutDescription,
                ...(patch.workoutDetails !== undefined && pw.workout.type !== 'MultiSegmentWorkout'
                  ? { workoutDetails: patch.workoutDetails }
                  : {}),
              },
            }
          : pw
      )
    setPlannedWorkouts((prev) => updater(prev))
    setOptimisticPlannedWorkouts((prev) => (prev ? updater(prev) : null))
    setPlannedWorkoutsSecondary((prev) => updater(prev))
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

  const byDaySecondary = useMemo(() => {
    const map: Record<string, PlannedWorkout[]> = {}
    const weekDays = Array.from({ length: planDayCountSecondary }, (_, i) =>
      addDays(weekStartSecondary, i)
    )
    weekDays.forEach((d) => (map[d] = []))
    plannedWorkoutsSecondary.forEach((pw) => {
      const key = pw.day.slice(0, 10)
      if (!map[key]) map[key] = []
      map[key].push(pw)
    })
    weekDays.forEach((d) => {
      if (map[d]) map[d].sort((a, b) => a.ordinal - b.ordinal)
    })
    return map
  }, [plannedWorkoutsSecondary, weekStartSecondary, planDayCountSecondary])

  async function handleReorderPlannedWithinDay(
    dayKey: string,
    index: number,
    direction: 'up' | 'down',
    planId?: string | null
  ) {
    if (selectedFollowingSubscriptionId) return
    const pid = planId ?? selectedPlanId
    if (!pid) return
    const columnByDay = pid === selectedPlanId ? byDay : pid === selectedPlanIdSecondary ? byDaySecondary : null
    if (!columnByDay) return
    const items = [...(columnByDay[dayKey] ?? [])]
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
      await refreshPlannedWorkoutsDisplay()
    } catch (e) {
      console.error('[planned reorder]', e)
    }
  }

  function handlePlannedWorkoutDrop(
    dayKey: string,
    fromIndex: number,
    toIndex: number,
    planId?: string | null
  ) {
    if (selectedFollowingSubscriptionId) return
    const pid = planId ?? selectedPlanId
    if (!pid) return
    const columnByDay = pid === selectedPlanId ? byDay : pid === selectedPlanIdSecondary ? byDaySecondary : null
    if (!columnByDay) return
    const items = [...(columnByDay[dayKey] ?? [])]
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
    const isPrimary = pid === selectedPlanId
    if (isPrimary) {
      const fullList = weekDays.flatMap((d) => (d === dayKey ? items : (byDay[d] ?? [])))
      setOptimisticPlannedWorkouts(fullList)
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
    } else {
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
        .then(() => void refreshPlannedWorkoutsDisplay())
        .catch((e) => {
          console.error('[planned drop reorder]', e)
        })
    }
  }

  async function handleDeletePlanned(pw: PlannedWorkout) {
    if (selectedFollowingSubscriptionId) return
    try {
      await authedFetch(
        `/api/app/plans/${encodeURIComponent(
          pw.planId
        )}/planned-workouts/${encodeURIComponent(pw.id)}`,
        { method: 'DELETE' }
      )
      await refreshPlannedWorkoutsDisplay()
    } catch (e) {
      console.error('[planned delete]', e)
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const planAheadOwned =
        mainNav === 'planning' && planningTab === 'plan-ahead' && !selectedFollowingSubscriptionId
      const hasScheduleSource =
        selectedFollowingSubscriptionId !== null ||
        selectedPlanId !== null ||
        (planAheadOwned && selectedPlanIdSecondary !== null)

      if (!hasScheduleSource) {
        setPlannedWorkouts([])
        setPlannedWorkoutsSecondary([])
        setOptimisticPlannedWorkouts(null)
        setPlansError(null)
        setPlansLoading(false)
        return
      }
      if (mainNav === 'planning' && planningTab === 'plans') {
        if (!cancelled) setPlansLoading(false)
        return
      }
      setPlansLoading(true)
      setPlansError(null)
      try {
        const dualPlanAhead =
          planAheadOwned &&
          selectedPlanId &&
          selectedPlanIdSecondary &&
          selectedPlanId !== selectedPlanIdSecondary

        if (dualPlanAhead) {
          const [res1, res2] = await Promise.all([
            authedFetch(
              `/api/app/plans/${encodeURIComponent(selectedPlanId)}/planned-workouts?from=${encodeURIComponent(weekStart)}&to=${encodeURIComponent(weekEnd)}`
            ),
            authedFetch(
              `/api/app/plans/${encodeURIComponent(selectedPlanIdSecondary!)}/planned-workouts?from=${encodeURIComponent(weekStartSecondary)}&to=${encodeURIComponent(weekEndSecondary)}`
            ),
          ])
          if (!res1.ok) {
            const data = (await res1.json().catch(() => ({}))) as { error?: string }
            throw new Error(data.error || `HTTP ${res1.status}`)
          }
          if (!res2.ok) {
            const data = (await res2.json().catch(() => ({}))) as { error?: string }
            throw new Error(data.error || `HTTP ${res2.status}`)
          }
          const [data1, data2] = await Promise.all([
            res1.json() as Promise<{ plannedWorkouts?: PlannedWorkout[] }>,
            res2.json() as Promise<{ plannedWorkouts?: PlannedWorkout[] }>,
          ])
          if (cancelled) return
          setPlannedWorkouts(data1.plannedWorkouts ?? [])
          setPlannedWorkoutsSecondary(data2.plannedWorkouts ?? [])
          setOptimisticPlannedWorkouts(null)
        } else if (planAheadOwned) {
          if (selectedPlanId) {
            const res = await authedFetch(
              `/api/app/plans/${encodeURIComponent(selectedPlanId)}/planned-workouts?from=${encodeURIComponent(weekStart)}&to=${encodeURIComponent(weekEnd)}`
            )
            const payload = (await res.json().catch(() => ({}))) as { error?: string; plannedWorkouts?: PlannedWorkout[] }
            if (!res.ok) {
              throw new Error(payload.error || `HTTP ${res.status}`)
            }
            if (cancelled) return
            setPlannedWorkouts(payload.plannedWorkouts ?? [])
          } else if (!cancelled) {
            setPlannedWorkouts([])
          }
          const secId =
            selectedPlanIdSecondary && selectedPlanIdSecondary !== selectedPlanId
              ? selectedPlanIdSecondary
              : null
          if (secId) {
            const res2 = await authedFetch(
              `/api/app/plans/${encodeURIComponent(secId)}/planned-workouts?from=${encodeURIComponent(weekStartSecondary)}&to=${encodeURIComponent(weekEndSecondary)}`
            )
            const payload2 = (await res2.json().catch(() => ({}))) as {
              error?: string
              plannedWorkouts?: PlannedWorkout[]
            }
            if (!res2.ok) {
              throw new Error(payload2.error || `HTTP ${res2.status}`)
            }
            if (cancelled) return
            setPlannedWorkoutsSecondary(payload2.plannedWorkouts ?? [])
          } else if (!cancelled) {
            setPlannedWorkoutsSecondary([])
          }
          if (!cancelled) setOptimisticPlannedWorkouts(null)
        } else {
          const res = selectedFollowingSubscriptionId
            ? await authedFetch(
                `/api/app/following-plans/${encodeURIComponent(selectedFollowingSubscriptionId)}/planned-workouts?from=${encodeURIComponent(weekStart)}&to=${encodeURIComponent(weekEnd)}`
              )
            : await authedFetch(
                `/api/app/plans/${encodeURIComponent(
                  selectedPlanId!
                )}/planned-workouts?from=${encodeURIComponent(weekStart)}&to=${encodeURIComponent(weekEnd)}`
              )
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(data.error || `HTTP ${res.status}`)
          }
          const data = (await res.json()) as { plannedWorkouts: PlannedWorkout[] }
          if (cancelled) return
          setPlannedWorkouts(data.plannedWorkouts ?? [])
          setPlannedWorkoutsSecondary([])
          setOptimisticPlannedWorkouts(null)
        }
      } catch (e) {
        if (cancelled) return
        setPlansError(e instanceof Error ? e.message : 'Failed to load planned workouts')
        setPlannedWorkouts([])
        setPlannedWorkoutsSecondary([])
        setOptimisticPlannedWorkouts(null)
      } finally {
        if (!cancelled) setPlansLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    selectedFollowingSubscriptionId,
    selectedPlanId,
    selectedPlanIdSecondary,
    weekStart,
    weekEnd,
    weekStartSecondary,
    weekEndSecondary,
    mainNav,
    planningTab,
  ])

  const refetchFollowingPlansQuiet = useCallback(async () => {
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/following-plans', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data = (await res.json()) as { followingPlans?: FollowingPlanRow[] }
      setFollowingPlans(normalizeFollowingPlanRows(data.followingPlans))
    } catch {
      /* leave list unchanged */
    }
  }, [user])

  useEffect(() => {
    const needFollowingPlans =
      overview &&
      ((mainNav === 'planning' &&
        (planningTab === 'plans' || planningTab === 'plan-ahead' || planningTab === 'today')) ||
        (mainNav === 'connect' &&
          (connectTab === 'feed' || connectTab === 'shared-content')))
    if (!needFollowingPlans) return
    let cancelled = false
    ;(async () => {
      setFollowingPlansLoading(true)
      setFollowingPlansError(null)
      try {
        const res = await authedFetch('/api/app/following-plans')
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `HTTP ${res.status}`)
        }
        const data = (await res.json()) as { followingPlans?: FollowingPlanRow[] }
        if (!cancelled) setFollowingPlans(normalizeFollowingPlanRows(data.followingPlans))
      } catch (e) {
        if (!cancelled) {
          setFollowingPlans([])
          setFollowingPlansError(
            e instanceof Error ? e.message : 'Failed to load subscriptions'
          )
        }
      } finally {
        if (!cancelled) setFollowingPlansLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mainNav, planningTab, connectTab, overview, user])

  const planningTodayFollowedEntries = useMemo(
    () =>
      followingPlans.map((row) => ({
        subscriptionDocumentId: row.subscriptionDocumentId,
        plan: followingSubscriptionToWorkoutPlan(row),
      })),
    [followingPlans]
  )

  const workoutPlansForTodayTab = useMemo(
    () => sortedPlans.filter(planShowsInTodayTab),
    [sortedPlans]
  )

  useEffect(() => {
    registerResetToDefault(() => {
      setMainNav('home')
      setLibraryTab('favorites')
      setConnectTab('feed')
      setPlanningTab('plan-ahead')
      setPlanAheadColumnCount(2)
      setConnectionsTab('connections')
      setSelectedCollectionId(null)
      setCollectionDetail(null)
      setSelectedPlanIdRaw(null)
      setSelectedPlanIdSecondary(null)
      setSelectedFollowingSubscriptionId(null)
      setSelectedFavoriteWorkout(null)
      setLibraryShareTarget(null)
    })
    return () => registerResetToDefault(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hideOverviewStatusChrome =
    mainNav === 'connect' ||
    mainNav === 'settings' ||
    mainNav === 'connections' ||
    mainNav === 'support'

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      {mainNav === 'home' && (
        <div className="rounded-lg border border-gymnext-muted/30 bg-white p-6 shadow-sm max-w-xl">
          <h2 className="text-sm font-semibold text-gray-900">Welcome</h2>
          <p className="mt-2 text-sm text-gray-600">
            Use the menu on the left for Planning, Connect, Library, account sections, or settings. Choose the
            app name in the header anytime to return to this welcome screen.
          </p>
        </div>
      )}
      {mainNav === 'connect' && (
        <div className="flex min-h-0 w-full flex-1 flex-col">
          <ConnectSection
            connectTab={connectTab}
            user={user}
            followedPlansForFeed={followingPlans}
            onFollowedPlanFromFeed={refetchFollowingPlansQuiet}
            reloadOverview={reloadOverview}
            onGoToOwnedPlan={goToPlansWithOwnedPlanSelected}
            onGoToSubscribedPlanAhead={goToPlanAheadWithFollowedPlanActive}
            onGoToOwnedWorkout={goToLibraryWithOwnedWorkoutSelected}
            onGoToOwnedCollection={goToLibraryWithOwnedCollectionSelected}
          />
        </div>
      )}
      {mainNav === 'connections' && (
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
          <ConnectionsMembershipsSection connectionsTab={connectionsTab} user={user} />
        </div>
      )}
      {mainNav === 'settings' && (
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
          <UserSettingsScreen
            user={user}
            overview={overview}
            overviewLoading={overviewLoading}
            openHandleEditor={openHandleEditor}
            onProfileUpdated={onProfileUpdated}
          />
        </div>
      )}
      {mainNav === 'support' && (
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
          <RecoverDeletedItemsSection user={user} onLibraryChanged={reloadOverview} />
        </div>
      )}

      {!hideOverviewStatusChrome && overviewLoading && !overview && (
        <p className="text-sm text-gray-500">Loading your data…</p>
      )}
      {!hideOverviewStatusChrome && overviewError && (
        <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">
          {overviewError}
        </div>
      )}

      {!hideOverviewStatusChrome && !overview && !overviewLoading && !overviewError && (
        <p className="text-sm text-gray-500">
          No data found yet. Create workouts and collections in the FlexTimer
          mobile app and they will appear here.
        </p>
      )}

      {overview && (
        <div
          className={`flex min-h-0 min-w-0 flex-col ${
            mainNav === 'connect' ||
            mainNav === 'settings' ||
            mainNav === 'connections' ||
            mainNav === 'support'
              ? 'hidden'
              : 'flex-1'
          }`}
        >
          {mainNav === 'library' && libraryTab === 'favorites' && (
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
              onDuplicateWorkout={handleDuplicateFavoriteWorkout}
              onOpenContentShare={setLibraryShareTarget}
            />
          )}
          {mainNav === 'library' && libraryTab === 'collections' && (
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
              onDuplicateWorkout={handleDuplicateFavoriteWorkout}
              onOpenContentShare={setLibraryShareTarget}
              expandWorkoutIdWhenDetailMatches={expandWorkoutIdAfterCollectionOpen}
              onConsumedExpandWorkoutRequest={consumeExpandWorkoutRequest}
            />
          )}
          {mainNav === 'library' && libraryTab === 'bookmarks' && (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <LibraryBookmarksSection user={user} />
            </div>
          )}
          {mainNav === 'planning' && planningTab === 'today' && (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <PlanningTodaySection
                user={user}
                plans={workoutPlansForTodayTab}
                followedPlans={planningTodayFollowedEntries}
                onOpenPlanAhead={(target: PlanAheadLookTarget) => {
                  setMainNav('planning')
                  setPlanningTab('plan-ahead')
                  setPlanAheadColumnCount(1)
                  setSelectedPlanIdSecondary(null)
                  if (target.kind === 'owned') {
                    setSelectedFollowingSubscriptionId(null)
                    setSelectedPlanIdRaw(target.planId)
                    return
                  }
                  setSelectedFollowingSubscriptionId(target.subscriptionDocumentId)
                  const row = followingPlans.find(
                    (f) => f.subscriptionDocumentId === target.subscriptionDocumentId
                  )
                  setSelectedPlanIdRaw(row?.remotePlanId ?? null)
                }}
              />
            </div>
          )}
          {mainNav === 'planning' && (planningTab === 'plans' || planningTab === 'plan-ahead') && (
            <PlansSection
              listSurfaceTitle={planningTab === 'plan-ahead' ? 'Plan Ahead' : 'Plans'}
              rightPanelMode={planningTab === 'plans' ? 'plan-admin' : 'schedule'}
              planAheadColumnCount={planAheadColumnCount}
              setPlanAheadColumnCount={setPlanAheadColumnCount}
              reloadFollowingPlans={refetchFollowingPlansQuiet}
              plans={sortedPlans}
              selectedPlanId={selectedPlanId}
              setSelectedPlanId={selectOwnedPlanIdClearingFollowIfOwned}
              selectedPlanIdSecondary={selectedPlanIdSecondary}
              setSelectedPlanIdSecondary={setSelectedPlanIdSecondary}
              scheduleSecondPlan={scheduleComparePlan}
              scheduleSecondByDay={byDaySecondary}
              followingPlans={followingPlans}
              followingPlansLoading={followingPlansLoading}
              followingPlansError={followingPlansError}
              selectedFollowingSubscriptionId={selectedFollowingSubscriptionId}
              setSelectedFollowingSubscriptionId={(subId) => {
                if (subId !== null) {
                  setSelectedPlanIdRaw(null)
                }
                setSelectedFollowingSubscriptionId(subId)
              }}
              weekStart={weekStart}
              setWeekStart={setWeekStart}
              weekEnd={weekEnd}
              weekStartSecondary={weekStartSecondary}
              setWeekStartSecondary={setWeekStartSecondary}
              weekEndSecondary={weekEndSecondary}
              byDay={byDay}
              planViewMode={planViewMode}
              setPlanViewMode={setPlanViewMode}
              planDayCount={planDayCount}
              planViewModeSecondary={planViewModeSecondary}
              setPlanViewModeSecondary={setPlanViewModeSecondary}
              planDayCountSecondary={planDayCountSecondary}
              plansLoading={plansLoading}
              plansError={plansError}
              onReorderPlanned={handleReorderPlannedWithinDay}
              onPlannedWorkoutDrop={handlePlannedWorkoutDrop}
              onDeletePlanned={handleDeletePlanned}
              user={user}
              reloadPlanned={() => {
                void refreshPlannedWorkoutsDisplay()
              }}
              onPlannedWorkoutMetadataSaved={updatePlannedWorkoutMetadataInPlace}
              onCreatePlan={handleCreatePlan}
              onUpdatePlan={handleUpdatePlan}
              onSetPlanShowInSchedule={handleSetPlanShowInSchedule}
              onDeletePlan={handleDeletePlan}
              maxPlans={overview?.subscriptionLimits?.maxPlans ?? UNLIMITED}
              plansCount={overview?.counts?.plans ?? 0}
              subscriptionTier={overview?.subscriptionLimits?.tier ?? 'basic'}
              onReorderPlansInSection={handleReorderPlansInSection}
              onReorderSubscriptions={handleReorderSubscriptions}
              reorderPlansError={reorderPlansError}
              onDismissReorderPlansError={() => setReorderPlansError(null)}
              favoriteWorkouts={favoriteWorkouts}
              collectionsExcludingFavorites={collectionsExcludingFavorites}
              workoutsById={overview?.workouts ? new Map(overview.workouts.map((w) => [w.id, w])) : new Map()}
              timerDefaults={overview?.timerDefaults}
            />
          )}
        </div>
      )}
      {libraryShareTarget && (
        <ContentShareDialogs
          user={user}
          open
          onClose={() => setLibraryShareTarget(null)}
          kind={libraryShareTarget.kind}
          resourceId={libraryShareTarget.id}
          resourceTitle={libraryShareTarget.title}
        />
      )}
    </div>
  )
}

function ConnectSection({
  connectTab,
  user,
  followedPlansForFeed,
  onFollowedPlanFromFeed,
  reloadOverview,
  onGoToOwnedPlan,
  onGoToSubscribedPlanAhead,
  onGoToOwnedWorkout,
  onGoToOwnedCollection,
}: {
  connectTab: ConnectSubTabId
  user: User
  followedPlansForFeed: FollowingPlanRow[]
  onFollowedPlanFromFeed: () => void | Promise<void>
  reloadOverview: () => void
  onGoToOwnedPlan: (planId: string) => void
  onGoToSubscribedPlanAhead: (ownerUserId: string, remotePlanId: string) => void
  onGoToOwnedWorkout?: (workoutId: string) => void
  onGoToOwnedCollection?: (collectionId: string) => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {connectTab === 'hubs' && <MyHubsSection user={user} />}
      {connectTab === 'shared-content' && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ConnectSharedContentSection
            user={user}
            followedPlans={followedPlansForFeed}
            onFollowedPlansChange={onFollowedPlanFromFeed}
            reloadOverview={reloadOverview}
            onGoToOwnedPlan={onGoToOwnedPlan}
            onGoToSubscribedPlanAhead={onGoToSubscribedPlanAhead}
          />
        </div>
      )}
      {connectTab === 'feed' && (
        <ConnectFeedSection
          user={user}
          followedPlans={followedPlansForFeed}
          onFollowedPlanFromFeed={onFollowedPlanFromFeed}
          reloadOverview={reloadOverview}
          onGoToOwnedPlan={onGoToOwnedPlan}
          onGoToSubscribedPlanAhead={onGoToSubscribedPlanAhead}
          onGoToOwnedWorkout={onGoToOwnedWorkout}
          onGoToOwnedCollection={onGoToOwnedCollection}
        />
      )}
    </div>
  )
}

function ConnectionsMembershipsSection({
  connectionsTab,
  user,
}: {
  connectionsTab: ConnectionsSubTabId
  user: User
}) {
  if (connectionsTab === 'memberships') {
    return (
      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
        <MembershipsSection user={user} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
      <ConnectionsSection user={user} />
    </div>
  )
}

function MainNavSidebar({
  mainNav,
  connectionsTab,
  libraryTab,
  connectTab,
  planningTab,
  pendingConnectionInvites,
  pendingMembershipInvites,
  pendingHubJoinRequests,
  setMainNav,
  setConnectionsTab,
  setLibraryTab,
  setConnectTab,
  setPlanningTab,
  setPlanAheadColumnCount,
}: {
  mainNav: MainNavId
  connectionsTab: ConnectionsSubTabId
  libraryTab: LibrarySubTabId
  connectTab: ConnectSubTabId
  planningTab: PlanningSubTabId
  pendingConnectionInvites: number
  pendingMembershipInvites: number
  pendingHubJoinRequests: number
  setMainNav: (id: MainNavId) => void
  setConnectionsTab: (id: ConnectionsSubTabId) => void
  setLibraryTab: (id: LibrarySubTabId) => void
  setConnectTab: (id: ConnectSubTabId) => void
  setPlanningTab: (id: PlanningSubTabId) => void
  setPlanAheadColumnCount: (count: 1 | 2) => void
}) {
  const select = (id: MainNavId) => {
    setMainNav(id)
  }

  const selectConnectionsSub = (tab: ConnectionsSubTabId) => {
    setConnectionsTab(tab)
    setMainNav('connections')
  }

  const selectLibrarySub = (tab: LibrarySubTabId) => {
    setLibraryTab(tab)
    setMainNav('library')
  }

  const selectConnectSub = (tab: ConnectSubTabId) => {
    setConnectTab(tab)
    setMainNav('connect')
  }

  const selectPlanningSub = (tab: PlanningSubTabId) => {
    if (tab === 'plan-ahead' && planningTab === 'today') {
      setPlanAheadColumnCount(1)
    }
    setPlanningTab(tab)
    setMainNav('planning')
  }

  const [accountOpen, setAccountOpen] = useState(false)

  return (
    <aside
      id="main-nav-sidebar"
      className="flex h-full w-[240px] shrink-0 flex-col border-r border-neutral-200 bg-neutral-50"
      aria-label="App sections"
    >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
            <div className="flex flex-col gap-2" role="group" aria-labelledby="main-nav-planning-heading">
              <p
                className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500"
                id="main-nav-planning-heading"
              >
                Planning
              </p>
              <button
                type="button"
                onClick={() => selectPlanningSub('today')}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold transition-colors ${
                  mainNav === 'planning' && planningTab === 'today'
                    ? 'text-white shadow-sm'
                    : 'text-gray-800 hover:bg-gymnext-background'
                }`}
                style={
                  mainNav === 'planning' && planningTab === 'today'
                    ? { backgroundColor: '#6B21A8' }
                    : undefined
                }
                aria-current={mainNav === 'planning' && planningTab === 'today' ? 'page' : undefined}
              >
                <CalendarCheck2 className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                Today&apos;s Plan
              </button>
              <button
                type="button"
                onClick={() => selectPlanningSub('plan-ahead')}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold transition-colors ${
                  mainNav === 'planning' && planningTab === 'plan-ahead'
                    ? 'text-white shadow-sm'
                    : 'text-gray-800 hover:bg-gymnext-background'
                }`}
                style={
                  mainNav === 'planning' && planningTab === 'plan-ahead'
                    ? { backgroundColor: '#6B21A8' }
                    : undefined
                }
                aria-current={mainNav === 'planning' && planningTab === 'plan-ahead' ? 'page' : undefined}
              >
                <CalendarRange className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                Plan Ahead
              </button>
              <button
                type="button"
                onClick={() => selectPlanningSub('plans')}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold transition-colors ${
                  mainNav === 'planning' && planningTab === 'plans'
                    ? 'text-white shadow-sm'
                    : 'text-gray-800 hover:bg-gymnext-background'
                }`}
                style={
                  mainNav === 'planning' && planningTab === 'plans'
                    ? { backgroundColor: '#6B21A8' }
                    : undefined
                }
                aria-current={mainNav === 'planning' && planningTab === 'plans' ? 'page' : undefined}
              >
                <CalendarDays className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                Plans
              </button>
            </div>
            <div className="flex flex-col gap-2" role="group" aria-labelledby="main-nav-library-heading">
              <p
                className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500"
                id="main-nav-library-heading"
              >
                Library
              </p>
              <button
                type="button"
                onClick={() => selectLibrarySub('favorites')}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold transition-colors ${
                  mainNav === 'library' && libraryTab === 'favorites'
                    ? 'text-white shadow-sm'
                    : 'text-gray-800 hover:bg-gymnext-background'
                }`}
                style={
                  mainNav === 'library' && libraryTab === 'favorites'
                    ? { backgroundColor: '#6B21A8' }
                    : undefined
                }
                aria-current={mainNav === 'library' && libraryTab === 'favorites' ? 'page' : undefined}
              >
                <Star className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                Favorites
              </button>
              <button
                type="button"
                onClick={() => selectLibrarySub('collections')}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold transition-colors ${
                  mainNav === 'library' && libraryTab === 'collections'
                    ? 'text-white shadow-sm'
                    : 'text-gray-800 hover:bg-gymnext-background'
                }`}
                style={
                  mainNav === 'library' && libraryTab === 'collections'
                    ? { backgroundColor: '#6B21A8' }
                    : undefined
                }
                aria-current={mainNav === 'library' && libraryTab === 'collections' ? 'page' : undefined}
              >
                <Library className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                Collections
              </button>
              <button
                type="button"
                onClick={() => selectLibrarySub('bookmarks')}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold transition-colors ${
                  mainNav === 'library' && libraryTab === 'bookmarks'
                    ? 'text-white shadow-sm'
                    : 'text-gray-800 hover:bg-gymnext-background'
                }`}
                style={
                  mainNav === 'library' && libraryTab === 'bookmarks'
                    ? { backgroundColor: '#6B21A8' }
                    : undefined
                }
                aria-current={mainNav === 'library' && libraryTab === 'bookmarks' ? 'page' : undefined}
              >
                <Bookmark className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                Bookmarks
              </button>
            </div>
            <div className="flex flex-col gap-2" role="group" aria-labelledby="main-nav-connect-heading">
              <p
                className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500"
                id="main-nav-connect-heading"
              >
                Connect
              </p>
              <button
                type="button"
                onClick={() => selectConnectSub('feed')}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold transition-colors ${
                  mainNav === 'connect' && connectTab === 'feed'
                    ? 'text-white shadow-sm'
                    : 'text-gray-800 hover:bg-gymnext-background'
                }`}
                style={
                  mainNav === 'connect' && connectTab === 'feed'
                    ? { backgroundColor: '#6B21A8' }
                    : undefined
                }
                aria-current={mainNav === 'connect' && connectTab === 'feed' ? 'page' : undefined}
              >
                <Newspaper className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                Activity
              </button>
              <button
                type="button"
                onClick={() => selectConnectSub('shared-content')}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold transition-colors ${
                  mainNav === 'connect' && connectTab === 'shared-content'
                    ? 'text-white shadow-sm'
                    : 'text-gray-800 hover:bg-gymnext-background'
                }`}
                style={
                  mainNav === 'connect' && connectTab === 'shared-content'
                    ? { backgroundColor: '#6B21A8' }
                    : undefined
                }
                aria-current={
                  mainNav === 'connect' && connectTab === 'shared-content' ? 'page' : undefined
                }
              >
                <Share2 className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                Shared Content
              </button>
              <button
                type="button"
                onClick={() => selectConnectionsSub('connections')}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold transition-colors ${
                  mainNav === 'connections' && connectionsTab === 'connections'
                    ? 'text-white shadow-sm'
                    : 'text-gray-800 hover:bg-gymnext-background'
                }`}
                style={
                  mainNav === 'connections' && connectionsTab === 'connections'
                    ? { backgroundColor: '#6B21A8' }
                    : undefined
                }
                aria-current={
                  mainNav === 'connections' && connectionsTab === 'connections' ? 'page' : undefined
                }
                aria-label={
                  pendingConnectionInvites > 0
                    ? `Connections, ${pendingConnectionInvites} pending invitation${pendingConnectionInvites === 1 ? '' : 's'}`
                    : 'Connections'
                }
              >
                <Users className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                <span className="min-w-0 flex-1">Connections</span>
                <NavCountBadge count={pendingConnectionInvites} />
              </button>
              <button
                type="button"
                onClick={() => selectConnectionsSub('memberships')}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold transition-colors ${
                  mainNav === 'connections' && connectionsTab === 'memberships'
                    ? 'text-white shadow-sm'
                    : 'text-gray-800 hover:bg-gymnext-background'
                }`}
                style={
                  mainNav === 'connections' && connectionsTab === 'memberships'
                    ? { backgroundColor: '#6B21A8' }
                    : undefined
                }
                aria-current={
                  mainNav === 'connections' && connectionsTab === 'memberships' ? 'page' : undefined
                }
                aria-label={
                  pendingMembershipInvites > 0
                    ? `Memberships, ${pendingMembershipInvites} pending invitation${pendingMembershipInvites === 1 ? '' : 's'}`
                    : 'Memberships'
                }
              >
                <Link2 className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                <span className="min-w-0 flex-1">Memberships</span>
                <NavCountBadge count={pendingMembershipInvites} />
              </button>
              <button
                type="button"
                onClick={() => selectConnectSub('hubs')}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold transition-colors ${
                  mainNav === 'connect' && connectTab === 'hubs'
                    ? 'text-white shadow-sm'
                    : 'text-gray-800 hover:bg-gymnext-background'
                }`}
                style={
                  mainNav === 'connect' && connectTab === 'hubs'
                    ? { backgroundColor: '#6B21A8' }
                    : undefined
                }
                aria-current={mainNav === 'connect' && connectTab === 'hubs' ? 'page' : undefined}
                aria-label={
                  pendingHubJoinRequests > 0
                    ? `Hubs, ${pendingHubJoinRequests} pending join request${pendingHubJoinRequests === 1 ? '' : 's'}`
                    : 'Hubs'
                }
              >
                <LayoutGrid className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                <span className="min-w-0 flex-1">Hubs</span>
                <NavCountBadge count={pendingHubJoinRequests} />
              </button>
            </div>
          </div>
          <div className="border-t border-gymnext-muted/30 bg-gymnext-background/40 p-3 flex flex-col gap-2 shrink-0">
            {accountOpen && (
              <div
                id="main-nav-account-panel"
                className="flex flex-col gap-2 rounded-lg border border-gymnext-muted/30 bg-gymnext-background/60 p-2"
                role="group"
                aria-label="Account"
              >
                <button
                  type="button"
                  onClick={() => select('settings')}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold transition-colors ${
                    mainNav === 'settings'
                      ? 'text-white shadow-sm'
                      : 'text-gray-800 hover:bg-gymnext-background'
                  }`}
                  style={mainNav === 'settings' ? { backgroundColor: '#6B21A8' } : undefined}
                  aria-current={mainNav === 'settings' ? 'page' : undefined}
                >
                  <Settings className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                  User Settings
                </button>
                <button
                  type="button"
                  onClick={() => select('support')}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold transition-colors ${
                    mainNav === 'support'
                      ? 'text-white shadow-sm'
                      : 'text-gray-800 hover:bg-gymnext-background'
                  }`}
                  style={mainNav === 'support' ? { backgroundColor: '#6B21A8' } : undefined}
                  aria-current={mainNav === 'support' ? 'page' : undefined}
                >
                  <ArchiveRestore className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                  Recover Deleted Items
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setAccountOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-3 text-left text-sm font-semibold text-gray-800 hover:bg-gymnext-background/80"
              aria-expanded={accountOpen}
              aria-controls="main-nav-account-panel"
            >
              <span className="flex items-center gap-3 min-w-0">
                <Users className="h-5 w-5 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
                Account
              </span>
              {accountOpen ? (
                <ChevronDown className="h-5 w-5 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
              ) : (
                <ChevronUp className="h-5 w-5 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
              )}
            </button>
          </div>
        </div>
    </aside>
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
  title = 'Create favorite',
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
  const [workoutDetails, setWorkoutDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Multi-segment: pending segments before create (at least one required)
  const [pendingSegments, setPendingSegments] = useState<WorkoutSegment[]>([])
  const [addSegmentOpen, setAddSegmentOpen] = useState(false)
  const [addSegmentStep, setAddSegmentStep] = useState<1 | 2 | 3>(1)
  const [newSegmentMode, setNewSegmentMode] = useState(1)
  const [newSegmentOptions, setNewSegmentOptions] = useState<Record<string, string | number>>(() => getDefaultOptionsForMode(1))
  const [newSegmentName, setNewSegmentName] = useState('')
  const [newSegmentDescription, setNewSegmentDescription] = useState('')
  const [newSegmentDetails, setNewSegmentDetails] = useState('')
  const [newSegmentError, setNewSegmentError] = useState<string | null>(null)

  const built = useMemo(() => {
    if (isMultiSegment(mode)) return { workoutSchedule: '', direction: false }
    return buildWorkoutFromCreateForm(mode, options) as { workoutSchedule: string; direction: boolean }
  }, [mode, options])

  function handleAddSegmentNext() {
    if (addSegmentStep === 1) {
      if (!hasValidDurationForMode(newSegmentMode, newSegmentOptions, parseDurationInput)) {
        setNewSegmentError('Warmup, Cooldown, Rest, and other segments require a valid duration.')
        return
      }
      setNewSegmentError(null)
      setAddSegmentStep(2)
    } else if (addSegmentStep === 2 && newSegmentMode === 3) {
      setAddSegmentStep(3)
    }
  }

  function handleAddSegmentConfirm() {
    if (!hasValidDurationForMode(newSegmentMode, newSegmentOptions, parseDurationInput)) {
      setNewSegmentError('Warmup, Cooldown, Rest, and other segments require a valid duration.')
      return
    }
    setNewSegmentError(null)
    const builtSeg = buildWorkoutFromCreateForm(newSegmentMode, newSegmentOptions) as { workoutSchedule: string }
    setPendingSegments((prev) => {
      const index = prev.length
      const next: WorkoutSegment = {
        workoutId: `pending-seg-${index}`,
        workoutName: newSegmentName.trim() || null,
        workoutDescription: newSegmentDescription.trim() || null,
        workoutDetails: newSegmentDetails.trim() || null,
        workoutSchedule: builtSeg.workoutSchedule,
      }
      return [...prev, next]
    })
    setAddSegmentOpen(false)
    setAddSegmentStep(1)
  }

  async function handleCreate() {
    if (isMultiSegment(mode) && pendingSegments.length === 0) {
      setError('Add at least one segment before creating the workout.')
      return
    }
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
        const segmentsWithIds = pendingSegments.map((seg, i) => ({
          ...seg,
          workoutId: `${created.id}-seg-${i}`,
        }))
        await onSaveWorkout(created.id, {
          workoutName: name.trim() || null,
          workoutDescription: description.trim() || null,
          segments: segmentsWithIds,
        })
        onCreated({
          ...created,
          workoutName: name.trim() || null,
          workoutDescription: description.trim() || null,
          segments: segmentsWithIds,
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
        if (name.trim() || description.trim() || workoutDetails.trim()) {
          await onSaveWorkout(created.id, {
            workoutName: name.trim() || null,
            workoutDescription: description.trim() || null,
            workoutDetails: workoutDetails.trim() || null,
          })
        }
        onCreated({
          ...created,
          workoutName: name.trim() || null,
          workoutDescription: description.trim() || null,
          workoutDetails: workoutDetails.trim() || null,
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
      <div className="relative w-full max-w-lg rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
        <div className="border-b border-gymnext-muted/30 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-800">
            {title}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {step === 1 && 'Choose the workout type.'}
            {step === 2 && (isMultiSegment(mode) ? 'Add at least one segment.' : mode === 3 ? 'Add and order your intervals.' : 'Configure the timer settings for this workout.')}
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
                    if (newMode !== 100) setPendingSegments([])
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
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    Add at least one segment. You can reorder or remove segments below.
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-gray-700">Segments ({pendingSegments.length})</span>
                    <button
                      type="button"
                      onClick={() => {
                        setNewSegmentMode(1)
                        setNewSegmentOptions(getDefaultOptionsForMode(1))
                        setNewSegmentName('')
                        setNewSegmentDescription('')
                        setNewSegmentDetails('')
                        setNewSegmentError(null)
                        setAddSegmentStep(1)
                        setAddSegmentOpen(true)
                      }}
                      className="rounded text-white text-xs font-medium px-2 py-1.5 hover:opacity-90"
                      style={{ backgroundColor: '#6B21A8' }}
                    >
                      Add segment
                    </button>
                  </div>
                  <ul className="space-y-2 max-h-[30vh] overflow-y-auto rounded border border-gray-200 bg-gray-50/50 p-2">
                    {pendingSegments.length === 0 ? (
                      <li className="text-xs text-gray-500 py-2">No segments yet. Click &quot;Add segment&quot; to add one.</li>
                    ) : (
                      pendingSegments.map((seg, index) => (
                        <li key={`${seg.workoutId}-${index}`} className="flex items-center justify-between gap-2 rounded border border-gray-200 bg-white p-2">
                          <span className="text-sm text-gray-900 truncate min-w-0 flex-1">{getSegmentDisplayName(seg, index)}</span>
                          <div className="inline-flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                if (index <= 0) return
                                setPendingSegments((prev) => {
                                  const next = [...prev]
                                  ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                                  return next
                                })
                              }}
                              disabled={index === 0}
                              className="h-6 w-6 inline-flex items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                              aria-label="Move up"
                              title="Move up"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (index >= pendingSegments.length - 1) return
                                setPendingSegments((prev) => {
                                  const next = [...prev]
                                  ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
                                  return next
                                })
                              }}
                              disabled={index === pendingSegments.length - 1}
                              className="h-6 w-6 inline-flex items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                              aria-label="Move down"
                              title="Move down"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingSegments((prev) => prev.filter((_, i) => i !== index))}
                              className="h-6 w-6 inline-flex items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                              aria-label="Remove segment"
                              title="Remove segment"
                            >
                              ×
                            </button>
                          </div>
                        </li>
                      ))
                    )}
                  </ul>
                  {error && pendingSegments.length === 0 && <p className="text-xs text-red-600">{error}</p>}
                </div>
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
                  disabled={isMultiSegment(mode) ? pendingSegments.length === 0 : !hasValidDurationForMode(mode, options, parseDurationInput)}
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
              {!isMultiSegment(mode) && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Workout details (optional)
                  </label>
                  <textarea
                    rows={6}
                    value={workoutDetails}
                    onChange={(e) => setWorkoutDetails(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                    placeholder="e.g. 5×5 Back Squat @ 135#, 3×10 RDL, 2×20 KB swings"
                  />
                </div>
              )}
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

      {addSegmentOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => { setAddSegmentOpen(false); setAddSegmentStep(1) }}
          />
          <div className="relative w-full max-w-lg rounded-lg bg-white shadow-lg p-4 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Add segment</h3>
                <p className="text-xs text-gray-600">
                  {addSegmentStep === 1
                    ? 'Choose the timer mode and configure the segment.'
                    : addSegmentStep === 2 && newSegmentMode === 3
                      ? 'Set repeats, rest between repeats, and timer direction.'
                      : 'Name and description (optional).'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setAddSegmentOpen(false); setAddSegmentStep(1) }}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {addSegmentStep === 1 ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Timer mode</label>
                  <select
                    value={newSegmentMode}
                    onChange={(e) => {
                      const m = Number(e.target.value)
                      setNewSegmentMode(m)
                      setNewSegmentOptions(getDefaultOptionsForMode(m))
                    }}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  >
                    {SEGMENT_CREATABLE_TIMER_MODES.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <CreateWorkoutOptions
                  mode={newSegmentMode}
                  options={newSegmentOptions}
                  onChange={setNewSegmentOptions}
                  parseDurationInput={parseDurationInput}
                  mixedIntervalsStep={newSegmentMode === 3 ? 1 : undefined}
                />
                {newSegmentError && <p className="text-xs text-red-600">{newSegmentError}</p>}
              </div>
            ) : addSegmentStep === 2 && newSegmentMode === 3 ? (
              <div className="space-y-3">
                <CreateWorkoutOptions
                  mode={3}
                  options={newSegmentOptions}
                  onChange={setNewSegmentOptions}
                  parseDurationInput={parseDurationInput}
                  mixedIntervalsStep={2}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Segment name</label>
                  <input
                    type="text"
                    value={newSegmentName}
                    onChange={(e) => setNewSegmentName(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                    placeholder={`Segment ${pendingSegments.length + 1}`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                  <input
                    type="text"
                    value={newSegmentDescription}
                    onChange={(e) => setNewSegmentDescription(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Workout details (optional)</label>
                  <textarea
                    rows={5}
                    value={newSegmentDetails}
                    onChange={(e) => setNewSegmentDetails(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                    placeholder="e.g. 5×5 Back Squat @ 135#, 3×10 RDL, 2×20 KB swings"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              {addSegmentStep === 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() => { setAddSegmentOpen(false); setAddSegmentStep(1) }}
                    className="rounded bg-gymnext-background px-3 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAddSegmentNext}
                    className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90"
                    style={{ backgroundColor: '#6B21A8' }}
                  >
                    Next
                  </button>
                </>
              ) : addSegmentStep === 2 && newSegmentMode === 3 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setAddSegmentStep(1)}
                    className="rounded bg-gymnext-background px-3 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleAddSegmentNext}
                    className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90"
                    style={{ backgroundColor: '#6B21A8' }}
                  >
                    Next
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setAddSegmentStep(newSegmentMode === 3 ? 2 : 1)}
                    className="rounded bg-gymnext-background px-3 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleAddSegmentConfirm}
                    className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90"
                    style={{ backgroundColor: '#6B21A8' }}
                  >
                    Add segment
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
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
  onDuplicateWorkout,
  onOpenContentShare,
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
  onDuplicateWorkout: (workoutId: string, collectionIds: string[]) => Promise<Workout>
  onOpenContentShare?: (target: LibraryShareTarget) => void
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

  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false)
  const [duplicateSelectedIds, setDuplicateSelectedIds] = useState<Set<string>>(new Set())
  const [duplicateBusy, setDuplicateBusy] = useState(false)
  const [duplicateError, setDuplicateError] = useState<string | null>(null)

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

  /** Reorder: toIndex = gap index (0..n). Insert at toIndex when moving up, toIndex-1 when moving down. */
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
    const visibleIdSet = new Set(favoriteWorkouts.map((w) => w.id))
    const visibleIds = currentIds.filter((id) => visibleIdSet.has(id))
    const deletedIds = currentIds.filter((id) => !visibleIdSet.has(id))
    const fromIndex = visibleIds.indexOf(draggedId)
    if (fromIndex === -1) return
    const toIndexClamped = Math.max(0, Math.min(toIndex, visibleIds.length))
    const newVisibleOrder = reorderIds(visibleIds, fromIndex, toIndexClamped)
    const newIds = [...newVisibleOrder, ...deletedIds]
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
      const patch: Record<string, unknown> = {
        workoutName: editName.trim() || null,
        workoutDescription: editDescription.trim() || null,
      }
      await onSave(editingWorkout.id, patch)
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
    <>
    <div className="grid min-h-[28rem] w-full flex-1 gap-6 lg:min-h-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.8fr)] lg:grid-rows-[minmax(0,1fr)]">
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gymnext-muted/30 bg-gymnext-background px-4 py-3">
          <h3 className="text-sm font-medium text-gray-800">
            Favorites
            {favoritesLabel}
          </h3>
          <div className="flex shrink-0 items-center gap-2">
            {favoritesCollection && (
              <button
                type="button"
                onClick={onOpenCreateDialog}
                disabled={atFavoritesLimit}
                title={atFavoritesLimit ? `Your plan allows up to ${maxFav} favorites. Upgrade to add more.` : undefined}
                className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#6B21A8' }}
              >
                Create favorite
              </button>
            )}
          </div>
        </div>
        {reorderError && (
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-4 py-2">
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
        <div className="min-h-0 flex-1 overflow-y-auto">
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
            className="divide-y divide-gray-200"
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const draggedId = e.dataTransfer.getData('text/plain')
              if (!draggedId || !favoritesCollection) return
              const visibleIds = (optimisticOrderedIds ?? favoritesCollection.workoutIds).filter((id) =>
                favoriteWorkouts.some((w) => w.id === id)
              )
              const toIndex = dropIndicatorBeforeIndex ?? visibleIds.length
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
                if (!draggedId || !favoritesCollection) return
                const visibleIds = (optimisticOrderedIds ?? favoritesCollection.workoutIds).filter((id) =>
                  favoriteWorkouts.some((w) => w.id === id)
                )
                const rect = e.currentTarget.getBoundingClientRect()
                const midY = rect.top + rect.height / 2
                const toIndex = dropIndicatorBeforeIndex ?? (e.clientY < midY ? index : index + 1)
                handleFavoriteDrop(draggedId, Math.max(0, Math.min(toIndex, visibleIds.length)))
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
                className={`pl-3 pr-4 py-3 flex items-center gap-3 hover:bg-gray-100 ${
                  isDragging ? 'opacity-50' : ''
                }`}
              >
                <span
                  className="w-1 shrink-0 rounded-full self-stretch min-h-[3rem]"
                  style={{ backgroundColor: barColor }}
                  aria-hidden
                />
                <span
                  draggable
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  className="w-6 shrink-0 flex items-center justify-center text-gray-400 cursor-grab active:cursor-grabbing touch-none"
                  aria-hidden
                  title="Drag to reorder"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DragReorderGrip />
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
                    {getWorkoutDetailDescription(w) || '—'}
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
      </div>

      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white">
        {selectedWorkout ? (
          <>
            <div className="relative flex shrink-0 items-start justify-between gap-2 border-b border-gray-100 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">
                  {getWorkoutDisplayName(selectedWorkout) || selectedWorkout.workoutId}
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  {getWorkoutDetailDescription(selectedWorkout) || '—'}
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
                      {onOpenContentShare && (
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                          onClick={() => {
                            setMoreMenuOpen(false)
                            onOpenContentShare({
                              kind: 'workout',
                              id: selectedWorkout.id,
                              title: getWorkoutDisplayName(selectedWorkout) || selectedWorkout.workoutId,
                            })
                          }}
                        >
                          Share workout
                        </button>
                      )}
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
                        Update collections
                      </button>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        onClick={() => {
                          setMoreMenuOpen(false)
                          setDuplicateSelectedIds(new Set())
                          setDuplicateError(null)
                          setDuplicateDialogOpen(true)
                        }}
                      >
                        Duplicate workout
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
            <div className="min-h-0 flex-1 overflow-y-auto">
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
          <div className="flex flex-1 items-center justify-center px-4 py-12 text-center text-sm text-gray-500">
            Select a workout to see its details
          </div>
        )}
      </div>
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
              <h3 className="text-sm font-semibold text-gray-800">Update collections</h3>
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

      {duplicateDialogOpen && selectedWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !duplicateBusy && setDuplicateDialogOpen(false)}
          />
          <div className="relative flex max-h-[80vh] w-full max-w-sm flex-col rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
            <div className="shrink-0 border-b border-gymnext-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">Duplicate workout</h3>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {duplicateError && (
                <p className="mb-2 px-2 text-xs text-red-600" role="alert">
                  {duplicateError}
                </p>
              )}
              {allCollections.map((c) => {
                const isChecked = duplicateSelectedIds.has(c.id)
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
                      setDuplicateSelectedIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(c.id)) next.delete(c.id)
                        else next.add(c.id)
                        return next
                      })
                    }}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
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
                    <span className="truncate text-sm font-medium text-gray-900">{displayName}</span>
                  </button>
                )
              })}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-gymnext-muted/30 px-4 py-3">
              <button
                type="button"
                onClick={() => setDuplicateDialogOpen(false)}
                disabled={duplicateBusy}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={duplicateBusy || duplicateSelectedIds.size === 0}
                onClick={async () => {
                  if (!selectedWorkout) return
                  setDuplicateBusy(true)
                  setDuplicateError(null)
                  try {
                    await onDuplicateWorkout(selectedWorkout.id, [...duplicateSelectedIds])
                    setDuplicateDialogOpen(false)
                  } catch (e) {
                    setDuplicateError(e instanceof Error ? e.message : 'Failed to duplicate workout')
                  } finally {
                    setDuplicateBusy(false)
                  }
                }}
                className="rounded px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#6B21A8' }}
              >
                {duplicateBusy ? 'Duplicating…' : 'Duplicate'}
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
              Delete this workout?
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
    </>
  )
}

function trimWorkoutDetailsForPreview(workout: {
  type?: string
  workoutDetails?: string | null
}): string {
  if (workout.type === 'MultiSegmentWorkout') return ''
  return (workout.workoutDetails ?? '').trim()
}

function WorkoutDetailsPreview({ details }: { details: string }) {
  const [expanded, setExpanded] = useState(false)
  const [truncates, setTruncates] = useState(false)
  const contentRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    setExpanded(false)
  }, [details])

  useEffect(() => {
    if (expanded) return
    const el = contentRef.current
    if (!el) return
    const id = requestAnimationFrame(() => {
      setTruncates(el.scrollHeight > el.clientHeight + 1)
    })
    return () => cancelAnimationFrame(id)
  }, [details, expanded])

  return (
    <div className="mb-4 border-b border-gray-200 pb-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Workout details</p>
      <p
        ref={contentRef}
        className={`whitespace-pre-wrap break-words text-sm text-gray-800 ${expanded ? '' : 'line-clamp-3'}`}
      >
        {details}
      </p>
      {truncates && (
        <button
          type="button"
          className="mt-2 text-xs font-medium hover:underline"
          style={{ color: '#6B21A8' }}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? 'Show less' : 'Expand…'}
        </button>
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
  const [workoutDetails, setWorkoutDetails] = useState(() =>
    workout.type === 'SingleSegmentWorkout'
      ? ((workout as { workoutDetails?: string | null }).workoutDetails ?? '')
      : ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  const isSingle = workout.type === 'SingleSegmentWorkout'
  const parsed = useMemo(
    () =>
      isSingle
        ? parseScheduleToOptions(workout.workoutSchedule, workout.timerMode)
        : null,
    [isSingle, workout.workoutSchedule, workout.timerMode]
  )
  const [scheduleMode, setScheduleMode] = useState(parsed?.mode ?? 1)

  const [scheduleOptions, setScheduleOptions] = useState<Record<string, string | number>>(parsed?.options ?? {})
  const [scheduleDirection, setScheduleDirection] = useState(parsed?.direction ?? false)

  const [segments, setSegments] = useState<WorkoutSegment[]>(
    workout.type === 'MultiSegmentWorkout' && workout.segments ? [...workout.segments] : []
  )
  // State for the "Add segment" dialog (step 1 = timer config; for Mixed Intervals: step 2 = repeats/rest/direction, step 3 = name/description)
  const [addSegmentOpen, setAddSegmentOpen] = useState(false)
  const [addSegmentStep, setAddSegmentStep] = useState<1 | 2 | 3>(1)
  const [newSegmentMode, setNewSegmentMode] = useState<number>(1)
  const [newSegmentOptions, setNewSegmentOptions] = useState<Record<string, string | number>>(
    () => getDefaultOptionsForMode(1)
  )
  const [newSegmentName, setNewSegmentName] = useState('')
  const [newSegmentDescription, setNewSegmentDescription] = useState('')
  const [newSegmentDetails, setNewSegmentDetails] = useState('')
  const [newSegmentError, setNewSegmentError] = useState<string | null>(null)

  // State for the "Edit segment" dialog (same step flow as Add segment)
  const [editSegmentIndex, setEditSegmentIndex] = useState<number | null>(null)
  const [editSegmentStep, setEditSegmentStep] = useState<1 | 2 | 3>(1)
  const [editSegmentMode, setEditSegmentMode] = useState<number>(1)
  const [editSegmentOptions, setEditSegmentOptions] = useState<Record<string, string | number>>(
    () => getDefaultOptionsForMode(1)
  )
  const [editSegmentName, setEditSegmentName] = useState('')
  const [editSegmentDescription, setEditSegmentDescription] = useState('')
  const [editSegmentDetails, setEditSegmentDetails] = useState('')
  const [editSegmentError, setEditSegmentError] = useState<string | null>(null)

  useEffect(() => {
    setName(workout.workoutName ?? '')
    setDescription(workout.workoutDescription ?? '')
    setWorkoutDetails(
      workout.type === 'SingleSegmentWorkout'
        ? ((workout as { workoutDetails?: string | null }).workoutDetails ?? '')
        : ''
    )
    setIsDirty(false)
  }, [
    workout.id,
    workout.workoutName,
    workout.workoutDescription,
    workout.type,
    workout.type === 'SingleSegmentWorkout'
      ? (workout as { workoutDetails?: string | null }).workoutDetails
      : null,
  ])

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
          workoutDetails: workoutDetails.trim() || null,
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
    workoutDetails,
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
    if (editSegmentIndex === index) setEditSegmentIndex(target)
    else if (editSegmentIndex === target) setEditSegmentIndex(index)
  }

  function deleteSegment(index: number) {
    setSegments((prev) => prev.filter((_, i) => i !== index))
    setIsDirty(true)
    if (editSegmentIndex === index) setEditSegmentIndex(null)
    else if (editSegmentIndex != null && editSegmentIndex > index) setEditSegmentIndex(editSegmentIndex - 1)
  }

  function addSegment() {
    setNewSegmentMode(1)
    setNewSegmentOptions(getDefaultOptionsForMode(1))
    setNewSegmentName('')
    setNewSegmentDescription('')
    setNewSegmentDetails('')
    setNewSegmentError(null)
    setAddSegmentStep(1)
    setAddSegmentOpen(true)
  }

  function handleAddSegmentNext() {
    if (addSegmentStep === 1) {
      if (!hasValidDurationForMode(newSegmentMode, newSegmentOptions, parseDurationInput)) {
        setNewSegmentError('Warmup, Cooldown, Rest, and other segments require a valid duration.')
        return
      }
      setNewSegmentError(null)
      setAddSegmentStep(2)
    } else if (addSegmentStep === 2 && newSegmentMode === 3) {
      setAddSegmentStep(3)
    }
  }

  function updateSegment(index: number, updates: Partial<WorkoutSegment>) {
    setSegments((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...updates } : s))
    )
    setIsDirty(true)
  }

  function openEditSegment(index: number) {
    const seg = segments[index]
    if (!seg) return
    const parsed = parseScheduleToOptions(seg.workoutSchedule ?? undefined)
    setEditSegmentMode(parsed.mode)
    setEditSegmentOptions(parsed.options)
    setEditSegmentName(seg.workoutName ?? '')
    setEditSegmentDescription(seg.workoutDescription ?? '')
    setEditSegmentDetails(seg.workoutDetails ?? '')
    setEditSegmentStep(1)
    setEditSegmentError(null)
    setEditSegmentIndex(index)
  }

  function handleEditSegmentNext() {
    if (editSegmentStep === 1) {
      if (!hasValidDurationForMode(editSegmentMode, editSegmentOptions, parseDurationInput)) {
        setEditSegmentError('Warmup, Cooldown, Rest, and other segments require a valid duration.')
        return
      }
      setEditSegmentError(null)
      setEditSegmentStep(2)
    } else if (editSegmentStep === 2 && editSegmentMode === 3) {
      setEditSegmentStep(3)
    }
  }

  function handleEditSegmentSave() {
    if (editSegmentIndex == null) return
    if (!hasValidDurationForMode(editSegmentMode, editSegmentOptions, parseDurationInput)) {
      setEditSegmentError('Warmup, Cooldown, Rest, and other segments require a valid duration.')
      return
    }
    setEditSegmentError(null)
    const built = buildWorkoutFromCreateForm(
      editSegmentMode,
      editSegmentOptions
    ) as { workoutSchedule: string }
    updateSegment(editSegmentIndex, {
      workoutName: editSegmentName.trim() || null,
      workoutDescription: editSegmentDescription.trim() || null,
      workoutDetails: editSegmentDetails.trim() || null,
      workoutSchedule: built.workoutSchedule,
    })
    setEditSegmentIndex(null)
    setEditSegmentStep(1)
  }

  function handleAddSegmentConfirm() {
    if (!hasValidDurationForMode(newSegmentMode, newSegmentOptions, parseDurationInput)) {
      setNewSegmentError('Warmup, Cooldown, Rest, and other segments require a valid duration.')
      return
    }
    setNewSegmentError(null)
    const built = buildWorkoutFromCreateForm(
      newSegmentMode,
      newSegmentOptions
    ) as { workoutSchedule: string }
    setSegments((prev) => {
      const index = prev.length
      const next: WorkoutSegment = {
        workoutId: `${workout.workoutId}-seg-${index}`,
        workoutName: newSegmentName.trim() || null,
        workoutDescription: newSegmentDescription.trim() || null,
        workoutDetails: newSegmentDetails.trim() || null,
        workoutSchedule: built.workoutSchedule,
      }
      return [...prev, next]
    })
    setIsDirty(true)
    setAddSegmentOpen(false)
    setAddSegmentStep(1)
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
        <div>
          <label htmlFor="fav-workout-details" className="block text-xs font-medium text-gray-700 mb-1">
            Workout details (optional)
          </label>
          <textarea
            id="fav-workout-details"
            rows={3}
            value={workoutDetails}
            onChange={(e) => {
              setWorkoutDetails(e.target.value)
              setIsDirty(true)
            }}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
            placeholder="e.g. 5×5 Back Squat @ 135#, 3×10 RDL, 2×20 KB swings"
          />
        </div>
      )}

      {isSingle && (
        <div className="space-y-3">
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
                  <button
                    type="button"
                    onClick={() => openEditSegment(index)}
                    className="text-left text-sm font-medium text-gray-900 truncate flex-1 hover:underline"
                  >
                    {getSegmentDisplayName(seg, index)}
                  </button>
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
                      onClick={() => deleteSegment(index)}
                      className="h-6 w-6 inline-flex items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                      aria-label="Remove segment"
                      title="Remove segment"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {addSegmentOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => { setAddSegmentOpen(false); setAddSegmentStep(1) }}
          />
          <div className="relative w-full max-w-lg rounded-lg bg-white shadow-lg p-4 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Add segment</h3>
                <p className="text-xs text-gray-600">
                  {addSegmentStep === 1
                    ? 'Choose the timer mode and configure the segment.'
                    : addSegmentStep === 2 && newSegmentMode === 3
                      ? 'Set repeats, rest between repeats, and timer direction.'
                      : 'Name and description (optional).'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setAddSegmentOpen(false); setAddSegmentStep(1) }}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {addSegmentStep === 1 ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Timer mode
                  </label>
                  <select
                    value={newSegmentMode}
                    onChange={(e) => {
                      const m = Number(e.target.value)
                      setNewSegmentMode(m)
                      setNewSegmentOptions(getDefaultOptionsForMode(m))
                    }}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  >
                    {SEGMENT_CREATABLE_TIMER_MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <CreateWorkoutOptions
                  mode={newSegmentMode}
                  options={newSegmentOptions}
                  onChange={setNewSegmentOptions}
                  parseDurationInput={parseDurationInput}
                  mixedIntervalsStep={newSegmentMode === 3 ? 1 : undefined}
                />

                {newSegmentError && (
                  <p className="text-xs text-red-600">{newSegmentError}</p>
                )}
              </div>
            ) : addSegmentStep === 2 && newSegmentMode === 3 ? (
              <div className="space-y-3">
                <CreateWorkoutOptions
                  mode={3}
                  options={newSegmentOptions}
                  onChange={setNewSegmentOptions}
                  parseDurationInput={parseDurationInput}
                  mixedIntervalsStep={2}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Segment name
                  </label>
                  <input
                    type="text"
                    value={newSegmentName}
                    onChange={(e) => setNewSegmentName(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                    placeholder={`Segment ${segments.length + 1}`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={newSegmentDescription}
                    onChange={(e) => setNewSegmentDescription(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Workout details (optional)
                  </label>
                  <textarea
                    rows={5}
                    value={newSegmentDetails}
                    onChange={(e) => setNewSegmentDetails(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                    placeholder="e.g. 5×5 Back Squat @ 135#, 3×10 RDL, 2×20 KB swings"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              {addSegmentStep === 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() => { setAddSegmentOpen(false); setAddSegmentStep(1) }}
                    className="rounded bg-gymnext-background px-3 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAddSegmentNext}
                    className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90"
                    style={{ backgroundColor: '#6B21A8' }}
                  >
                    Next
                  </button>
                </>
              ) : addSegmentStep === 2 && newSegmentMode === 3 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setAddSegmentStep(1)}
                    className="rounded bg-gymnext-background px-3 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleAddSegmentNext}
                    className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90"
                    style={{ backgroundColor: '#6B21A8' }}
                  >
                    Next
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setAddSegmentStep(newSegmentMode === 3 ? 2 : 1)}
                    className="rounded bg-gymnext-background px-3 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleAddSegmentConfirm}
                    className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90"
                    style={{ backgroundColor: '#6B21A8' }}
                  >
                    Add segment
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {editSegmentIndex != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => { setEditSegmentIndex(null); setEditSegmentStep(1) }}
          />
          <div className="relative w-full max-w-lg rounded-lg bg-white shadow-lg p-4 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Edit segment</h3>
                <p className="text-xs text-gray-600">
                  {editSegmentStep === 1
                    ? 'Choose the timer mode and configure the segment.'
                    : editSegmentStep === 2 && editSegmentMode === 3
                      ? 'Set repeats, rest between repeats, and timer direction.'
                      : 'Name and description (optional).'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setEditSegmentIndex(null); setEditSegmentStep(1) }}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {editSegmentStep === 1 ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Timer mode
                  </label>
                  <select
                    value={editSegmentMode}
                    onChange={(e) => {
                      const m = Number(e.target.value)
                      setEditSegmentMode(m)
                      setEditSegmentOptions(getDefaultOptionsForMode(m))
                    }}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                  >
                    {SEGMENT_CREATABLE_TIMER_MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <CreateWorkoutOptions
                  mode={editSegmentMode}
                  options={editSegmentOptions}
                  onChange={setEditSegmentOptions}
                  parseDurationInput={parseDurationInput}
                  mixedIntervalsStep={editSegmentMode === 3 ? 1 : undefined}
                />

                {editSegmentError && (
                  <p className="text-xs text-red-600">{editSegmentError}</p>
                )}
              </div>
            ) : editSegmentStep === 2 && editSegmentMode === 3 ? (
              <div className="space-y-3">
                <CreateWorkoutOptions
                  mode={3}
                  options={editSegmentOptions}
                  onChange={setEditSegmentOptions}
                  parseDurationInput={parseDurationInput}
                  mixedIntervalsStep={2}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Segment name
                  </label>
                  <input
                    type="text"
                    value={editSegmentName}
                    onChange={(e) => setEditSegmentName(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                    placeholder={`Segment ${editSegmentIndex + 1}`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={editSegmentDescription}
                    onChange={(e) => setEditSegmentDescription(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Workout details (optional)
                  </label>
                  <textarea
                    rows={5}
                    value={editSegmentDetails}
                    onChange={(e) => setEditSegmentDetails(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                    placeholder="e.g. 5×5 Back Squat @ 135#, 3×10 RDL, 2×20 KB swings"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              {editSegmentStep === 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() => { setEditSegmentIndex(null); setEditSegmentStep(1) }}
                    className="rounded bg-gymnext-background px-3 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleEditSegmentNext}
                    className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90"
                    style={{ backgroundColor: '#6B21A8' }}
                  >
                    Next
                  </button>
                </>
              ) : editSegmentStep === 2 && editSegmentMode === 3 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setEditSegmentStep(1)}
                    className="rounded bg-gymnext-background px-3 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleEditSegmentNext}
                    className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90"
                    style={{ backgroundColor: '#6B21A8' }}
                  >
                    Next
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setEditSegmentStep(editSegmentMode === 3 ? 2 : 1)}
                    className="rounded bg-gymnext-background px-3 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleEditSegmentSave}
                    className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90"
                    style={{ backgroundColor: '#6B21A8' }}
                  >
                    Save
                  </button>
                </>
              )}
            </div>
          </div>
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

/** 2×3 dot grip for reorder rows (matches stripe → grip → icon layout). */
function DragReorderGrip() {
  return (
    <span
      className="grid grid-cols-2 gap-x-[3px] gap-y-[2px] leading-none select-none"
      aria-hidden
    >
      {Array.from({ length: 6 }, (__, i) => (
        <span key={i} className="h-[2px] w-[2px] shrink-0 rounded-full bg-gray-300" />
      ))}
    </span>
  )
}

function CollectionFolderIcon({ className = 'text-amber-800' }: { className?: string }) {
  return (
    <span className={`shrink-0 ${className}`} aria-hidden>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <path d="M19.5 21a3 3 0 003-3v-4.875a3 3 0 00-.684-1.9l-1.425-1.9a3 3 0 00-2.4-1.2H15.75l-.787-1.05A3 3 0 0012.422 6H4.5a3 3 0 00-3 3v9a3 3 0 003 3h15z" />
      </svg>
    </span>
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
  onDuplicateWorkout,
  onOpenContentShare,
  expandWorkoutIdWhenDetailMatches,
  onConsumedExpandWorkoutRequest,
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
  onDuplicateWorkout: (workoutId: string, collectionIds: string[]) => Promise<Workout>
  onOpenContentShare?: (target: LibraryShareTarget) => void
  /** When set and `collectionDetail` contains this workout id, expand that row (e.g. deep-link from feed). */
  expandWorkoutIdWhenDetailMatches?: string | null
  onConsumedExpandWorkoutRequest?: () => void
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

  useEffect(() => {
    const raw = expandWorkoutIdWhenDetailMatches?.trim()
    if (!raw || !collectionDetail?.workouts?.length) return
    if (!collectionDetail.workouts.some((w) => w.id === raw)) return
    setExpandedWorkoutId(raw)
    onConsumedExpandWorkoutRequest?.()
  }, [collectionDetail, expandWorkoutIdWhenDetailMatches, onConsumedExpandWorkoutRequest])

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [unsavedConfirmOpen, setUnsavedConfirmOpen] = useState(false)
  type PendingUnsavedAction =
    | { type: 'expand'; nextExpandedId: string | null }
    | { type: 'createWorkout' }
    | { type: 'updateBookmarks'; workout: Workout }
    | { type: 'duplicateWorkout'; workout: Workout }
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
      case 'duplicateWorkout': {
        const w = pendingUnsavedAction.workout
        setCollectionDuplicateWorkout(w)
        setCollectionDuplicateSelectedIds(new Set())
        setCollectionDuplicateError(null)
        setCollectionDuplicateDialogOpen(true)
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

  const [collectionDuplicateDialogOpen, setCollectionDuplicateDialogOpen] = useState(false)
  const [collectionDuplicateWorkout, setCollectionDuplicateWorkout] = useState<Workout | null>(null)
  const [collectionDuplicateSelectedIds, setCollectionDuplicateSelectedIds] = useState<Set<string>>(new Set())
  const [collectionDuplicateBusy, setCollectionDuplicateBusy] = useState(false)
  const [collectionDuplicateError, setCollectionDuplicateError] = useState<string | null>(null)

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
      const patch: Record<string, unknown> = {
        workoutName: editMetaName.trim() || null,
        workoutDescription: editMetaDescription.trim() || null,
      }
      await onSaveWorkout(editMetaWorkout.id, patch)
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
    <>
    <div className="grid min-h-[28rem] w-full flex-1 gap-6 lg:min-h-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.8fr)] lg:grid-rows-[minmax(0,1fr)]">
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gymnext-muted/30 bg-gymnext-background px-4 py-3">
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
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-4 py-2">
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
        <div className="min-h-0 flex-1 overflow-y-auto">
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
                  className={`pl-3 pr-4 py-3 flex items-center gap-3 cursor-pointer bg-white ${index > 0 ? 'border-t border-gray-200' : ''} ${
                    isSelected ? '' : 'hover:bg-gray-100'
                  } ${draggedCollectionIndex === index ? 'opacity-50' : ''}`}
                >
                  <span
                    className="w-1 shrink-0 rounded-full self-stretch min-h-[3rem]"
                    style={{ backgroundColor: '#b45309' }}
                    aria-hidden
                  />
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
                    <DragReorderGrip />
                  </span>
                  {isSelected && (
                    <span className="shrink-0 text-amber-800" aria-label="Active collection">
                      ✓
                    </span>
                  )}
                  <CollectionFolderIcon className={isSelected ? 'text-amber-800' : 'text-amber-700/80'} />
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
      </div>

      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white">
        {collectionLoading && (
          <p className="shrink-0 px-4 py-6 text-sm text-gray-500">Loading collection…</p>
        )}
        {collectionError && (
          <div className="shrink-0 bg-red-50 px-4 py-2 text-xs text-red-700">
            {collectionError}
          </div>
        )}
        {!collectionLoading && !collectionDetail && !collectionError && (
          <p className="flex flex-1 items-center justify-center px-4 py-6 text-center text-sm text-gray-500">
            Select a collection to see its details
          </p>
        )}
        {collectionDetail && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="relative flex shrink-0 items-start justify-between gap-2 border-b border-gray-100 px-4 pb-3 pt-4">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {collectionDetail.collection.workoutCollectionName}
                </p>
                <p className="text-xs text-gray-500">
                  {getCollectionDisplayDescription({
                    workoutCollectionDescription:
                      collectionDetail.collection.workoutCollectionDescription,
                    workoutIds:
                      optimisticWorkoutIds ?? collectionDetail.collection.workoutIds,
                  })}
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
                      {onOpenContentShare && (
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                          onClick={() => {
                            setCollectionMoreMenuOpen(false)
                            onOpenContentShare({
                              kind: 'collection',
                              id: collectionDetail.collection.id,
                              title: collectionDetail.collection.workoutCollectionName,
                            })
                          }}
                        >
                          Share collection
                        </button>
                      )}
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
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3">
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
                      className={`pl-3 pr-3 py-2 flex items-center gap-3 bg-white ${index > 0 ? 'border-t border-gray-200' : ''} ${isDragging ? 'opacity-50' : ''} hover:bg-gymnext-background/50`}
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
                        className="w-1 shrink-0 rounded-full self-stretch min-h-[3rem]"
                        style={{ backgroundColor: barColor }}
                        aria-hidden
                      />
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
                        <DragReorderGrip />
                      </span>
                      <div
                        className="min-w-0 flex-1 cursor-pointer py-0.5"
                        onClick={() => handleExpandWorkoutClick(isExpanded ? null : w.id)}
                      >
                        <div className="text-sm font-medium text-gray-900">
                          {getWorkoutDisplayName(w) || w.workoutId}
                        </div>
                        <div className="text-sm text-gray-600 mt-0.5">
                          {getWorkoutDetailDescription(w) || '—'}
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
                              {onOpenContentShare && (
                                <button
                                  type="button"
                                  className="w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-100"
                                  onClick={() => {
                                    setCollectionWorkoutMenuOpenId(null)
                                    setCollectionWorkoutMenuAnchorRect(null)
                                    onOpenContentShare({
                                      kind: 'workout',
                                      id: w.id,
                                      title: getWorkoutDisplayName(w) || w.workoutId,
                                    })
                                  }}
                                >
                                  Share workout
                                </button>
                              )}
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
                                Update collections
                              </button>
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm text-gray-900 hover:bg-gray-100"
                                onClick={() => {
                                  setCollectionWorkoutMenuOpenId(null)
                                  setCollectionWorkoutMenuAnchorRect(null)
                                  if (hasUnsavedChanges) {
                                    setPendingUnsavedAction({ type: 'duplicateWorkout', workout: w })
                                    setUnsavedConfirmOpen(true)
                                  } else {
                                    setCollectionDuplicateWorkout(w)
                                    setCollectionDuplicateSelectedIds(new Set())
                                    setCollectionDuplicateError(null)
                                    setCollectionDuplicateDialogOpen(true)
                                  }
                                }}
                              >
                                Duplicate workout
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
                          <div className="max-h-[min(85dvh,52rem)] overflow-y-auto p-4">
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
            </div>
            <div className="flex shrink-0 justify-end border-t border-gray-100 px-4 py-3">
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
              Delete this collection?
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
              <h3 className="text-sm font-semibold text-gray-800">Update collections</h3>
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

      {collectionDuplicateDialogOpen && collectionDuplicateWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !collectionDuplicateBusy && setCollectionDuplicateDialogOpen(false)}
          />
          <div className="relative flex max-h-[80vh] w-full max-w-sm flex-col rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
            <div className="shrink-0 border-b border-gymnext-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">Duplicate workout</h3>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {collectionDuplicateError && (
                <p className="mb-2 px-2 text-xs text-red-600" role="alert">
                  {collectionDuplicateError}
                </p>
              )}
              {allCollections.map((c) => {
                const isChecked = collectionDuplicateSelectedIds.has(c.id)
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
                      setCollectionDuplicateSelectedIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(c.id)) next.delete(c.id)
                        else next.add(c.id)
                        return next
                      })
                    }}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
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
                    <span className="truncate text-sm font-medium text-gray-900">{displayName}</span>
                  </button>
                )
              })}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-gymnext-muted/30 px-4 py-3">
              <button
                type="button"
                onClick={() => setCollectionDuplicateDialogOpen(false)}
                disabled={collectionDuplicateBusy}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={collectionDuplicateBusy || collectionDuplicateSelectedIds.size === 0}
                onClick={async () => {
                  if (!collectionDuplicateWorkout) return
                  setCollectionDuplicateBusy(true)
                  setCollectionDuplicateError(null)
                  try {
                    await onDuplicateWorkout(
                      collectionDuplicateWorkout.id,
                      [...collectionDuplicateSelectedIds]
                    )
                    setCollectionDuplicateDialogOpen(false)
                    setCollectionDuplicateWorkout(null)
                  } catch (e) {
                    setCollectionDuplicateError(
                      e instanceof Error ? e.message : 'Failed to duplicate workout'
                    )
                  } finally {
                    setCollectionDuplicateBusy(false)
                  }
                }}
                className="rounded px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#6B21A8' }}
              >
                {collectionDuplicateBusy ? 'Duplicating…' : 'Duplicate'}
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
              Delete this workout?
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
    </>
  )
}

function planDisplayDescription(plan: WorkoutPlan): string {
  const raw = plan.workoutPlanDescription?.trim()
  if (raw) return raw
  if (plan.isPersonal) return 'A personal plan'
  return plan.trainingIntent === 1 ? 'A group training plan' : 'A private training plan'
}

function planTrainingKindLabel(plan: WorkoutPlan): string {
  if (plan.isPersonal) return 'Personal'
  return plan.trainingIntent === 1 ? 'Group training' : 'Private training'
}

/** Header subtitle: "Kind • user description", or the same default copy as the list when description is null. */
function planSubtitleWithKind(plan: WorkoutPlan): string {
  const kind = planTrainingKindLabel(plan)
  const raw = plan.workoutPlanDescription?.trim()
  if (raw) return `${kind} • ${raw}`
  return planDisplayDescription(plan)
}

/** Legacy plans omit `showInSchedule`; treat as on. Only explicit `false` hides from Today. */
function planShowsInTodayTab(plan: WorkoutPlan): boolean {
  return plan.showInSchedule !== false
}

/** True when followed plan is non-personal group training (visibility rules); else privileges copy. */
function followedPlanIsGroupTraining(row: FollowingPlanRow): boolean {
  if (row.remotePlanIsPersonal === true) return false
  return row.remotePlanTrainingIntent === 1
}

/** Synthetic plan row for Plans / Plan Ahead when viewing a followed (remote) plan. */
function followingSubscriptionToWorkoutPlan(row: FollowingPlanRow): WorkoutPlan {
  const desc = row.remotePlanDescription?.trim() || null
  const isPersonal = row.remotePlanIsPersonal === true
  const trainingIntent =
    isPersonal ? undefined : row.remotePlanTrainingIntent === 1 ? 1 : (0 as const)
  return {
    id: row.remotePlanId,
    workoutPlanId: row.remotePlanId,
    workoutPlanName: row.remotePlanName?.trim() || 'Subscribed plan',
    workoutPlanDescription: desc,
    isPersonal,
    trainingIntent,
    ordinal: row.ordinal,
    userId: row.ownerUserId,
    handle: row.remotePlanHandle,
  }
}

/** Matches plan list stripe colors (Tailwind teal-600 / teal-700). */
function planListStripeColor(isSelected: boolean): string {
  return isSelected ? '#0f766e' : '#0d9488'
}

type OwnedPlanListSection = 'personal' | 'privateTraining' | 'groupTraining'

function workoutPlanListSection(p: WorkoutPlan): OwnedPlanListSection {
  if (p.isPersonal) return 'personal'
  if (p.trainingIntent === 1) return 'groupTraining'
  return 'privateTraining'
}

function sortPlansByOrdinalThenId<T extends { id: string; ordinal: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id))
}

function orderPlansInSection<T extends { id: string; ordinal: number }>(
  sectionPlans: T[],
  optimisticIds: string[] | null
): T[] {
  if (!optimisticIds?.length) return sortPlansByOrdinalThenId(sectionPlans)
  const orderMap = new Map(optimisticIds.map((id, i) => [id, i]))
  return [...sectionPlans].sort((a, b) => {
    const ai = orderMap.get(a.id) ?? 1e9
    const bi = orderMap.get(b.id) ?? 1e9
    return ai - bi
  })
}

function orderFollowingRows(
  rows: FollowingPlanRow[],
  optimisticIds: string[] | null
): FollowingPlanRow[] {
  if (!optimisticIds?.length) {
    return [...rows].sort(
      (a, b) =>
        a.ordinal - b.ordinal || a.subscriptionDocumentId.localeCompare(b.subscriptionDocumentId)
    )
  }
  const orderMap = new Map(optimisticIds.map((id, i) => [id, i]))
  return [...rows].sort((a, b) => {
    const ai = orderMap.get(a.subscriptionDocumentId) ?? 1e9
    const bi = orderMap.get(b.subscriptionDocumentId) ?? 1e9
    return ai - bi
  })
}

function PlansSection({
  listSurfaceTitle = 'Plans',
  rightPanelMode = 'schedule',
  planAheadColumnCount,
  setPlanAheadColumnCount,
  reloadFollowingPlans,
  plans,
  selectedPlanId,
  setSelectedPlanId,
  selectedPlanIdSecondary = null,
  setSelectedPlanIdSecondary,
  scheduleSecondPlan = null,
  scheduleSecondByDay,
  followingPlans,
  followingPlansLoading,
  followingPlansError,
  selectedFollowingSubscriptionId,
  setSelectedFollowingSubscriptionId,
  weekStart,
  setWeekStart,
  weekEnd,
  weekStartSecondary,
  setWeekStartSecondary,
  weekEndSecondary,
  byDay,
  planViewMode,
  setPlanViewMode,
  planDayCount,
  planViewModeSecondary,
  setPlanViewModeSecondary,
  planDayCountSecondary,
  plansLoading,
  plansError,
  onReorderPlanned,
  onPlannedWorkoutDrop,
  onDeletePlanned,
  user,
  reloadPlanned,
  onPlannedWorkoutMetadataSaved,
  onCreatePlan,
  onUpdatePlan,
  onSetPlanShowInSchedule,
  onDeletePlan,
  maxPlans,
  plansCount,
  subscriptionTier,
  onReorderPlansInSection,
  onReorderSubscriptions,
  reorderPlansError,
  onDismissReorderPlansError,
  favoriteWorkouts,
  collectionsExcludingFavorites,
  workoutsById,
  timerDefaults,
}: {
  /** Shown in the left panel header (e.g. "Plans" vs "Plan Ahead"); UI is otherwise the same for now. */
  listSurfaceTitle?: string
  /** Plans tab: details-only right column. Plan Ahead: full schedule calendar. */
  rightPanelMode?: 'schedule' | 'plan-admin'
  /** Plan Ahead: one full-width column vs two side-by-side (lifted so nav can reset when leaving Today). */
  planAheadColumnCount: 1 | 2
  setPlanAheadColumnCount: (count: 1 | 2) => void
  /** Refetch following list after unfollow (Plans tab). */
  reloadFollowingPlans?: () => void | Promise<void>
  plans: WorkoutPlan[]
  selectedPlanId: string | null
  setSelectedPlanId: (id: string | null) => void
  selectedPlanIdSecondary?: string | null
  setSelectedPlanIdSecondary?: (id: string | null) => void
  /** Second plan on Plan Ahead (dual schedule); same editing affordances as the first. */
  scheduleSecondPlan?: WorkoutPlan | null
  scheduleSecondByDay?: Record<string, PlannedWorkout[]>
  followingPlans: FollowingPlanRow[]
  followingPlansLoading: boolean
  followingPlansError: string | null
  selectedFollowingSubscriptionId: string | null
  setSelectedFollowingSubscriptionId: (subscriptionDocumentId: string | null) => void
  weekStart: string
  setWeekStart: (value: string) => void
  weekEnd: string
  weekStartSecondary: string
  setWeekStartSecondary: (value: string) => void
  weekEndSecondary: string
  byDay: Record<string, PlannedWorkout[]>
  planViewMode: 'week' | '3day' | '1day'
  setPlanViewMode: (mode: 'week' | '3day' | '1day') => void
  planDayCount: number
  planViewModeSecondary: 'week' | '3day' | '1day'
  setPlanViewModeSecondary: (mode: 'week' | '3day' | '1day') => void
  planDayCountSecondary: number
  plansLoading: boolean
  plansError: string | null
  onReorderPlanned: (
    dayKey: string,
    index: number,
    direction: 'up' | 'down',
    planId?: string | null
  ) => void
  onPlannedWorkoutDrop: (dayKey: string, fromIndex: number, toIndex: number, planId: string) => void
  onDeletePlanned: (pw: PlannedWorkout) => void
  user: User
  reloadPlanned: () => void
  onPlannedWorkoutMetadataSaved: (
    plannedWorkoutId: string,
    patch: { workoutName?: string | null; workoutDescription?: string | null; workoutDetails?: string | null }
  ) => void
  onCreatePlan: (
    name: string,
    description: string | null,
    isPersonal: boolean,
    trainingIntent?: 0 | 1
  ) => Promise<WorkoutPlan>
  onUpdatePlan: (
    planId: string,
    name: string,
    description: string | null,
    trainingIntent?: 0 | 1
  ) => Promise<void>
  onSetPlanShowInSchedule: (planId: string, showInSchedule: boolean) => Promise<void>
  onDeletePlan: (planId: string) => Promise<void>
  maxPlans?: number
  plansCount?: number
  subscriptionTier?: SubscriptionTier
  onReorderPlansInSection?: (
    planSection: OwnedPlanListSection,
    planIds: string[]
  ) => void | Promise<void>
  onReorderSubscriptions?: (subscriptionDocumentIds: string[]) => void | Promise<void>
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
  /** Create flow: personal plan vs coach plan private/group training (maps to API isPersonal + trainingIntent). */
  const [createPlanKind, setCreatePlanKind] = useState<
    'personal' | 'privateTraining' | 'groupTraining'
  >('privateTraining')

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
  /** When Create New Workout: 0 = timer mode only, 1 = timer config (and for Mixed, sub-steps). */
  const [createNewStep, setCreateNewStep] = useState<0 | 1>(0)
  /** When Create New Workout + Mixed Interval: 1 = intervals/blocks, 2 = repeats/rest/direction. */
  const [createNewMixedStep, setCreateNewMixedStep] = useState<1 | 2>(1)
  /** When true, show the optional name/description step before Add to plan. */
  const [createNewNameStep, setCreateNewNameStep] = useState(false)
  const [createPlannedName, setCreatePlannedName] = useState('')
  const [createPlannedDescription, setCreatePlannedDescription] = useState('')
  const [createPlannedDetails, setCreatePlannedDetails] = useState('')

  const [planAdminMoreOpen, setPlanAdminMoreOpen] = useState(false)
  const [showInScheduleSaving, setShowInScheduleSaving] = useState(false)
  const [planShareOpen, setPlanShareOpen] = useState(false)
  const planShareWasOpenRef = useRef(false)
  const [planSharesLoading, setPlanSharesLoading] = useState(false)
  const [planSharesError, setPlanSharesError] = useState<string | null>(null)
  const [planSharesSnapshot, setPlanSharesSnapshot] = useState<{
    groups: {
      groupId: string
      groupName: string
      sharedAt: string | null
      groupFeedItemId: string | null
      hideFutureWorkouts: boolean
    }[]
    users: {
      peerUserId: string
      displayName: string
      handle: string | null
      sharedAt: string | null
      recipientFeedItemId: string | null
      allowEditing: boolean
      hideFutureWorkouts: boolean
    }[]
  }>({ groups: [], users: [] })
  const [stopPlanShareConfirm, setStopPlanShareConfirm] = useState<
    | {
        planId: string
        kind: 'group'
        groupId: string
        label: string
        groupFeedItemId: string | null
      }
    | {
        planId: string
        kind: 'user'
        peerUserId: string
        label: string
        recipientFeedItemId: string | null
      }
    | null
  >(null)
  const [stopPlanShareBusy, setStopPlanShareBusy] = useState(false)
  const [planShareRowMenuKey, setPlanShareRowMenuKey] = useState<string | null>(null)
  const [planSharePatchKey, setPlanSharePatchKey] = useState<string | null>(null)
  const [planDeleteConfirmOpen, setPlanDeleteConfirmOpen] = useState(false)
  const [followedCoachProfile, setFollowedCoachProfile] = useState<PublicUserProfileView | null>(null)
  const [followedCoachProfileLoading, setFollowedCoachProfileLoading] = useState(false)
  const [followedCoachProfileError, setFollowedCoachProfileError] = useState<string | null>(null)
  const [planOwnerPublicProfileUserId, setPlanOwnerPublicProfileUserId] = useState<string | null>(null)
  const [planSharingHubProfileGroupId, setPlanSharingHubProfileGroupId] = useState<string | null>(null)
  const [planSharingConnectionProfileUserId, setPlanSharingConnectionProfileUserId] = useState<string | null>(null)
  const [stopFollowingConfirmOpen, setStopFollowingConfirmOpen] = useState(false)
  const [stopFollowingBusy, setStopFollowingBusy] = useState(false)
  const [expandedPlannedWorkoutId, setExpandedPlannedWorkoutId] = useState<string | null>(null)
  const [draggedPlanned, setDraggedPlanned] = useState<{
    dateKey: string
    index: number
    planId: string
  } | null>(null)
  const [plannedDropIndicator, setPlannedDropIndicator] = useState<{ dateKey: string; beforeIndex: number } | null>(null)
  const [plannedWorkoutMenuId, setPlannedWorkoutMenuId] = useState<string | null>(null)
  const [plannedWorkoutMenuAnchorRect, setPlannedWorkoutMenuAnchorRect] = useState<DOMRect | null>(null)
  const [copyPlannedWorkout, setCopyPlannedWorkout] = useState<PlannedWorkout | null>(null)
  const [copyTargetPlanId, setCopyTargetPlanId] = useState<string>('')
  const [copyTargetDay, setCopyTargetDay] = useState<string>(() => getLocalYYYYMMDD(new Date()))
  const [copyBusy, setCopyBusy] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [plannedDayMenuDateKey, setPlannedDayMenuDateKey] = useState<string | null>(null)
  /** Which plan’s day row opened the ⋯ menu (required when two schedules show the same dates). */
  const [plannedDayMenuPlanId, setPlannedDayMenuPlanId] = useState<string | null>(null)
  const [plannedDayMenuAnchorRect, setPlannedDayMenuAnchorRect] = useState<DOMRect | null>(null)
  const [copyAllSourceDateKey, setCopyAllSourceDateKey] = useState<string | null>(null)
  const [copyAllSourcePlanId, setCopyAllSourcePlanId] = useState<string | null>(null)
  const [copyAllTargetPlanId, setCopyAllTargetPlanId] = useState<string>('')
  const [copyAllTargetDay, setCopyAllTargetDay] = useState<string>(() => getLocalYYYYMMDD(new Date()))
  const [copyAllBusy, setCopyAllBusy] = useState(false)
  const [copyAllError, setCopyAllError] = useState<string | null>(null)
  const [copyAllToDaySourceDateKey, setCopyAllToDaySourceDateKey] = useState<string | null>(null)
  const [copyAllToDaySourcePlanId, setCopyAllToDaySourcePlanId] = useState<string | null>(null)
  const [copyAllToDayTargetDay, setCopyAllToDayTargetDay] = useState<string>(() => getLocalYYYYMMDD(new Date()))
  const [copyAllToDayBusy, setCopyAllToDayBusy] = useState(false)
  const [copyAllToDayError, setCopyAllToDayError] = useState<string | null>(null)
  const [moveAllSourceDateKey, setMoveAllSourceDateKey] = useState<string | null>(null)
  const [moveAllSourcePlanId, setMoveAllSourcePlanId] = useState<string | null>(null)
  const [moveAllTargetDay, setMoveAllTargetDay] = useState<string>(() => getLocalYYYYMMDD(new Date()))
  const [moveAllBusy, setMoveAllBusy] = useState(false)
  const [moveAllError, setMoveAllError] = useState<string | null>(null)
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
  const [editScheduleWorkoutDetails, setEditScheduleWorkoutDetails] = useState('')
  /** Plan that receives “Add workout” / create flow when multiple schedules are open. */
  const [scheduleAddTargetPlanId, setScheduleAddTargetPlanId] = useState<string | null>(null)

  const [ownedDrag, setOwnedDrag] = useState<{ section: OwnedPlanListSection; index: number } | null>(
    null
  )
  const [ownedDropBefore, setOwnedDropBefore] = useState<{
    section: OwnedPlanListSection
    beforeIndex: number
  } | null>(null)
  const [optimisticOwnedOrder, setOptimisticOwnedOrder] = useState<
    Partial<Record<OwnedPlanListSection, string[]>> | null
  >(null)

  const [subscriptionDragIndex, setSubscriptionDragIndex] = useState<number | null>(null)
  const [subscriptionDropBeforeIndex, setSubscriptionDropBeforeIndex] = useState<number | null>(
    null
  )
  const [optimisticSubscriptionIds, setOptimisticSubscriptionIds] = useState<string[] | null>(null)

  /** Reorder: toIndex = gap index (0..n). Insert at toIndex when moving up, toIndex-1 when moving down. */
  function reorderIds(ids: string[], fromIndex: number, toIndex: number): string[] {
    if (fromIndex === toIndex) return ids
    const list = [...ids]
    const [removed] = list.splice(fromIndex, 1)
    const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex
    list.splice(Math.max(0, Math.min(insertAt, list.length)), 0, removed)
    return list
  }

  const personalPlansBase = useMemo(
    () => plans.filter((p) => workoutPlanListSection(p) === 'personal'),
    [plans]
  )
  const privateTrainingPlansBase = useMemo(
    () => plans.filter((p) => workoutPlanListSection(p) === 'privateTraining'),
    [plans]
  )
  const groupTrainingPlansBase = useMemo(
    () => plans.filter((p) => workoutPlanListSection(p) === 'groupTraining'),
    [plans]
  )

  const orderedPersonalPlans = useMemo(
    () => orderPlansInSection(personalPlansBase, optimisticOwnedOrder?.personal ?? null),
    [personalPlansBase, optimisticOwnedOrder]
  )
  const orderedPrivateTrainingPlans = useMemo(
    () =>
      orderPlansInSection(
        privateTrainingPlansBase,
        optimisticOwnedOrder?.privateTraining ?? null
      ),
    [privateTrainingPlansBase, optimisticOwnedOrder]
  )
  const orderedGroupTrainingPlans = useMemo(
    () =>
      orderPlansInSection(groupTrainingPlansBase, optimisticOwnedOrder?.groupTraining ?? null),
    [groupTrainingPlansBase, optimisticOwnedOrder]
  )

  const orderedOwnedPlansForDropdowns = useMemo(
    () => [
      ...orderedPersonalPlans,
      ...orderedPrivateTrainingPlans,
      ...orderedGroupTrainingPlans,
    ],
    [orderedPersonalPlans, orderedPrivateTrainingPlans, orderedGroupTrainingPlans]
  )

  const orderedFollowingPlans = useMemo(
    () => orderFollowingRows(followingPlans, optimisticSubscriptionIds),
    [followingPlans, optimisticSubscriptionIds]
  )

  useEffect(() => {
    setPlanShareOpen(false)
  }, [selectedPlanId, selectedFollowingSubscriptionId, rightPanelMode])

  useEffect(() => {
    setStopPlanShareConfirm(null)
    setPlanShareRowMenuKey(null)
  }, [selectedPlanId, selectedFollowingSubscriptionId, rightPanelMode])

  useEffect(() => {
    if (!planShareRowMenuKey) return
    const onPointerDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest('[data-plan-share-actions-menu]')) return
      setPlanShareRowMenuKey(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [planShareRowMenuKey])

  useEffect(() => {
    setPlanAdminMoreOpen(false)
  }, [selectedPlanId, selectedFollowingSubscriptionId, rightPanelMode])

  useEffect(() => {
    setOptimisticOwnedOrder(null)
  }, [plans])
  useEffect(() => {
    setOptimisticSubscriptionIds(null)
  }, [followingPlans])
  useEffect(() => {
    if (reorderPlansError) {
      setOptimisticOwnedOrder(null)
      setOptimisticSubscriptionIds(null)
    }
  }, [reorderPlansError])

  function plansBaseForSection(section: OwnedPlanListSection): WorkoutPlan[] {
    if (section === 'personal') return personalPlansBase
    if (section === 'privateTraining') return privateTrainingPlansBase
    return groupTrainingPlansBase
  }

  function handlePlanDropOwned(section: OwnedPlanListSection, draggedId: string, toIndex: number) {
    if (!onReorderPlansInSection) return
    const sectionPlans = plansBaseForSection(section)
    const currentIds =
      optimisticOwnedOrder?.[section] ?? sectionPlans.map((p) => p.id)
    const fromIndex = currentIds.indexOf(draggedId)
    if (fromIndex === -1) return
    const toIndexClamped = Math.max(0, Math.min(toIndex, currentIds.length))
    const newIds = reorderIds(currentIds, fromIndex, toIndexClamped)
    setOptimisticOwnedOrder((prev) => ({ ...(prev ?? {}), [section]: newIds }))
    setOwnedDrag(null)
    setOwnedDropBefore(null)
    void onReorderPlansInSection(section, newIds)
  }

  function handleSubscriptionDrop(draggedId: string, toIndex: number) {
    if (!onReorderSubscriptions) return
    const currentIds =
      optimisticSubscriptionIds ?? followingPlans.map((r) => r.subscriptionDocumentId)
    const fromIndex = currentIds.indexOf(draggedId)
    if (fromIndex === -1) return
    const toIndexClamped = Math.max(0, Math.min(toIndex, currentIds.length))
    const newIds = reorderIds(currentIds, fromIndex, toIndexClamped)
    setOptimisticSubscriptionIds(newIds)
    setSubscriptionDragIndex(null)
    setSubscriptionDropBeforeIndex(null)
    void onReorderSubscriptions(newIds)
  }

  const selectedFollowingRow =
    selectedFollowingSubscriptionId === null
      ? null
      : followingPlans.find((f) => f.subscriptionDocumentId === selectedFollowingSubscriptionId) ?? null

  const selectedPlan: WorkoutPlan | null = selectedFollowingRow
    ? followingSubscriptionToWorkoutPlan(selectedFollowingRow)
    : selectedPlanId === null
      ? null
      : plans.find((p) => p.id === selectedPlanId) ?? null

  const planScheduleReadOnly = selectedFollowingSubscriptionId !== null

  useEffect(() => {
    if (rightPanelMode === 'schedule' || !setSelectedPlanIdSecondary) return
    setSelectedPlanIdSecondary(null)
  }, [rightPanelMode, setSelectedPlanIdSecondary])

  useEffect(() => {
    if (!planScheduleReadOnly) return
    setCreateOpen(false)
    setScheduleAddTargetPlanId(null)
    setAddWorkoutSource('choice')
    setExpandedCollectionId(null)
    setSelectedWorkoutForPlan(null)
    setExpandedPlannedWorkoutId(null)
    setPlannedWorkoutMenuId(null)
    setPlannedWorkoutMenuAnchorRect(null)
    setEditPlannedOpen(false)
    setEditPlannedWorkout(null)
    setEditPlannedError(null)
    setCopyPlannedWorkout(null)
    setPlannedDayMenuDateKey(null)
    setPlannedDayMenuPlanId(null)
    setPlannedDayMenuAnchorRect(null)
    setCopyAllSourceDateKey(null)
    setCopyAllSourcePlanId(null)
    setCopyAllToDaySourceDateKey(null)
    setCopyAllToDaySourcePlanId(null)
    setMoveAllSourceDateKey(null)
    setMoveAllSourcePlanId(null)
    setMovePlannedWorkout(null)
    setDeletePlannedConfirmWorkout(null)
    setEditSchedulePlannedWorkout(null)
    setEditScheduleError(null)
    setEditScheduleWorkoutDetails('')
    setCreateError(null)
  }, [planScheduleReadOnly])

  const selectedPlanName = selectedPlan?.workoutPlanName ?? ''
  const selectedPlanDescription = selectedPlan ? planSubtitleWithKind(selectedPlan) : ''

  const planForScheduleCreate = useMemo(() => {
    if (rightPanelMode === 'schedule') {
      const tid = scheduleAddTargetPlanId ?? selectedPlanId ?? selectedPlanIdSecondary
      if (!tid) return null
      return plans.find((p) => p.id === tid) ?? null
    }
    return selectedPlan
  }, [rightPanelMode, scheduleAddTargetPlanId, selectedPlanId, selectedPlanIdSecondary, plans, selectedPlan])

  async function patchPlanShareHubHideFuture(groupId: string, nextHide: boolean) {
    if (!selectedPlanId) return
    const busyKey = `hub:${groupId}`
    setPlanSharePatchKey(busyKey)
    try {
      const res = await authedFetch(`/api/app/plans/${encodeURIComponent(selectedPlanId)}/shares`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'group',
          groupId,
          hideFutureWorkouts: nextHide,
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      setPlanShareRowMenuKey(null)
      await loadPlanShares()
      toast.success('Share updated')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setPlanSharePatchKey(null)
    }
  }

  async function patchPlanShareUserPrivateAllowEdit(peerUserId: string, nextAllow: boolean) {
    if (!selectedPlanId) return
    const busyKey = `user:${peerUserId}`
    setPlanSharePatchKey(busyKey)
    try {
      const res = await authedFetch(`/api/app/plans/${encodeURIComponent(selectedPlanId)}/shares`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'user',
          peerUserId,
          allowEditing: nextAllow,
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      setPlanShareRowMenuKey(null)
      await loadPlanShares()
      toast.success('Share updated')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setPlanSharePatchKey(null)
    }
  }

  async function patchPlanShareUserGroupHideFuture(peerUserId: string, nextHide: boolean) {
    if (!selectedPlanId) return
    const busyKey = `user:${peerUserId}`
    setPlanSharePatchKey(busyKey)
    try {
      const res = await authedFetch(`/api/app/plans/${encodeURIComponent(selectedPlanId)}/shares`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'user',
          peerUserId,
          hideFutureWorkouts: nextHide,
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      setPlanShareRowMenuKey(null)
      await loadPlanShares()
      toast.success('Share updated')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setPlanSharePatchKey(null)
    }
  }

  const planSharesBelowHeader = useMemo(() => {
    if (rightPanelMode === 'schedule') return null
    if (planScheduleReadOnly || !selectedPlanId) return null
    if (selectedPlan?.isPersonal) return null
    const allowsHubShare = selectedPlan?.trainingIntent === 1
    const sharingHeading = (
      <>
        <h3 className="text-sm font-semibold text-gray-900">Sharing</h3>
        <p className="mt-1 text-xs text-gray-500">
          {allowsHubShare
            ? 'Which hubs and connections this plan is shared with.'
            : 'Which connections this plan is shared with.'}
        </p>
      </>
    )
    if (planSharesLoading) {
      return (
        <div className="shrink-0 border-b border-gray-100 px-4 py-3">
          <div className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-3">
            {sharingHeading}
            <p className="mt-3 text-sm text-gray-500">Loading share list…</p>
          </div>
        </div>
      )
    }
    if (planSharesError) {
      return (
        <div className="shrink-0 border-b border-gray-100 px-4 py-3">
          <div className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-3">
            {sharingHeading}
            <p className="mt-3 text-sm text-red-600">{planSharesError}</p>
          </div>
        </div>
      )
    }
    const hubs = planSharesSnapshot.groups
    const people = planSharesSnapshot.users
    return (
      <div className="shrink-0 border-b border-gray-100 px-4 py-3">
        <div className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-3">
          {sharingHeading}
          <div className="mt-4 space-y-4">
          {allowsHubShare && (
          <div className="rounded-lg border border-gray-100 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Hubs</p>
            {hubs.length === 0 ? (
              <div className="mt-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-3">
                <p className="text-sm text-gray-500">Not shared with any hub yet.</p>
              </div>
            ) : (
              <ul className="mt-2 divide-y divide-gray-100 overflow-visible rounded-md border border-gray-100">
                {hubs.map((h) => {
                  const hubShareLine = formatSharedOnLine(h.sharedAt)
                  const hubMenuKey = `hub:${h.groupId}`
                  const hubPatchKey = hubMenuKey
                  const hubMenuOpen = planShareRowMenuKey === hubMenuKey
                  return (
                    <li
                      key={`hub-${h.groupId}`}
                      className={`flex items-start justify-between gap-2 bg-gray-50 px-3 py-2 text-sm ${
                        hubMenuOpen ? 'relative z-[8000]' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => setPlanSharingHubProfileGroupId(h.groupId)}
                          className="max-w-full truncate text-left text-sm font-medium text-violet-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
                          aria-label={`View hub profile for ${h.groupName || h.groupId}`}
                        >
                          {h.groupName || h.groupId}
                        </button>
                        {hubShareLine ? <p className="text-xs text-gray-500">{hubShareLine}</p> : null}
                        <p className="text-xs text-gray-600">
                          {h.hideFutureWorkouts
                            ? 'Cannot view future workouts (sees up to today).'
                            : 'Can view future workouts (sees beyond today).'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-start gap-1">
                        <div className="relative" data-plan-share-actions-menu>
                          <button
                            type="button"
                            aria-label="Edit share settings"
                            aria-expanded={hubMenuOpen}
                            aria-haspopup="menu"
                            disabled={planSharePatchKey === hubPatchKey}
                            onClick={() =>
                              setPlanShareRowMenuKey((k) => (k === hubMenuKey ? null : hubMenuKey))
                            }
                            className="rounded border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-900 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 disabled:opacity-50"
                          >
                            Edit
                          </button>
                          {hubMenuOpen ? (
                            <div
                              role="menu"
                              className="absolute right-0 z-[9000] mt-1 min-w-[12rem] rounded-md border border-gray-200 bg-white py-1 shadow-lg"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                disabled={planSharePatchKey !== null}
                                className="block w-full px-3 py-2 text-left text-xs text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                                onClick={() => void patchPlanShareHubHideFuture(h.groupId, !h.hideFutureWorkouts)}
                              >
                                {h.hideFutureWorkouts
                                  ? 'Show future workouts'
                                  : 'Hide future workouts'}
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          disabled={planSharePatchKey === hubPatchKey}
                          onClick={() =>
                            setStopPlanShareConfirm({
                              planId: selectedPlanId,
                              kind: 'group',
                              groupId: h.groupId,
                              label: h.groupName || h.groupId,
                              groupFeedItemId: h.groupFeedItemId,
                            })
                          }
                          className="shrink-0 rounded bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1 disabled:opacity-50"
                        >
                          Stop Sharing
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          )}
          <div className="rounded-lg border border-gray-100 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Connections</p>
            {people.length === 0 ? (
              <div className="mt-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-3">
                <p className="text-sm text-gray-500">Not shared with any connection yet.</p>
              </div>
            ) : (
              <ul className="mt-2 divide-y divide-gray-100 overflow-visible rounded-md border border-gray-100">
                {people.map((p) => {
                  const personShareLine = formatSharedOnLine(p.sharedAt)
                  const personLabel = p.displayName.trim() || p.peerUserId
                  const userMenuKey = `user:${p.peerUserId}`
                  const userPatchKey = userMenuKey
                  const userMenuOpen = planShareRowMenuKey === userMenuKey
                  return (
                    <li
                      key={`user-${p.peerUserId}`}
                      className={`flex items-start justify-between gap-2 bg-gray-50 px-3 py-2 text-sm ${
                        userMenuOpen ? 'relative z-[8000]' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => setPlanSharingConnectionProfileUserId(p.peerUserId)}
                          className="max-w-full truncate text-left text-sm font-medium text-violet-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
                          aria-label={`View profile for ${personLabel}`}
                        >
                          {personLabel}
                        </button>
                        {p.handle || personShareLine ? (
                          <p className="truncate text-xs text-gray-500">
                            {p.handle ? <>{p.handle}</> : null}
                            {p.handle && personShareLine ? (
                              <span aria-hidden> • </span>
                            ) : null}
                            {personShareLine ? <>{personShareLine}</> : null}
                          </p>
                        ) : null}
                        {!allowsHubShare ? (
                          <p className="text-xs text-gray-600">
                            {p.allowEditing
                              ? 'Can edit planned workouts (read/write).'
                              : 'Cannot edit planned workouts (view only).'}
                          </p>
                        ) : (
                          <p className="text-xs text-gray-600">
                            {p.hideFutureWorkouts
                              ? 'Cannot view future workouts (sees up to today).'
                              : 'Can view future workouts (sees beyond today).'}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-start gap-1">
                        <div className="relative" data-plan-share-actions-menu>
                          <button
                            type="button"
                            aria-label="Edit share settings"
                            aria-expanded={userMenuOpen}
                            aria-haspopup="menu"
                            disabled={planSharePatchKey === userPatchKey}
                            onClick={() =>
                              setPlanShareRowMenuKey((k) => (k === userMenuKey ? null : userMenuKey))
                            }
                            className="rounded border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-900 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 disabled:opacity-50"
                          >
                            Edit
                          </button>
                          {userMenuOpen ? (
                            <div
                              role="menu"
                              className="absolute right-0 z-[9000] mt-1 min-w-[12rem] rounded-md border border-gray-200 bg-white py-1 shadow-lg"
                            >
                              {!allowsHubShare ? (
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={planSharePatchKey !== null}
                                  className="block w-full px-3 py-2 text-left text-xs text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                                  onClick={() =>
                                    void patchPlanShareUserPrivateAllowEdit(p.peerUserId, !p.allowEditing)
                                  }
                                >
                                  {p.allowEditing ? 'Change to view only' : 'Allow editing'}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={planSharePatchKey !== null}
                                  className="block w-full px-3 py-2 text-left text-xs text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                                  onClick={() =>
                                    void patchPlanShareUserGroupHideFuture(
                                      p.peerUserId,
                                      !p.hideFutureWorkouts
                                    )
                                  }
                                >
                                  {p.hideFutureWorkouts
                                    ? 'Show future workouts'
                                    : 'Hide future workouts'}
                                </button>
                              )}
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          disabled={planSharePatchKey === userPatchKey}
                          onClick={() =>
                            setStopPlanShareConfirm({
                              planId: selectedPlanId,
                              kind: 'user',
                              peerUserId: p.peerUserId,
                              label: personLabel,
                              recipientFeedItemId: p.recipientFeedItemId,
                            })
                          }
                          className="shrink-0 rounded bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1 disabled:opacity-50"
                        >
                          Stop Sharing
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          </div>
        </div>
      </div>
    )
  }, [
    rightPanelMode,
    planScheduleReadOnly,
    selectedPlanId,
    planSharesLoading,
    planSharesError,
    planSharesSnapshot.groups,
    planSharesSnapshot.users,
    selectedPlan?.isPersonal,
    selectedPlan?.trainingIntent,
    planShareRowMenuKey,
    planSharePatchKey,
    patchPlanShareHubHideFuture,
    patchPlanShareUserPrivateAllowEdit,
    patchPlanShareUserGroupHideFuture,
  ])

  const maxP = maxPlans ?? UNLIMITED
  const planCount = plansCount ?? 0
  const atPlansLimit = maxP < UNLIMITED && planCount >= maxP
  const plansLabel = maxP >= UNLIMITED ? `(${plans.length})` : `(${planCount}/${maxP})`

  const tier = subscriptionTier ?? 'basic'
  const isPro = tier === 'pro'
  const isPastDate = createDate < todayYmd
  const isFutureDate = createDate > todayYmd
  const canAddPlannedForSelectedDate = planScheduleReadOnly
    ? !isPastDate && (createDate === todayYmd || (isFutureDate && isPro))
    : createDate === todayYmd || isPastDate || (isFutureDate && isPro)
  const plannedDateRestrictionMessage =
    planScheduleReadOnly && isPastDate
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
      const isPersonal = createPlanKind === 'personal'
      const trainingIntent: 0 | 1 | undefined =
        createPlanKind === 'personal'
          ? undefined
          : createPlanKind === 'privateTraining'
            ? 0
            : 1
      const created = await onCreatePlan(
        createPlanName.trim(),
        createPlanDescription.trim() || null,
        isPersonal,
        trainingIntent
      )
      setCreatePlanOpen(false)
      setCreatePlanName('')
      setCreatePlanDescription('')
      setCreatePlanKind('privateTraining')
      setSelectedFollowingSubscriptionId(null)
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
      await onUpdatePlan(
        editPlan.id,
        editPlanName.trim(),
        editPlanDescription.trim() || null,
        undefined
      )
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
    const parsed = parseScheduleToOptions(pw.workout.workoutSchedule, pw.workout.timerMode)
    setEditScheduleMode(parsed.mode)
    setEditScheduleOptions({ ...parsed.options, direction: parsed.direction ? 1 : 0 })
    setEditScheduleError(null)
    setEditSchedulePlannedWorkout(pw)
    setEditScheduleWorkoutDetails(
      pw.workout.type !== 'MultiSegmentWorkout'
        ? ((pw.workout as { workoutDetails?: string | null }).workoutDetails ?? '')
        : ''
    )
  }

  async function handleSaveEditSchedule(e: React.FormEvent) {
    e.preventDefault()
    if (!editSchedulePlannedWorkout) return
    if (!hasValidDurationForMode(editScheduleMode, editScheduleOptions, parseDurationInput)) {
      setEditScheduleError('Warmup, Cooldown, and Rest require a duration greater than 0:00.')
      return
    }
    setEditScheduleError(null)
    setEditScheduleBusy(true)
    try {
      const built = buildWorkoutFromCreateForm(editScheduleMode, editScheduleOptions)
      const body: Record<string, unknown> = { workout: built }
      if (editSchedulePlannedWorkout.workout.type !== 'MultiSegmentWorkout') {
        body.workoutDetails = editScheduleWorkoutDetails.trim() || null
      }
      const res = await authedFetch(
        `/api/app/plans/${encodeURIComponent(editSchedulePlannedWorkout.planId)}/planned-workouts/${encodeURIComponent(editSchedulePlannedWorkout.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update workout schedule')
      }
      reloadPlanned()
      setEditSchedulePlannedWorkout(null)
      setEditScheduleWorkoutDetails('')
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
    if (!editPlannedWorkout) return
    setEditPlannedError(null)
    setEditPlannedBusy(true)
    try {
      const meta: Record<string, string | null> = {
        workoutName: editPlannedName.trim() || null,
        workoutDescription: editPlannedDescription.trim() || null,
      }
      const res = await authedFetch(
        `/api/app/plans/${encodeURIComponent(editPlannedWorkout.planId)}/planned-workouts/${encodeURIComponent(editPlannedWorkout.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(meta),
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
      onPlannedWorkoutMetadataSaved(editPlannedWorkout.id, {
        workoutName: meta.workoutName,
        workoutDescription: meta.workoutDescription,
      })
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
      if (copyTargetPlanId === selectedPlanId || copyTargetPlanId === selectedPlanIdSecondary) reloadPlanned()
      toast.success('Workout copied to plan')
    } catch (e) {
      setCopyError(e instanceof Error ? e.message : 'Failed to copy workout')
    } finally {
      setCopyBusy(false)
    }
  }

  async function handleCopyAllToPlan(e: React.FormEvent) {
    e.preventDefault()
    if (!copyAllSourceDateKey || !copyAllTargetPlanId || !copyAllTargetDay) return
    setCopyAllError(null)
    setCopyAllBusy(true)
    try {
      const dayStr = copyAllTargetDay.slice(0, 10)
      const sourcePid = copyAllSourcePlanId ?? selectedPlanId
      const sourceByDay =
        selectedPlanIdSecondary && sourcePid === selectedPlanIdSecondary
          ? scheduleSecondByDay ?? {}
          : byDay
      const sourceItems = [...(sourceByDay[copyAllSourceDateKey] ?? [])].sort((a, b) => a.ordinal - b.ordinal)
      if (sourceItems.length === 0) {
        setCopyAllSourceDateKey(null)
        setCopyAllSourcePlanId(null)
        return
      }
      const countRes = await authedFetch(
        `/api/app/plans/${encodeURIComponent(copyAllTargetPlanId)}/planned-workouts?from=${encodeURIComponent(dayStr)}&to=${encodeURIComponent(dayStr)}`
      )
      if (!countRes.ok) {
        const data = await countRes.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${countRes.status}`)
      }
      const countData = (await countRes.json()) as { plannedWorkouts?: PlannedWorkout[] }
      const baseOrdinal = (countData.plannedWorkouts ?? []).length

      for (let i = 0; i < sourceItems.length; i++) {
        const pw = sourceItems[i]!
        const w = pw.workout as Record<string, unknown>
        const workout =
          typeof w.timerMode === 'number'
            ? w
            : { ...w, timerMode: (Array.isArray(w.timerModes) ? (w.timerModes as number[])[0] : 1) }
        const res = await authedFetch(
          `/api/app/plans/${encodeURIComponent(copyAllTargetPlanId)}/planned-workouts`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              day: dayStr,
              ordinal: baseOrdinal + i,
              workout,
            }),
          }
        )
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(
            data.error || `Failed to copy workout ${i + 1} of ${sourceItems.length}`
          )
        }
      }
      setCopyAllSourceDateKey(null)
      setCopyAllSourcePlanId(null)
      if (
        (copyAllTargetPlanId === selectedPlanId || copyAllTargetPlanId === selectedPlanIdSecondary) &&
        !planScheduleReadOnly
      ) {
        reloadPlanned()
      }
      toast.success(
        sourceItems.length === 1
          ? 'Workout copied to plan'
          : `${sourceItems.length} workouts copied to plan`
      )
    } catch (e) {
      setCopyAllError(e instanceof Error ? e.message : 'Failed to copy workouts')
    } finally {
      setCopyAllBusy(false)
    }
  }

  async function handleCopyAllToDay(e: React.FormEvent) {
    e.preventDefault()
    if (!copyAllToDaySourceDateKey || !copyAllToDayTargetDay || !selectedPlan) return
    const dayStr = copyAllToDayTargetDay.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayStr)) return
    if (dayStr < todayYmd) {
      setCopyAllToDayError('Cannot add workouts to past dates.')
      return
    }
    if (dayStr > todayYmd && !isPro) {
      setCopyAllToDayError('Upgrade to Pro to plan for future dates.')
      return
    }
    if (dayStr === copyAllToDaySourceDateKey) {
      setCopyAllToDayError('Choose a different date.')
      return
    }
    const targetPlanId = copyAllToDaySourcePlanId ?? selectedPlan.id
    setCopyAllToDayError(null)
    setCopyAllToDayBusy(true)
    try {
      const sourcePid = targetPlanId
      const sourceByDay =
        selectedPlanIdSecondary && sourcePid === selectedPlanIdSecondary
          ? scheduleSecondByDay ?? {}
          : byDay
      const sourceItems = [...(sourceByDay[copyAllToDaySourceDateKey] ?? [])].sort((a, b) => a.ordinal - b.ordinal)
      if (sourceItems.length === 0) {
        setCopyAllToDaySourceDateKey(null)
        setCopyAllToDaySourcePlanId(null)
        return
      }
      const countRes = await authedFetch(
        `/api/app/plans/${encodeURIComponent(targetPlanId)}/planned-workouts?from=${encodeURIComponent(dayStr)}&to=${encodeURIComponent(dayStr)}`
      )
      if (!countRes.ok) {
        const data = await countRes.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${countRes.status}`)
      }
      const countData = (await countRes.json()) as { plannedWorkouts?: PlannedWorkout[] }
      const baseOrdinal = (countData.plannedWorkouts ?? []).length

      for (let i = 0; i < sourceItems.length; i++) {
        const pw = sourceItems[i]!
        const w = pw.workout as Record<string, unknown>
        const workout =
          typeof w.timerMode === 'number'
            ? w
            : { ...w, timerMode: (Array.isArray(w.timerModes) ? (w.timerModes as number[])[0] : 1) }
        const res = await authedFetch(
          `/api/app/plans/${encodeURIComponent(targetPlanId)}/planned-workouts`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              day: dayStr,
              ordinal: baseOrdinal + i,
              workout,
            }),
          }
        )
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(
            data.error || `Failed to copy workout ${i + 1} of ${sourceItems.length}`
          )
        }
      }
      setCopyAllToDaySourceDateKey(null)
      setCopyAllToDaySourcePlanId(null)
      if (
        (targetPlanId === selectedPlanId || targetPlanId === selectedPlanIdSecondary) &&
        !planScheduleReadOnly
      ) {
        reloadPlanned()
      }
      toast.success(
        sourceItems.length === 1
          ? 'Workout copied to date'
          : `${sourceItems.length} workouts copied to date`
      )
    } catch (err) {
      setCopyAllToDayError(err instanceof Error ? err.message : 'Failed to copy workouts')
    } finally {
      setCopyAllToDayBusy(false)
    }
  }

  async function handleMoveAllToDay(e: React.FormEvent) {
    e.preventDefault()
    if (!moveAllSourceDateKey || !moveAllTargetDay || !selectedPlan) return
    const dayStr = moveAllTargetDay.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayStr)) return
    if (dayStr < todayYmd) {
      setMoveAllError('Cannot move workouts to past dates.')
      return
    }
    if (dayStr > todayYmd && !isPro) {
      setMoveAllError('Upgrade to Pro to plan for future dates.')
      return
    }
    if (dayStr === moveAllSourceDateKey) {
      setMoveAllError('Choose a different date.')
      return
    }
    setMoveAllError(null)
    setMoveAllBusy(true)
    try {
      const sourcePid = moveAllSourcePlanId ?? selectedPlanId
      const sourceByDay =
        selectedPlanIdSecondary && sourcePid === selectedPlanIdSecondary
          ? scheduleSecondByDay ?? {}
          : byDay
      const sourceItems = [...(sourceByDay[moveAllSourceDateKey] ?? [])].sort((a, b) => a.ordinal - b.ordinal)
      if (sourceItems.length === 0) {
        setMoveAllSourceDateKey(null)
        setMoveAllSourcePlanId(null)
        return
      }
      const moveTargetPlanId = moveAllSourcePlanId ?? selectedPlan.id
      const countRes = await authedFetch(
        `/api/app/plans/${encodeURIComponent(moveTargetPlanId)}/planned-workouts?from=${encodeURIComponent(dayStr)}&to=${encodeURIComponent(dayStr)}`
      )
      if (!countRes.ok) {
        const data = await countRes.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${countRes.status}`)
      }
      const countData = (await countRes.json()) as { plannedWorkouts?: PlannedWorkout[] }
      const baseOrdinal = (countData.plannedWorkouts ?? []).length

      for (let i = 0; i < sourceItems.length; i++) {
        const pw = sourceItems[i]!
        const body = { day: dayStr, ordinal: baseOrdinal + i }
        const res = await authedFetch(
          `/api/app/plans/${encodeURIComponent(pw.planId)}/planned-workouts/${encodeURIComponent(pw.id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        )
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(
            data.error || `Failed to move workout ${i + 1} of ${sourceItems.length}`
          )
        }
      }
      setMoveAllSourceDateKey(null)
      setMoveAllSourcePlanId(null)
      reloadPlanned()
      toast.success(
        sourceItems.length === 1
          ? 'Workout moved'
          : `${sourceItems.length} workouts moved`
      )
    } catch (err) {
      setMoveAllError(err instanceof Error ? err.message : 'Failed to move workouts')
    } finally {
      setMoveAllBusy(false)
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

  useEffect(() => {
    setStopFollowingConfirmOpen(false)
    setPlanOwnerPublicProfileUserId(null)
  }, [selectedFollowingSubscriptionId])

  useEffect(() => {
    if (!selectedFollowingRow) {
      setFollowedCoachProfile(null)
      setFollowedCoachProfileLoading(false)
      setFollowedCoachProfileError(null)
      return
    }
    const ownerId = selectedFollowingRow.ownerUserId
    let cancelled = false
    setFollowedCoachProfile(null)
    setFollowedCoachProfileError(null)
    setFollowedCoachProfileLoading(true)
    ;(async () => {
      try {
        const res = await authedFetch(
          `/api/app/users/${encodeURIComponent(ownerId)}/public-profile`
        )
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(j.error || `HTTP ${res.status}`)
        }
        const data = (await res.json()) as PublicUserProfileView
        if (!cancelled) setFollowedCoachProfile(data)
      } catch (e) {
        if (!cancelled) {
          setFollowedCoachProfileError(
            e instanceof Error ? e.message : 'Failed to load profile'
          )
        }
      } finally {
        if (!cancelled) setFollowedCoachProfileLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- authedFetch uses latest user token
  }, [selectedFollowingRow?.ownerUserId, selectedFollowingSubscriptionId])

  async function confirmStopFollowing() {
    if (!selectedFollowingRow) return
    setStopFollowingBusy(true)
    try {
      const res = await authedFetch(
        `/api/app/following-plans/${encodeURIComponent(selectedFollowingRow.subscriptionDocumentId)}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      setStopFollowingConfirmOpen(false)
      setPlanAdminMoreOpen(false)
      setSelectedFollowingSubscriptionId(null)
      await reloadFollowingPlans?.()
      toast.success('Your subscription to this plan has ended.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not unsubscribe')
    } finally {
      setStopFollowingBusy(false)
    }
  }

  async function loadPlanShares() {
    if (rightPanelMode === 'schedule') {
      setPlanSharesSnapshot({ groups: [], users: [] })
      setPlanSharesError(null)
      setPlanSharesLoading(false)
      return
    }
    if (!selectedPlanId || selectedFollowingSubscriptionId) {
      setPlanSharesSnapshot({ groups: [], users: [] })
      setPlanSharesError(null)
      setPlanSharesLoading(false)
      return
    }
    if (selectedPlan?.isPersonal) {
      setPlanSharesSnapshot({ groups: [], users: [] })
      setPlanSharesError(null)
      setPlanSharesLoading(false)
      return
    }
    setPlanSharesLoading(true)
    setPlanSharesError(null)
    try {
      const res = await authedFetch(`/api/app/plans/${encodeURIComponent(selectedPlanId)}/shares`)
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as {
        groupShares?: {
          groupId: string
          groupName?: string
          sharedAt?: string | null
          groupFeedItemId?: string | null
          hideFutureWorkouts?: unknown
        }[]
        userShares?: {
          peerUserId: string
          displayName?: string
          handle?: string | null
          sharedAt?: string | null
          recipientFeedItemId?: string | null
          allowEditing?: unknown
          hideFutureWorkouts?: unknown
        }[]
      }
      setPlanSharesSnapshot({
        groups: (data.groupShares ?? []).map((g) => ({
          groupId: g.groupId,
          groupName: (g.groupName ?? '').trim() || g.groupId,
          sharedAt: typeof g.sharedAt === 'string' ? g.sharedAt : null,
          groupFeedItemId:
            typeof g.groupFeedItemId === 'string' && g.groupFeedItemId.trim()
              ? g.groupFeedItemId.trim()
              : null,
          hideFutureWorkouts: g.hideFutureWorkouts === false ? false : true,
        })),
        users: (data.userShares ?? []).map((u) => ({
          peerUserId: u.peerUserId,
          displayName: (u.displayName ?? '').trim(),
          handle: u.handle ?? null,
          sharedAt: typeof u.sharedAt === 'string' ? u.sharedAt : null,
          recipientFeedItemId:
            typeof u.recipientFeedItemId === 'string' && u.recipientFeedItemId.trim()
              ? u.recipientFeedItemId.trim()
              : null,
          allowEditing: u.allowEditing === true,
          hideFutureWorkouts: u.hideFutureWorkouts === false ? false : true,
        })),
      })
    } catch (e) {
      setPlanSharesError(e instanceof Error ? e.message : 'Failed to load shares')
      setPlanSharesSnapshot({ groups: [], users: [] })
    } finally {
      setPlanSharesLoading(false)
    }
  }

  async function confirmStopPlanShare() {
    if (!stopPlanShareConfirm || !selectedPlanId) return
    if (stopPlanShareConfirm.planId !== selectedPlanId) {
      setStopPlanShareConfirm(null)
      return
    }
    setStopPlanShareBusy(true)
    try {
      const pid = stopPlanShareConfirm.planId
      let url = `/api/app/plans/${encodeURIComponent(pid)}/shares?`
      if (stopPlanShareConfirm.kind === 'group') {
        url += `target=group&groupId=${encodeURIComponent(stopPlanShareConfirm.groupId)}`
        if (stopPlanShareConfirm.groupFeedItemId) {
          url += `&groupFeedItemId=${encodeURIComponent(stopPlanShareConfirm.groupFeedItemId)}`
        }
      } else {
        url += `target=user&peerUserId=${encodeURIComponent(stopPlanShareConfirm.peerUserId)}`
        if (stopPlanShareConfirm.recipientFeedItemId) {
          url += `&recipientFeedItemId=${encodeURIComponent(stopPlanShareConfirm.recipientFeedItemId)}`
        }
      }
      const res = await authedFetch(url, { method: 'DELETE' })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      setStopPlanShareConfirm(null)
      await loadPlanShares()
      toast.success('Stopped sharing this plan.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not stop sharing')
    } finally {
      setStopPlanShareBusy(false)
    }
  }

  useEffect(() => {
    void loadPlanShares()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadPlanShares uses latest selectedPlanId / following id / rightPanelMode / personal from closure
  }, [selectedPlanId, selectedFollowingSubscriptionId, rightPanelMode, selectedPlan?.isPersonal])

  useEffect(() => {
    if (
      rightPanelMode !== 'schedule' &&
      planShareWasOpenRef.current &&
      !planShareOpen &&
      selectedPlanId &&
      !selectedFollowingSubscriptionId
    ) {
      void loadPlanShares()
    }
    planShareWasOpenRef.current = planShareOpen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planShareOpen, selectedPlanId, selectedFollowingSubscriptionId, rightPanelMode])

  /** Add from favorite or collection: copy workout into planned workout, set sourceWorkoutId to workout.id, ordinal = end of list for that day. */
  async function addPlannedFromWorkout(workout: Workout) {
    if (planScheduleReadOnly) return
    const targetPlanId = scheduleAddTargetPlanId ?? selectedPlanId ?? selectedPlanIdSecondary ?? selectedPlan?.id
    if (!targetPlanId) return
    const byDayForTarget =
      selectedPlanIdSecondary && targetPlanId === selectedPlanIdSecondary
        ? scheduleSecondByDay ?? {}
        : byDay
    setCreateBusy(true)
    setCreateError(null)
    try {
      const dayKey = createDate.slice(0, 10)
      const ordinal = (byDayForTarget[dayKey] ?? []).length
      const res = await authedFetch(
        `/api/app/plans/${encodeURIComponent(targetPlanId)}/planned-workouts`,
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
      setScheduleAddTargetPlanId(null)
      reloadPlanned()
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to add to plan')
    } finally {
      setCreateBusy(false)
    }
  }

  /** Create from scratch: workout from form, sourceWorkoutId null, ordinal = end of list for that day. plannedWorkoutId and plan/day set by API. */
  async function handleCreatePlanned() {
    if (planScheduleReadOnly) return
    const targetPlanId = scheduleAddTargetPlanId ?? selectedPlanId ?? selectedPlanIdSecondary ?? selectedPlan?.id
    if (!targetPlanId) return
    const byDayForTarget =
      selectedPlanIdSecondary && targetPlanId === selectedPlanIdSecondary
        ? scheduleSecondByDay ?? {}
        : byDay
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
      const ordinal = (byDayForTarget[dayKey] ?? []).length
      const res = await authedFetch(
        `/api/app/plans/${encodeURIComponent(
          targetPlanId
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
      const created = (await res.json()) as { id: string; [k: string]: unknown }
      const hasMeta = createPlannedName.trim() || createPlannedDescription.trim() || createPlannedDetails.trim()
      if (created?.id && hasMeta) {
        const patchRes = await authedFetch(
          `/api/app/plans/${encodeURIComponent(targetPlanId)}/planned-workouts/${encodeURIComponent(created.id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workoutName: createPlannedName.trim() || null,
              workoutDescription: createPlannedDescription.trim() || null,
              workoutDetails: createPlannedDetails.trim() || null,
            }),
          }
        )
        if (!patchRes.ok) {
          const data = await patchRes.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to save name/description')
        }
      }
      setCreateOpen(false)
      setAddWorkoutSource('choice')
      setCreateOptions({})
      setCreateNewNameStep(false)
      setCreatePlannedName('')
      setCreatePlannedDescription('')
      setCreatePlannedDetails('')
      setScheduleAddTargetPlanId(null)
      reloadPlanned()
    } catch (e) {
      setCreateError(
        e instanceof Error ? e.message : 'Failed to create planned workout'
      )
    } finally {
      setCreateBusy(false)
    }
  }

  const scheduleWeekColumns = useMemo(() => {
    if (rightPanelMode !== 'schedule') {
      return [] as {
        slot: 'left' | 'right'
        planId: string | null
        excludePlanId: string | null
        byDayMap: Record<string, PlannedWorkout[]>
        headerPlan: WorkoutPlan | null
        columnWeekStart: string
        setColumnWeekStart: (value: string) => void
        columnWeekEnd: string
        columnPlanDayCount: number
        columnPlanViewMode: 'week' | '3day' | '1day'
        setColumnPlanViewMode: (mode: 'week' | '3day' | '1day') => void
      }[]
    }
    const followingRowForSchedule =
      selectedFollowingSubscriptionId === null
        ? null
        : followingPlans.find((f) => f.subscriptionDocumentId === selectedFollowingSubscriptionId) ?? null
    const primaryPlan =
      followingRowForSchedule != null
        ? followingSubscriptionToWorkoutPlan(followingRowForSchedule)
        : selectedPlanId
          ? plans.find((p) => p.id === selectedPlanId) ?? null
          : null
    const secondaryPlan =
      selectedPlanIdSecondary && selectedPlanIdSecondary !== primaryPlan?.id
        ? plans.find((p) => p.id === selectedPlanIdSecondary) ?? null
        : null
    const both = [
      {
        slot: 'left' as const,
        planId: primaryPlan?.id ?? null,
        excludePlanId: secondaryPlan?.id ?? null,
        byDayMap: byDay,
        headerPlan: primaryPlan,
        columnWeekStart: weekStart,
        setColumnWeekStart: setWeekStart,
        columnWeekEnd: weekEnd,
        columnPlanDayCount: planDayCount,
        columnPlanViewMode: planViewMode,
        setColumnPlanViewMode: setPlanViewMode,
      },
      {
        slot: 'right' as const,
        planId: secondaryPlan?.id ?? null,
        excludePlanId: primaryPlan?.id ?? null,
        byDayMap: secondaryPlan ? (scheduleSecondByDay ?? {}) : {},
        headerPlan: secondaryPlan,
        columnWeekStart: weekStartSecondary,
        setColumnWeekStart: setWeekStartSecondary,
        columnWeekEnd: weekEndSecondary,
        columnPlanDayCount: planDayCountSecondary,
        columnPlanViewMode: planViewModeSecondary,
        setColumnPlanViewMode: setPlanViewModeSecondary,
      },
    ]
    return planAheadColumnCount === 1 ? both.slice(0, 1) : both
  }, [
    rightPanelMode,
    planAheadColumnCount,
    plans,
    selectedPlanId,
    selectedPlanIdSecondary,
    byDay,
    scheduleSecondByDay,
    weekStart,
    setWeekStart,
    weekEnd,
    planDayCount,
    planViewMode,
    setPlanViewMode,
    weekStartSecondary,
    setWeekStartSecondary,
    weekEndSecondary,
    planDayCountSecondary,
    planViewModeSecondary,
    setPlanViewModeSecondary,
    selectedFollowingSubscriptionId,
    followingPlans,
  ])

  return (
    <>
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <div
        className={
          rightPanelMode === 'schedule'
            ? 'grid min-h-[28rem] w-full flex-1 grid-cols-1 min-h-0 lg:min-h-0'
            : 'grid min-h-[28rem] w-full flex-1 gap-6 lg:min-h-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.8fr)] lg:grid-rows-[minmax(0,1fr)]'
        }
      >
        {rightPanelMode !== 'schedule' && (
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gymnext-muted/30 bg-gymnext-background px-4 py-3">
            <h3 className="text-sm font-medium text-gray-800">
              {listSurfaceTitle} {plansLabel}
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
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-4 py-2">
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
          <div className="min-h-0 flex-1 overflow-y-auto">
            {plans.length === 0 ? (
              <p className="px-4 pt-3 pb-3 text-sm text-gray-500">
                You do not have any owned plans yet. Create one to get started.
              </p>
            ) : (
            <>
            {(
              [
                {
                  section: 'personal' as const,
                  title: 'Personal',
                  headingId: 'plans-section-personal',
                  rows: orderedPersonalPlans,
                },
                {
                  section: 'privateTraining' as const,
                  title: 'Private Training',
                  headingId: 'plans-section-private-training',
                  rows: orderedPrivateTrainingPlans,
                },
                {
                  section: 'groupTraining' as const,
                  title: 'Group Training',
                  headingId: 'plans-section-group-training',
                  rows: orderedGroupTrainingPlans,
                },
              ] as const
            )
              .filter((def) => def.rows.length > 0)
              .map(({ section, title, headingId, rows }) => (
              <Fragment key={section}>
                <p
                  className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500"
                  id={headingId}
                >
                  {title}
                </p>
                  <ul
                    className=""
                    aria-labelledby={headingId}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const draggedId = e.dataTransfer.getData('text/plain')
                      if (!draggedId || !onReorderPlansInSection || ownedDrag?.section !== section) {
                        return
                      }
                      const len = rows.length
                      const toIndex =
                        ownedDropBefore?.section === section ? ownedDropBefore.beforeIndex : len
                      handlePlanDropOwned(section, draggedId, toIndex)
                    }}
                  >
                    {rows.map((p, index) => {
                      const isSelected =
                        selectedPlanId === p.id && selectedFollowingSubscriptionId === null
                      const isDraggingHere =
                        ownedDrag?.section === section && ownedDrag.index === index
                      return (
                        <Fragment key={p.id}>
                          {ownedDropBefore?.section === section &&
                            ownedDropBefore.beforeIndex === index && (
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
                                  if (id && onReorderPlansInSection && ownedDrag?.section === section) {
                                    handlePlanDropOwned(section, id, index)
                                  }
                                }}
                              >
                                <div className="h-1 flex-1 rounded-full min-w-0 bg-[#6B21A8]" />
                              </li>
                            )}
                          <li
                            data-index={index}
                            className={`pl-3 pr-4 py-3 flex items-center gap-3 cursor-pointer bg-white ${
                              index > 0 ? 'border-t border-gray-200' : ''
                            } ${isSelected ? '' : 'hover:bg-gray-100'} ${isDraggingHere ? 'opacity-50' : ''}`}
                            onClick={() => setSelectedPlanId(isSelected ? null : p.id)}
                            onDragOver={(e) => {
                              e.preventDefault()
                              e.dataTransfer.dropEffect = 'move'
                              if (!onReorderPlansInSection || ownedDrag === null) return
                              if (ownedDrag.section !== section) return
                              const rect = e.currentTarget.getBoundingClientRect()
                              const midY = rect.top + rect.height / 2
                              const insertBefore = e.clientY < midY ? index : index + 1
                              setOwnedDropBefore({ section, beforeIndex: insertBefore })
                            }}
                            onDrop={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              const draggedId = e.dataTransfer.getData('text/plain')
                              if (!draggedId || !onReorderPlansInSection || ownedDrag?.section !== section) {
                                return
                              }
                              const currentIds =
                                optimisticOwnedOrder?.[section] ?? rows.map((plan) => plan.id)
                              const fromIndex = currentIds.indexOf(draggedId)
                              if (fromIndex === -1) return
                              const rect = e.currentTarget.getBoundingClientRect()
                              const midY = rect.top + rect.height / 2
                              const toIndex =
                                ownedDropBefore?.section === section
                                  ? ownedDropBefore.beforeIndex
                                  : e.clientY < midY
                                    ? index
                                    : index + 1
                              handlePlanDropOwned(
                                section,
                                draggedId,
                                Math.max(0, Math.min(toIndex, currentIds.length))
                              )
                            }}
                          >
                            <span
                              className="w-1 shrink-0 rounded-full self-stretch min-h-[3rem]"
                              style={{ backgroundColor: planListStripeColor(isSelected) }}
                              aria-hidden
                            />
                            <span
                              draggable={Boolean(onReorderPlansInSection)}
                              onDragStart={(e) => {
                                if (!onReorderPlansInSection) return
                                e.dataTransfer.effectAllowed = 'move'
                                e.dataTransfer.setData('text/plain', p.id)
                                setOwnedDrag({ section, index })
                                setOwnedDropBefore(null)
                              }}
                              onDragEnd={() => {
                                setOwnedDrag(null)
                                setOwnedDropBefore(null)
                              }}
                              className={`w-6 shrink-0 flex items-center justify-center touch-none ${
                                onReorderPlansInSection
                                  ? 'text-gray-400 cursor-grab active:cursor-grabbing'
                                  : 'text-gray-200 cursor-default'
                              }`}
                              aria-hidden
                              title={onReorderPlansInSection ? 'Drag to reorder' : undefined}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <DragReorderGrip />
                            </span>
                            {isSelected && (
                              <span className="shrink-0 text-teal-700" aria-label="Active plan">
                                ✓
                              </span>
                            )}
                            <div className="flex min-w-0 flex-1 items-center gap-1.5">
                              <PlanKindIcon kind={planVisualKindFromPlan(p)} selected={isSelected} />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {p.workoutPlanName}
                                </p>
                                <p className="text-xs text-gray-500 truncate">
                                  {planDisplayDescription(p)}
                                </p>
                              </div>
                            </div>
                          </li>
                        </Fragment>
                      )
                    })}
                    {ownedDropBefore?.section === section &&
                      ownedDropBefore.beforeIndex === rows.length && (
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
                            if (id && onReorderPlansInSection && ownedDrag?.section === section) {
                              handlePlanDropOwned(section, id, rows.length)
                            }
                          }}
                        >
                          <div className="h-1 flex-1 rounded-full min-w-0 bg-[#6B21A8]" />
                        </li>
                      )}
                  </ul>
              </Fragment>
            ))}
            </>
            )}
            {!followingPlansLoading && followingPlans.length > 0 && (
              <>
                <div className="mt-2 border-t border-gray-100" aria-hidden />
                <p
                  className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500"
                  id="plans-subscriptions-heading"
                >
                  Following
                </p>
              <ul
                className="pb-2"
                aria-labelledby="plans-subscriptions-heading"
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const draggedId = e.dataTransfer.getData('text/plain')
                  if (!draggedId || !onReorderSubscriptions || subscriptionDragIndex === null) return
                  const len = orderedFollowingPlans.length
                  const toIndex =
                    subscriptionDropBeforeIndex !== null ? subscriptionDropBeforeIndex : len
                  handleSubscriptionDrop(draggedId, toIndex)
                }}
              >
                {orderedFollowingPlans.map((row, index) => {
                  const fp = followingSubscriptionToWorkoutPlan(row)
                  const isSelected = selectedFollowingSubscriptionId === row.subscriptionDocumentId
                  return (
                    <Fragment key={row.subscriptionDocumentId}>
                      {subscriptionDropBeforeIndex === index && (
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
                            if (id && onReorderSubscriptions) {
                              handleSubscriptionDrop(id, index)
                            }
                          }}
                        >
                          <div className="h-1 flex-1 rounded-full min-w-0 bg-[#6B21A8]" />
                        </li>
                      )}
                      <li
                        className={`pl-3 pr-4 py-3 flex items-center gap-3 cursor-pointer bg-white ${
                          index > 0 ? 'border-t border-gray-200' : ''
                        } ${isSelected ? '' : 'hover:bg-gray-100'} ${
                          subscriptionDragIndex === index ? 'opacity-50' : ''
                        }`}
                        onClick={() =>
                          setSelectedFollowingSubscriptionId(
                            isSelected ? null : row.subscriptionDocumentId
                          )
                        }
                        onDragOver={(e) => {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                          if (subscriptionDragIndex === null || !onReorderSubscriptions) return
                          const rect = e.currentTarget.getBoundingClientRect()
                          const midY = rect.top + rect.height / 2
                          setSubscriptionDropBeforeIndex(e.clientY < midY ? index : index + 1)
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const draggedId = e.dataTransfer.getData('text/plain')
                          if (!draggedId || !onReorderSubscriptions) return
                          const currentIds =
                            optimisticSubscriptionIds ??
                            followingPlans.map((r) => r.subscriptionDocumentId)
                          const rect = e.currentTarget.getBoundingClientRect()
                          const midY = rect.top + rect.height / 2
                          const toIndex =
                            subscriptionDropBeforeIndex ??
                            (e.clientY < midY ? index : index + 1)
                          handleSubscriptionDrop(
                            draggedId,
                            Math.max(0, Math.min(toIndex, currentIds.length))
                          )
                        }}
                      >
                        <span
                          className="w-1 shrink-0 rounded-full self-stretch min-h-[3rem]"
                          style={{ backgroundColor: planListStripeColor(isSelected) }}
                          aria-hidden
                        />
                        <span
                          draggable={Boolean(onReorderSubscriptions)}
                          onDragStart={(e) => {
                            if (!onReorderSubscriptions) return
                            e.dataTransfer.effectAllowed = 'move'
                            e.dataTransfer.setData('text/plain', row.subscriptionDocumentId)
                            setSubscriptionDragIndex(index)
                            setSubscriptionDropBeforeIndex(null)
                          }}
                          onDragEnd={() => {
                            setSubscriptionDragIndex(null)
                            setSubscriptionDropBeforeIndex(null)
                          }}
                          className={`w-6 shrink-0 flex items-center justify-center touch-none ${
                            onReorderSubscriptions
                              ? 'text-gray-400 cursor-grab active:cursor-grabbing'
                              : 'text-gray-200 cursor-default'
                          }`}
                          aria-hidden
                          title={onReorderSubscriptions ? 'Drag to reorder' : undefined}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DragReorderGrip />
                        </span>
                        {isSelected && (
                          <span className="shrink-0 text-teal-700" aria-label="Active plan">
                            ✓
                          </span>
                        )}
                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                          <PlanKindIcon kind={planVisualKindFromPlan(fp)} selected={isSelected} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {fp.workoutPlanName}
                            </p>
                            <p className="text-xs text-gray-500 truncate">
                              {planDisplayDescription(fp)}
                            </p>
                          </div>
                        </div>
                      </li>
                    </Fragment>
                  )
                })}
                {subscriptionDropBeforeIndex === orderedFollowingPlans.length && (
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
                      if (id && onReorderSubscriptions) {
                        handleSubscriptionDrop(id, orderedFollowingPlans.length)
                      }
                    }}
                  >
                    <div className="h-1 flex-1 rounded-full min-w-0 bg-[#6B21A8]" />
                  </li>
                )}
              </ul>
              </>
            )}
          </div>
        </div>
        )}

        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white">
          {rightPanelMode === 'schedule' ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {reorderPlansError && onDismissReorderPlansError ? (
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-4 py-2">
                  <p className="text-xs text-red-800">{reorderPlansError}</p>
                  <button
                    type="button"
                    onClick={onDismissReorderPlansError}
                    className="shrink-0 text-xs font-medium text-red-600 hover:text-red-800"
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}
              {plansLoading ? (
                <p className="shrink-0 px-4 py-2 text-sm text-gray-500">Loading planned workouts…</p>
              ) : null}
              {plansError ? (
                <div className="shrink-0 bg-red-50 px-4 py-2 text-xs text-red-700">{plansError}</div>
              ) : null}
              <div className="flex shrink-0 items-center justify-end border-b border-gymnext-muted/30 bg-gymnext-background px-3 py-2">
                <div
                  className="inline-flex max-w-full rounded-lg border border-gymnext-muted/50 bg-white p-0.5"
                  role="group"
                  aria-label="Plan schedule layout"
                >
                  {(
                    [
                      { columns: 1 as const, label: 'Full View' },
                      { columns: 2 as const, label: 'Split View' },
                    ] as const
                  ).map(({ columns, label }) => (
                    <button
                      key={columns}
                      type="button"
                      onClick={() => setPlanAheadColumnCount(columns)}
                      className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors sm:px-3 ${
                        planAheadColumnCount === columns
                          ? 'text-white'
                          : 'text-gray-600 hover:bg-gymnext-background'
                      }`}
                      style={planAheadColumnCount === columns ? { backgroundColor: '#6B21A8' } : undefined}
                      aria-pressed={planAheadColumnCount === columns}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div
                className={`grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:auto-rows-[minmax(0,1fr)] ${
                  planAheadColumnCount === 2 ? 'lg:grid-cols-2 lg:gap-6' : 'lg:grid-cols-1'
                }`}
              >
                {scheduleWeekColumns.map((col) => (
                  <div
                    key={col.slot}
                    className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${
                      col.slot === 'right'
                        ? 'border-t border-gray-100 pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0'
                        : ''
                    }`}
                  >
                    <div className="flex shrink-0 flex-col gap-1.5 border-b border-gymnext-muted/30 bg-gymnext-background px-2 py-2 sm:px-3">
                      <label
                        htmlFor={`plan-ahead-column-${col.slot}`}
                        className="text-[11px] font-medium uppercase tracking-wide text-gray-600"
                      >
                        Plan
                      </label>
                      {plans.length === 0 && (col.slot !== 'left' || followingPlans.length === 0) ? (
                        <p className="text-xs text-gray-500">
                          No plans yet. Open <span className="font-medium text-gray-700">Plans</span> to create one.
                        </p>
                      ) : (
                        <select
                          id={`plan-ahead-column-${col.slot}`}
                          value={
                            col.slot === 'left' && selectedFollowingSubscriptionId
                              ? `following:${selectedFollowingSubscriptionId}`
                              : col.planId ?? ''
                          }
                          onChange={(e) => {
                            const raw = e.target.value
                            if (col.slot === 'left') {
                              if (!raw) {
                                setSelectedFollowingSubscriptionId(null)
                                setSelectedPlanId(null)
                                return
                              }
                              if (raw.startsWith('following:')) {
                                const subId = raw.slice('following:'.length)
                                setSelectedFollowingSubscriptionId(subId)
                                const row = followingPlans.find(
                                  (f) => f.subscriptionDocumentId === subId
                                )
                                setSelectedPlanId(row?.remotePlanId ?? null)
                                if (planAheadColumnCount === 2) {
                                  setSelectedPlanIdSecondary?.(null)
                                }
                                return
                              }
                              setSelectedFollowingSubscriptionId(null)
                              setSelectedPlanId(raw)
                              return
                            }
                            if (setSelectedPlanIdSecondary) {
                              setSelectedPlanIdSecondary(raw || null)
                            }
                          }}
                          className="w-full rounded border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900 focus:border-[#6B21A8] focus:outline-none focus:ring-1 focus:ring-[#6B21A8]"
                        >
                          <option value="">Select a plan…</option>
                          {orderedOwnedPlansForDropdowns
                            .filter((p) => !col.excludePlanId || p.id !== col.excludePlanId)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.workoutPlanName}
                              </option>
                            ))}
                          {col.slot === 'left' &&
                            orderedFollowingPlans.map((row) => {
                              const fp = followingSubscriptionToWorkoutPlan(row)
                              const label = (fp.workoutPlanName || row.remotePlanName || 'Subscribed plan').trim()
                              return (
                                <option
                                  key={`following-${row.subscriptionDocumentId}`}
                                  value={`following:${row.subscriptionDocumentId}`}
                                >
                                  {label} (View-Only)
                                </option>
                              )
                            })}
                        </select>
                      )}
                    </div>
                    {!col.headerPlan ? (
                      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 text-center text-sm text-gray-500">
                        Choose a plan to edit its schedule
                      </div>
                    ) : (
                      <>
            <div className="flex shrink-0 flex-col gap-2 border-b border-gymnext-muted/30 bg-gymnext-background px-2 py-2 sm:px-3">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    col.setColumnWeekStart(addDays(col.columnWeekStart, -col.columnPlanDayCount))
                  }
                  className="rounded border border-gymnext-muted/50 bg-white px-2.5 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-background"
                >
                  ← Prev
                </button>
                <span className="text-xs text-gray-600">
                  {col.columnPlanViewMode === '1day'
                    ? new Date(col.columnWeekStart + 'T12:00:00').toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : <>
                        {new Date(col.columnWeekStart + 'T12:00:00').toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}{' '}
                        –{' '}
                        {new Date(col.columnWeekEnd + 'T12:00:00').toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </>}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    col.setColumnWeekStart(addDays(col.columnWeekStart, col.columnPlanDayCount))
                  }
                  className="rounded border border-gymnext-muted/50 bg-white px-2.5 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-background disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
                >
                  Next →
                </button>
              </div>
            </div>
            <div className="flex shrink-0 justify-center border-b border-gymnext-muted/30 bg-gymnext-background py-2">
              <div className="inline-flex rounded border border-gymnext-muted/50 bg-white p-0.5">
                {(['1day', '3day', 'week'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => col.setColumnPlanViewMode(mode)}
                    className={`rounded px-2.5 py-1 text-xs font-medium ${
                      col.columnPlanViewMode === mode
                        ? 'text-white'
                        : 'text-gray-600 hover:bg-gymnext-background'
                    }`}
                    style={
                      col.columnPlanViewMode === mode
                        ? { backgroundColor: '#6B21A8' }
                        : undefined
                    }
                  >
                    {mode === 'week' ? 'week' : mode === '3day' ? '3 day' : '1 day'}
                  </button>
                ))}
              </div>
            </div>
            <div
              className={`min-h-0 flex-1 overscroll-y-contain ${
                planAheadColumnCount === 1 ? 'overflow-x-auto overflow-y-auto' : 'overflow-y-auto'
              }`}
            >
            <div
              className={
                planAheadColumnCount === 1
                  ? 'flex min-h-0 min-w-full flex-1 divide-x divide-gray-200'
                  : 'grid min-w-full grid-cols-1 divide-y divide-gray-200'
              }
            >
              {Array.from({ length: col.columnPlanDayCount }, (_, i) => {
                const dateKey = addDays(col.columnWeekStart, i)
                const items = col.byDayMap[dateKey] ?? []
                const dayDate = new Date(dateKey + 'T12:00:00')
                const dayName = dayDate.toLocaleDateString(undefined, {
                  weekday: 'short',
                })
                return (
                  <div
                    key={`${col.slot}-${dateKey}`}
                    className={
                      planAheadColumnCount === 1
                        ? 'flex min-h-[160px] min-w-[140px] flex-1 flex-col'
                        : 'flex min-h-[140px] flex-col'
                    }
                  >
                    <div className="px-3 py-2 bg-gymnext-background border-b border-gymnext-muted/30 flex items-center gap-2">
                      <div className="min-w-0 flex-1" aria-hidden />
                      <div className="shrink-0 text-center">
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
                      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
                        {items.length > 0 && (
                          <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect()
                                if (plannedDayMenuDateKey === dateKey && plannedDayMenuPlanId === col.planId) {
                                  setPlannedDayMenuDateKey(null)
                                  setPlannedDayMenuPlanId(null)
                                  setPlannedDayMenuAnchorRect(null)
                                } else {
                                  setPlannedWorkoutMenuId(null)
                                  setPlannedWorkoutMenuAnchorRect(null)
                                  setPlannedDayMenuDateKey(dateKey)
                                  setPlannedDayMenuPlanId(col.planId)
                                  setPlannedDayMenuAnchorRect(rect)
                                }
                              }}
                              className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                              aria-label={`More options for ${dayName}`}
                              aria-expanded={
                                plannedDayMenuDateKey === dateKey && plannedDayMenuPlanId === col.planId
                              }
                            >
                              ⋯
                            </button>
                            {plannedDayMenuDateKey === dateKey &&
                              plannedDayMenuPlanId === col.planId &&
                              plannedDayMenuAnchorRect &&
                              typeof document !== 'undefined' &&
                              createPortal(
                                <>
                                  <div
                                    className="fixed inset-0 z-[100]"
                                    aria-hidden
                                    onClick={() => {
                                      setPlannedDayMenuDateKey(null)
                                      setPlannedDayMenuPlanId(null)
                                      setPlannedDayMenuAnchorRect(null)
                                    }}
                                  />
                                  <div
                                    className="fixed z-[101] min-w-[220px] max-w-[280px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                                    style={{
                                      top: plannedDayMenuAnchorRect.bottom + 4,
                                      right:
                                        typeof window !== 'undefined'
                                          ? window.innerWidth - plannedDayMenuAnchorRect.right
                                          : 0,
                                    }}
                                  >
                                    <button
                                      type="button"
                                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                                      onClick={() => {
                                        setPlannedDayMenuDateKey(null)
                                        setPlannedDayMenuPlanId(null)
                                        setPlannedDayMenuAnchorRect(null)
                                        setCopyAllToDaySourceDateKey(null)
                                        setCopyAllToDaySourcePlanId(null)
                                        setMoveAllSourceDateKey(null)
                                        setMoveAllSourcePlanId(null)
                                        setCopyAllSourceDateKey(dateKey)
                                        setCopyAllSourcePlanId(col.planId)
                                        const sourcePid = col.planId
                                        let defaultTargetPlanId = ''
                                        if (
                                          planAheadColumnCount === 2 &&
                                          sourcePid &&
                                          selectedPlanId &&
                                          selectedPlanIdSecondary
                                        ) {
                                          if (sourcePid === selectedPlanId) {
                                            defaultTargetPlanId = selectedPlanIdSecondary
                                          } else if (sourcePid === selectedPlanIdSecondary) {
                                            defaultTargetPlanId = selectedPlanId
                                          }
                                        }
                                        if (!defaultTargetPlanId) {
                                          defaultTargetPlanId =
                                            plans.find((p) => p.id !== sourcePid)?.id ?? plans[0]?.id ?? ''
                                        }
                                        setCopyAllTargetPlanId(defaultTargetPlanId)
                                        setCopyAllTargetDay(todayYmd)
                                        setCopyAllError(null)
                                      }}
                                    >
                                      Copy all to another plan
                                    </button>
                                    {!planScheduleReadOnly && (
                                      <>
                                        <button
                                          type="button"
                                          className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                                          onClick={() => {
                                            setPlannedDayMenuDateKey(null)
                                            setPlannedDayMenuPlanId(null)
                                            setPlannedDayMenuAnchorRect(null)
                                            setCopyAllSourceDateKey(null)
                                            setCopyAllSourcePlanId(null)
                                            setMoveAllSourceDateKey(null)
                                            setMoveAllSourcePlanId(null)
                                            setCopyAllToDaySourceDateKey(dateKey)
                                            setCopyAllToDaySourcePlanId(col.planId)
                                            setCopyAllToDayTargetDay(todayYmd)
                                            setCopyAllToDayError(null)
                                          }}
                                        >
                                          Copy all to another day
                                        </button>
                                        <button
                                          type="button"
                                          className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                                          onClick={() => {
                                            setPlannedDayMenuDateKey(null)
                                            setPlannedDayMenuPlanId(null)
                                            setPlannedDayMenuAnchorRect(null)
                                            setCopyAllSourceDateKey(null)
                                            setCopyAllSourcePlanId(null)
                                            setCopyAllToDaySourceDateKey(null)
                                            setCopyAllToDaySourcePlanId(null)
                                            setMoveAllSourceDateKey(dateKey)
                                            setMoveAllSourcePlanId(col.planId)
                                            setMoveAllTargetDay(todayYmd)
                                            setMoveAllError(null)
                                          }}
                                        >
                                          Move all to another day
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </>,
                                document.body
                              )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col p-2">
                      {items.length === 0 && dateKey < todayYmd && planScheduleReadOnly && (
                        <div className="mx-0.5 my-1 flex min-h-[5.5rem] flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50/90 px-4 py-5 text-center">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                            Rest day
                          </p>
                        </div>
                      )}
                      {items.length === 0 && !planScheduleReadOnly && (
                        <div className="mx-0.5 my-1 flex min-h-[5.5rem] flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50/90 px-4 py-5 text-center">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                            Rest day
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setScheduleAddTargetPlanId(col.planId!)
                              setCreateDate(dateKey)
                              setAddWorkoutSource('choice')
                              setExpandedCollectionId(null)
                              setCreateError(null)
                              setCreateOpen(true)
                            }}
                            className="mt-3 text-[11px] font-medium text-[#6B21A8] underline decoration-[#6B21A8]/40 underline-offset-2 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6B21A8] focus-visible:ring-offset-2"
                          >
                            Add workout
                          </button>
                        </div>
                      )}
                      {items.length === 0 && dateKey >= todayYmd && planScheduleReadOnly && (
                        <div className="mx-0.5 my-1 flex min-h-[5.5rem] flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50/90 px-4 py-5 text-center">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                            Rest day
                          </p>
                          <p className="mt-2 max-w-[14rem] text-[11px] leading-snug text-gray-500">
                            No workouts on this day.
                          </p>
                        </div>
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
                              const parsed = JSON.parse(raw) as {
                                dateKey: string
                                index: number
                                planId?: string
                              }
                              dateKeyDrag = parsed.dateKey
                              fromIndex = parsed.index
                              if ((parsed.planId ?? col.planId) !== col.planId) {
                                setDraggedPlanned(null)
                                setPlannedDropIndicator(null)
                                return
                              }
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
                            onPlannedWorkoutDrop(dateKey, fromIndex, toIndex, col.planId!)
                          }}
                        >
                          {items.map((pw, index) => {
                          const w = pw.workout
                          const trimmedPlanWorkoutDetails = trimWorkoutDetailsForPreview(pw.workout)
                          const barColor = getWorkoutBarColor(w)
                          /** Owned plans: past days are still editable (⋯ menu + inline schedule). Subscribed (remote) plans: view-only. */
                          const isReadOnly = planScheduleReadOnly
                          const canReorderPlanned = !planScheduleReadOnly
                          const isDragging =
                            draggedPlanned?.dateKey === dateKey &&
                            draggedPlanned?.index === index &&
                            draggedPlanned.planId === col.planId
                          return (
                            <Fragment key={pw.id}>
                              {/* Drop zone above this row: overlaps row above so no visible gap when not dragging */}
                              <li
                                className={`flex items-center list-none border-t-0 -mt-1 pt-1 ${plannedDropIndicator?.dateKey === dateKey && plannedDropIndicator.beforeIndex === index ? 'px-3 pb-1 relative z-10' : 'px-3'}`}
                                aria-hidden
                                onDragOver={(ev) => {
                                  if (!canReorderPlanned) return
                                  ev.preventDefault()
                                  ev.stopPropagation()
                                  ev.dataTransfer.dropEffect = 'move'
                                  if (
                                    draggedPlanned &&
                                    draggedPlanned.dateKey === dateKey &&
                                    draggedPlanned.planId === col.planId
                                  ) {
                                    setPlannedDropIndicator({ dateKey, beforeIndex: index })
                                  }
                                }}
                                onDrop={(ev) => {
                                  ev.preventDefault()
                                  ev.stopPropagation()
                                  const raw = ev.dataTransfer.getData('text/plain')
                                  if (!raw) return
                                  try {
                                    const parsed = JSON.parse(raw) as {
                                      dateKey: string
                                      index: number
                                      planId?: string
                                    }
                                    if (parsed.dateKey !== dateKey) return
                                    if ((parsed.planId ?? col.planId) !== col.planId) return
                                    const toIndex = index
                                    setDraggedPlanned(null)
                                    setPlannedDropIndicator(null)
                                    onPlannedWorkoutDrop(dateKey, parsed.index, toIndex, col.planId!)
                                  } catch {
                                    setDraggedPlanned(null)
                                    setPlannedDropIndicator(null)
                                  }
                                }}
                              >
                                <div className={`flex-1 min-w-0 rounded-full ${plannedDropIndicator?.dateKey === dateKey && plannedDropIndicator.beforeIndex === index ? 'h-1 bg-[#6B21A8]' : 'min-h-0 h-0 overflow-hidden'}`} />
                              </li>
                              <li
                                className={`pl-3 pr-3 py-2 flex items-center gap-3 bg-white ${index > 0 ? 'border-t border-gray-200' : ''} ${isDragging ? 'opacity-50' : ''} hover:bg-gymnext-background/50`}
                                data-index={index}
                                onDragOver={(e) => {
                                  if (!canReorderPlanned) return
                                  e.preventDefault()
                                  e.dataTransfer.dropEffect = 'move'
                                  if (draggedPlanned === null) return
                                  if (draggedPlanned.dateKey !== dateKey || draggedPlanned.planId !== col.planId)
                                    return
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
                                    const parsed = JSON.parse(raw) as {
                                      dateKey: string
                                      index: number
                                      planId?: string
                                    }
                                    if (parsed.dateKey !== dateKey) {
                                      setDraggedPlanned(null)
                                      setPlannedDropIndicator(null)
                                      return
                                    }
                                    if ((parsed.planId ?? col.planId) !== col.planId) {
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
                                    onPlannedWorkoutDrop(dateKey, parsed.index, toIndex, col.planId!)
                                  } catch {
                                    setDraggedPlanned(null)
                                    setPlannedDropIndicator(null)
                                  }
                                }}
                              >
                                <span
                                  className="w-1 shrink-0 rounded-full self-stretch min-h-[3rem]"
                                  style={{ backgroundColor: barColor }}
                                  aria-hidden
                                />
                                {canReorderPlanned ? (
                                  <span
                                    draggable
                                    onDragStart={(e) => {
                                      e.dataTransfer.effectAllowed = 'move'
                                      e.dataTransfer.setData(
                                        'text/plain',
                                        JSON.stringify({ dateKey, index, planId: col.planId! })
                                      )
                                      setDraggedPlanned({ dateKey, index, planId: col.planId! })
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
                                    <DragReorderGrip />
                                  </span>
                                ) : (
                                  <span
                                    className="w-6 shrink-0 flex items-center justify-center text-gray-400 select-none"
                                    aria-hidden
                                  >
                                    <DragReorderGrip />
                                  </span>
                                )}
                                <div
                                  className="min-w-0 flex-1 py-0.5 cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (expandedPlannedWorkoutId === pw.id) {
                                      setExpandedPlannedWorkoutId(null)
                                      setEditSchedulePlannedWorkout(null)
                                      setEditScheduleWorkoutDetails('')
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
                                    {getWorkoutDetailDescription(w) || '—'}
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
                                        setPlannedDayMenuDateKey(null)
                                        setPlannedDayMenuPlanId(null)
                                        setPlannedDayMenuAnchorRect(null)
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
                                        {!planScheduleReadOnly && (
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
                                          Copy to plan
                                        </button>
                                        {!planScheduleReadOnly && (
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
                                    {isReadOnly && trimmedPlanWorkoutDetails !== '' && (
                                      <WorkoutDetailsPreview details={trimmedPlanWorkoutDetails} />
                                    )}
                                    {isReadOnly ? (
                                      <div className="space-y-4">
                                        <fieldset disabled className="space-y-4 opacity-90">
                                          <CreateWorkoutOptions
                                            mode={editScheduleMode}
                                            options={editScheduleOptions}
                                            onChange={() => {}}
                                            parseDurationInput={parseDurationInput}
                                            horizontalLayout
                                          />
                                        </fieldset>
                                        <div className="flex justify-end">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setExpandedPlannedWorkoutId(null)
                                              setEditSchedulePlannedWorkout(null)
                                              setEditScheduleWorkoutDetails('')
                                              setEditScheduleError(null)
                                            }}
                                            className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
                                          >
                                            Close
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <form onSubmit={handleSaveEditSchedule} className="space-y-4">
                                        {pw.workout.type !== 'MultiSegmentWorkout' && (
                                          <div>
                                            <label
                                              htmlFor={`planned-inline-details-${pw.id}`}
                                              className="block text-xs font-medium text-gray-700 mb-1"
                                            >
                                              Workout details (optional)
                                            </label>
                                            <textarea
                                              id={`planned-inline-details-${pw.id}`}
                                              rows={3}
                                              value={editScheduleWorkoutDetails}
                                              onChange={(e) => setEditScheduleWorkoutDetails(e.target.value)}
                                              className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                                              placeholder="e.g. 5×5 Back Squat @ 135#, 3×10 RDL, 2×20 KB swings"
                                            />
                                          </div>
                                        )}
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
                                              setEditScheduleWorkoutDetails('')
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
                                    )}
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
                                  if (!planScheduleReadOnly) {
                                    ev.preventDefault()
                                    ev.stopPropagation()
                                    ev.dataTransfer.dropEffect = 'move'
                                    if (
                                      draggedPlanned &&
                                      draggedPlanned.dateKey === dateKey &&
                                      draggedPlanned.planId === col.planId
                                    ) {
                                      setPlannedDropIndicator({ dateKey, beforeIndex: items.length })
                                    }
                                  }
                                }}
                                onDrop={(ev) => {
                                  if (planScheduleReadOnly) return
                                  ev.preventDefault()
                                  ev.stopPropagation()
                                  const raw = ev.dataTransfer.getData('text/plain')
                                  if (!raw) return
                                  try {
                                    const parsed = JSON.parse(raw) as {
                                      dateKey: string
                                      index: number
                                      planId?: string
                                    }
                                    if (parsed.dateKey !== dateKey) return
                                    if ((parsed.planId ?? col.planId) !== col.planId) return
                                    const toIndex = items.length
                                    setDraggedPlanned(null)
                                    setPlannedDropIndicator(null)
                                    onPlannedWorkoutDrop(dateKey, parsed.index, toIndex, col.planId!)
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
                      {!planScheduleReadOnly && items.length > 0 && (
                        <div className="mt-2 flex shrink-0 justify-center border-t border-gray-100 pt-3 pb-1">
                          <button
                            type="button"
                            onClick={() => {
                              setScheduleAddTargetPlanId(col.planId!)
                              setCreateDate(dateKey)
                              setAddWorkoutSource('choice')
                              setExpandedCollectionId(null)
                              setCreateError(null)
                              setCreateOpen(true)
                            }}
                            className="rounded px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                            style={{ backgroundColor: '#6B21A8' }}
                          >
                            Add workout
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : !selectedPlan ? (
            <p className="flex flex-1 items-center justify-center px-4 py-8 text-center text-sm text-gray-500">
              Select a plan to see its details
            </p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="relative flex shrink-0 items-start justify-between gap-2 border-b border-gray-100 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{selectedPlanName}</p>
                  <p className="text-xs text-gray-600 mt-1">{selectedPlanDescription}</p>
                </div>
                {selectedPlan && (!planScheduleReadOnly || selectedFollowingRow) ? (
                  <div className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setPlanAdminMoreOpen((o) => !o)}
                      className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                      aria-label="More options"
                      aria-expanded={planAdminMoreOpen}
                    >
                      ⋯
                    </button>
                    {planAdminMoreOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          aria-hidden
                          onClick={() => setPlanAdminMoreOpen(false)}
                        />
                        <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                          {planScheduleReadOnly && selectedFollowingRow ? (
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                              onClick={() => {
                                setPlanAdminMoreOpen(false)
                                setStopFollowingConfirmOpen(true)
                              }}
                            >
                              Unsubscribe
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                                onClick={() => {
                                  setPlanAdminMoreOpen(false)
                                  openEditPlan(selectedPlan)
                                }}
                              >
                                Edit plan
                              </button>
                              {!selectedPlan.isPersonal && (
                                <button
                                  type="button"
                                  className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                                  onClick={() => {
                                    setPlanAdminMoreOpen(false)
                                    setPlanShareOpen(true)
                                  }}
                                >
                                  Share plan
                                </button>
                              )}
                              {selectedPlan.id !== 'personal' && (
                                <>
                                  <div className="my-1 border-t border-gray-200" aria-hidden />
                                  <button
                                    type="button"
                                    className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                                    onClick={() => {
                                      setPlanAdminMoreOpen(false)
                                      setPlanDeleteConfirmOpen(true)
                                    }}
                                  >
                                    Delete plan
                                  </button>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
              {!planScheduleReadOnly && selectedPlan ? (
                <div className="shrink-0 border-b border-gray-100 px-4 py-3">
                  <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">Show in Today&apos;s Plan</p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        When on, this plan appears in Today&apos;s Plan. When off, it stays in Plans and Plan Ahead
                        only.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={planShowsInTodayTab(selectedPlan)}
                      aria-label="Show in Today's Plan"
                      disabled={showInScheduleSaving}
                      onClick={() => {
                        void (async () => {
                          const next = !planShowsInTodayTab(selectedPlan)
                          setShowInScheduleSaving(true)
                          try {
                            await onSetPlanShowInSchedule(selectedPlan.id, next)
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : 'Failed to update')
                          } finally {
                            setShowInScheduleSaving(false)
                          }
                        })()
                      }}
                      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#6B21A8] disabled:opacity-50 ${
                        planShowsInTodayTab(selectedPlan) ? 'bg-[#6B21A8]' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                          planShowsInTodayTab(selectedPlan) ? 'translate-x-5' : 'translate-x-0'
                        }`}
                        aria-hidden
                      />
                    </button>
                  </div>
                </div>
              ) : null}
              {planSharesBelowHeader}
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-5">
                {planScheduleReadOnly ? (
                  selectedFollowingRow ? (
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Plan owner
                      </h4>
                      <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      {followedCoachProfileLoading && (
                        <p className="text-sm text-gray-500">Loading profile…</p>
                      )}
                      {!followedCoachProfileLoading && followedCoachProfileError && (
                        <div className="space-y-2">
                          <p className="text-sm text-red-700">{followedCoachProfileError}</p>
                          <button
                            type="button"
                            onClick={() => {
                              const ownerId = selectedFollowingRow.ownerUserId
                              setFollowedCoachProfileError(null)
                              setFollowedCoachProfileLoading(true)
                              void (async () => {
                                try {
                                  const res = await authedFetch(
                                    `/api/app/users/${encodeURIComponent(ownerId)}/public-profile`
                                  )
                                  if (!res.ok) {
                                    const j = (await res.json().catch(() => ({}))) as { error?: string }
                                    throw new Error(j.error || `HTTP ${res.status}`)
                                  }
                                  const data = (await res.json()) as PublicUserProfileView
                                  setFollowedCoachProfile(data)
                                  setFollowedCoachProfileError(null)
                                } catch (e) {
                                  setFollowedCoachProfileError(
                                    e instanceof Error ? e.message : 'Failed to load profile'
                                  )
                                } finally {
                                  setFollowedCoachProfileLoading(false)
                                }
                              })()
                            }}
                            className="rounded px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                            style={{ backgroundColor: '#6B21A8' }}
                          >
                            Retry
                          </button>
                        </div>
                      )}
                      {!followedCoachProfileLoading && !followedCoachProfileError && followedCoachProfile && (
                        <div className="space-y-3">
                          <button
                            type="button"
                            onClick={() =>
                              setPlanOwnerPublicProfileUserId(selectedFollowingRow.ownerUserId)
                            }
                            className="w-full rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                          >
                            <div className="flex gap-4 items-start">
                              {followedCoachProfile.profilePhotoUrl ? (
                                <img
                                  src={followedCoachProfile.profilePhotoUrl}
                                  alt=""
                                  className="h-16 w-16 shrink-0 rounded-full border border-gymnext-muted/30 bg-white object-cover"
                                  width={64}
                                  height={64}
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div
                                  className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-gymnext-muted/30 bg-white text-xl font-semibold text-gray-600"
                                  aria-hidden
                                >
                                  {(followedCoachProfile.displayName || '?').slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-base font-semibold text-gray-900 leading-snug">
                                  {followedCoachProfile.displayName}
                                </p>
                                {followedCoachProfile.handle ? (
                                  <p className="mt-0.5 text-sm text-gray-600">{followedCoachProfile.handle}</p>
                                ) : null}
                                {[
                                  followedCoachProfile.city,
                                  followedCoachProfile.region,
                                  followedCoachProfile.country,
                                ]
                                  .filter(Boolean)
                                  .join(', ') ? (
                                  <p className="mt-2 text-xs text-gray-500">
                                    {[
                                      followedCoachProfile.city,
                                      followedCoachProfile.region,
                                      followedCoachProfile.country,
                                    ]
                                      .filter(Boolean)
                                      .join(', ')}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </button>
                          {selectedFollowingRow.remotePlanHandle ? (
                            <p className="text-xs text-gray-500">
                              Plan on FlexTimer:{' '}
                              <span className="font-medium text-gray-700">
                                @{selectedFollowingRow.remotePlanHandle}
                              </span>
                            </p>
                          ) : null}
                        </div>
                      )}
                      </div>
                      <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                          Your access
                        </h4>
                        {followedPlanIsGroupTraining(selectedFollowingRow) ? (
                          <p className="text-sm text-gray-800">
                            <span className="font-semibold text-gray-900">Visibility.</span>{' '}
                            {selectedFollowingRow.shareHideFutureWorkouts
                              ? 'You cannot view future scheduled workouts.'
                              : 'You can view future scheduled workouts.'}
                          </p>
                        ) : (
                          <p className="text-sm text-gray-800">
                            <span className="font-semibold text-gray-900">Privileges.</span>{' '}
                            {selectedFollowingRow.shareAllowEditing
                              ? 'You can edit this plan and scheduled workouts with the owner.'
                              : 'Read-only: you cannot edit the plan or workouts.'}
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-600">Subscribed plan details are unavailable.</p>
                  )
                ) : selectedPlan ? (
                  <>
                    {selectedPlan.handle ? (
                      <dl className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-3 gap-y-2 text-sm rounded-lg border border-gray-100 bg-gray-50/80 p-3">
                        <dt className="text-gray-500">Handle</dt>
                        <dd className="text-gray-900">{selectedPlan.handle}</dd>
                      </dl>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>

      {createOpen && planForScheduleCreate && !planScheduleReadOnly && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() =>
              !createBusy &&
              (setCreateOpen(false),
              setScheduleAddTargetPlanId(null),
              setAddWorkoutSource('choice'),
              setExpandedCollectionId(null),
              setSelectedWorkoutForPlan(null))
            }
          />
          <div className="relative w-full max-w-lg rounded-lg border border-gymnext-muted/30 bg-white shadow-lg max-h-[85vh] flex flex-col">
            <div className="border-b border-gymnext-muted/30 px-4 py-3 shrink-0">
              <h3 className="text-sm font-semibold text-gray-800">
                Add planned workout
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {addWorkoutSource === 'choice' && 'Add from Favorites, a collection, or create new.'}
                {addWorkoutSource === 'favorites' && 'Pick a workout from Favorites.'}
                {addWorkoutSource === 'collection' && 'Pick a collection, then a workout.'}
                {addWorkoutSource === 'createNew' && (createNewStep === 0
                  ? 'Choose the workout type.'
                  : createNewNameStep
                    ? 'Optionally set a name and description.'
                    : createMode === 3
                      ? (createNewMixedStep === 1 ? 'Step 1 of 2: Add and order your intervals.' : 'Step 2 of 2: Set repeats, rest between repeats, and direction.')
                      : 'Configure the timer settings for this workout.')}
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
                      className="w-full rounded border border-gymnext-muted/40 bg-white px-4 py-3 flex items-center gap-3 text-left text-sm font-medium text-gray-900 hover:bg-gymnext-background"
                    >
                      <span
                        className="w-1 shrink-0 rounded-full self-stretch min-h-[3rem] bg-yellow-400"
                        aria-hidden
                      />
                      <svg className="h-5 w-5 shrink-0 text-yellow-500" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                      Add from Favorites
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddWorkoutSource('collection')}
                      className="w-full rounded border border-gymnext-muted/40 bg-white px-4 py-3 flex items-center gap-3 text-left text-sm font-medium text-gray-900 hover:bg-gymnext-background"
                    >
                      <span
                        className="w-1 shrink-0 rounded-full self-stretch min-h-[3rem] bg-amber-800"
                        aria-hidden
                      />
                      <svg className="h-5 w-5 shrink-0 text-amber-800" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      Add from Collection
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const defaultMode = 1
                        setAddWorkoutSource('createNew')
                        setCreateMode(defaultMode)
                        setCreateNewStep(0)
                        setCreateNewMixedStep(1)
                        setCreateNewNameStep(false)
                        setCreateOptions(
                          getDefaultOptionsForMode(
                            defaultMode,
                            timerDefaults?.direction,
                            timerDefaults?.restDirection,
                            timerDefaults?.warmupDuration,
                            timerDefaults?.warmupDirection,
                            timerDefaults?.cooldownDuration,
                            timerDefaults?.cooldownDirection
                          )
                        )
                      }}
                      className="w-full rounded border border-gymnext-muted/40 bg-white px-4 py-3 flex items-center gap-3 text-left text-sm font-medium text-gray-900 hover:bg-gymnext-background"
                    >
                      <span
                        className="w-1 shrink-0 rounded-full self-stretch min-h-[3rem]"
                        style={{ backgroundColor: '#6B21A8' }}
                        aria-hidden
                      />
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
                              className={`w-full rounded border px-3 py-2 text-left text-sm disabled:opacity-50 flex items-center gap-3 ${
                                isSelected
                                  ? 'border-gymnext bg-purple-50 border-2'
                                  : 'border-gray-200 hover:bg-gray-50'
                              }`}
                              style={
                                isSelected
                                  ? {
                                      borderTopColor: '#6B21A8',
                                      borderRightColor: '#6B21A8',
                                      borderBottomColor: '#6B21A8',
                                      borderLeftColor: '#6B21A8',
                                    }
                                  : undefined
                              }
                            >
                              <span
                                className="w-1 shrink-0 rounded-full self-stretch min-h-[2.5rem]"
                                style={{ backgroundColor: barColor }}
                                aria-hidden
                              />
                              <span className="min-w-0 flex-1">
                                <span className="font-medium text-gray-900">{getWorkoutDisplayName(w) || 'Workout'}</span>
                                {(getWorkoutDetailDescription(w) || '').trim() && (
                                  <span className="block text-xs text-gray-500 truncate">{getWorkoutDetailDescription(w)}</span>
                                )}
                              </span>
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
                              className="w-full pl-3 pr-3 py-2 flex items-center gap-3 justify-between text-left text-sm font-medium text-gray-900 hover:bg-gray-50"
                            >
                              <span
                                className="w-1 shrink-0 rounded-full self-stretch min-h-[2.5rem]"
                                style={{ backgroundColor: '#795548' }}
                                aria-hidden
                              />
                              <CollectionFolderIcon />
                              <span className="min-w-0 flex-1">{c.workoutCollectionName || 'Unnamed'}</span>
                              <span className="text-gray-400 shrink-0">{isExpanded ? '▼' : '▶'}</span>
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
                                          className={`w-full rounded border px-3 py-2 text-left text-sm disabled:opacity-50 flex items-center gap-3 ${
                                            isSelected
                                              ? 'border-gymnext bg-purple-50 border-2'
                                              : 'border-gray-200 bg-white hover:bg-gray-50'
                                          }`}
                                          style={
                                            isSelected
                                              ? {
                                                  borderTopColor: '#6B21A8',
                                                  borderRightColor: '#6B21A8',
                                                  borderBottomColor: '#6B21A8',
                                                  borderLeftColor: '#6B21A8',
                                                }
                                              : undefined
                                          }
                                        >
                                          <span
                                            className="w-1 shrink-0 rounded-full self-stretch min-h-[2.5rem]"
                                            style={{ backgroundColor: barColor }}
                                            aria-hidden
                                          />
                                          <span className="min-w-0 flex-1">
                                            <span className="font-medium text-gray-900">{getWorkoutDisplayName(w) || 'Workout'}</span>
                                            {(getWorkoutDetailDescription(w) || '').trim() && (
                                              <span className="block text-xs text-gray-500 truncate">{getWorkoutDetailDescription(w)}</span>
                                            )}
                                          </span>
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
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (createNewNameStep) {
                        setCreateNewNameStep(false)
                      } else if (createMode === 3 && createNewMixedStep === 2) {
                        setCreateNewMixedStep(1)
                      } else if (createNewStep === 1) {
                        setCreateNewStep(0)
                      } else {
                        setAddWorkoutSource('choice')
                      }
                    }}
                    className="text-xs text-gymnext-dark hover:text-gymnext hover:underline"
                  >
                    ← Back
                  </button>
                  {createNewStep === 0 ? (
                    <>
                      <div>
                        <label
                          htmlFor="plan-mode"
                          className="block text-xs font-medium text-gray-700 mb-1"
                        >
                          Workout type
                        </label>
                        <select
                          id="plan-mode"
                          value={createMode}
                          onChange={(e) => {
                            const newMode = Number(e.target.value)
                            setCreateMode(newMode)
                            if (newMode !== 3) setCreateNewMixedStep(1)
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
                          onClick={() => setCreateNewStep(1)}
                          className="rounded px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                          style={{ backgroundColor: '#6B21A8' }}
                        >
                          Next
                        </button>
                      </div>
                    </>
                  ) : createNewNameStep ? (
                    <>
                      <div>
                        <label htmlFor="create-planned-name" className="block text-xs font-medium text-gray-700 mb-1">Name (optional)</label>
                        <input
                          id="create-planned-name"
                          type="text"
                          value={createPlannedName}
                          onChange={(e) => setCreatePlannedName(e.target.value)}
                          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                          placeholder="Workout name"
                        />
                      </div>
                      <div>
                        <label htmlFor="create-planned-desc" className="block text-xs font-medium text-gray-700 mb-1">Description (optional)</label>
                        <textarea
                          id="create-planned-desc"
                          rows={2}
                          value={createPlannedDescription}
                          onChange={(e) => setCreatePlannedDescription(e.target.value)}
                          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                          placeholder="Optional description"
                        />
                      </div>
                      <div>
                        <label htmlFor="create-planned-details" className="block text-xs font-medium text-gray-700 mb-1">Workout details (optional)</label>
                        <textarea
                          id="create-planned-details"
                          rows={6}
                          value={createPlannedDetails}
                          onChange={(e) => setCreatePlannedDetails(e.target.value)}
                          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                          placeholder="e.g. 5×5 Back Squat @ 135#, 3×10 RDL, 2×20 KB swings"
                        />
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setCreateNewNameStep(false)}
                          disabled={createBusy}
                          className="rounded bg-gymnext-background px-3 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                        >
                          Back
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
                  ) : (
                  <>
                  {createMode === 3 ? (
                    createNewMixedStep === 1 ? (
                      <>
                        <CreateWorkoutOptions
                          mode={createMode}
                          options={createOptions}
                          onChange={setCreateOptions}
                          parseDurationInput={parseDurationInput}
                          mixedIntervalsStep={1}
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
                            onClick={() => setCreateNewMixedStep(2)}
                            disabled={!hasValidDurationForMode(createMode, createOptions, parseDurationInput)}
                            className="rounded px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                            style={{ backgroundColor: '#6B21A8' }}
                          >
                            Next
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <CreateWorkoutOptions
                          mode={createMode}
                          options={createOptions}
                          onChange={setCreateOptions}
                          parseDurationInput={parseDurationInput}
                          mixedIntervalsStep={2}
                        />
                        <div className="flex justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setCreateNewMixedStep(1)}
                            disabled={createBusy}
                            className="rounded bg-gymnext-background px-3 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                          >
                            Back
                          </button>
                          <button
                            type="button"
                            onClick={() => setCreateNewNameStep(true)}
                            disabled={createBusy || !canAddPlannedForSelectedDate || !hasValidDurationForMode(createMode, createOptions, parseDurationInput)}
                            className="rounded px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                            style={{ backgroundColor: '#6B21A8' }}
                          >
                            Next
                          </button>
                        </div>
                      </>
                    )
                  ) : (
                    <>
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
                          onClick={() => setCreateNewNameStep(true)}
                          disabled={createBusy || !canAddPlannedForSelectedDate || !hasValidDurationForMode(createMode, createOptions, parseDurationInput)}
                          className="rounded px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                          style={{ backgroundColor: '#6B21A8' }}
                        >
                          Next
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
                </div>
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
            onClick={() => {
              if (createPlanBusy) return
              setCreatePlanOpen(false)
              setCreatePlanKind('privateTraining')
            }}
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
                <p className="block text-xs font-medium text-gray-700 mb-1">Training type</p>
                <div className="inline-flex max-w-full flex-wrap rounded border border-gymnext-muted/50 bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => setCreatePlanKind('personal')}
                    disabled={createPlanBusy}
                    className={`rounded px-3 py-1.5 text-xs font-medium ${
                      createPlanKind === 'personal'
                        ? 'text-white'
                        : 'text-gray-600 hover:bg-gymnext-background'
                    } disabled:opacity-50`}
                    style={createPlanKind === 'personal' ? { backgroundColor: '#6B21A8' } : undefined}
                  >
                    Personal
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatePlanKind('privateTraining')}
                    disabled={createPlanBusy}
                    className={`rounded px-3 py-1.5 text-xs font-medium ${
                      createPlanKind === 'privateTraining'
                        ? 'text-white'
                        : 'text-gray-600 hover:bg-gymnext-background'
                    } disabled:opacity-50`}
                    style={
                      createPlanKind === 'privateTraining' ? { backgroundColor: '#6B21A8' } : undefined
                    }
                  >
                    Private Training
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatePlanKind('groupTraining')}
                    disabled={createPlanBusy}
                    className={`rounded px-3 py-1.5 text-xs font-medium ${
                      createPlanKind === 'groupTraining'
                        ? 'text-white'
                        : 'text-gray-600 hover:bg-gymnext-background'
                    } disabled:opacity-50`}
                    style={
                      createPlanKind === 'groupTraining' ? { backgroundColor: '#6B21A8' } : undefined
                    }
                  >
                    Group Training
                  </button>
                </div>
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
                  onClick={() => {
                    setCreatePlanOpen(false)
                    setCreatePlanKind('privateTraining')
                  }}
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

      {planShareOpen && rightPanelMode !== 'schedule' && selectedPlan && !selectedPlan.isPersonal && (
        <PlanShareDialogs
          user={user}
          open={planShareOpen}
          onClose={() => setPlanShareOpen(false)}
          planId={selectedPlan.id}
          planName={selectedPlan.workoutPlanName}
          allowsHubShare={selectedPlan.trainingIntent === 1}
        />
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
              Delete this plan?
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

      {stopPlanShareConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stop-plan-share-title"
        >
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !stopPlanShareBusy && setStopPlanShareConfirm(null)}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <h3 id="stop-plan-share-title" className="text-sm font-semibold text-gray-900">
              Stop sharing?
            </h3>
            <p className="mt-2 text-sm text-gray-700">
              {stopPlanShareConfirm.kind === 'group' ? (
                <>
                  Remove this plan’s share with{' '}
                  <span className="font-medium text-gray-900">{stopPlanShareConfirm.label}</span>? The share link and
                  hub feed entry for this share will be removed.
                </>
              ) : (
                <>
                  Remove this plan’s share with{' '}
                  <span className="font-medium text-gray-900">{stopPlanShareConfirm.label}</span>? The share link and
                  feed items for this share will be removed.
                </>
              )}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStopPlanShareConfirm(null)}
                disabled={stopPlanShareBusy}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmStopPlanShare()}
                disabled={stopPlanShareBusy}
                className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {stopPlanShareBusy ? 'Removing…' : 'Stop sharing'}
              </button>
            </div>
          </div>
        </div>
      )}

      {stopFollowingConfirmOpen && selectedFollowingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !stopFollowingBusy && setStopFollowingConfirmOpen(false)}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <p className="text-sm text-gray-800">
              Unsubscribe from <span className="font-medium text-gray-900">{selectedPlanName}</span>? You can subscribe
              to this plan again later if the coach shares it with you.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStopFollowingConfirmOpen(false)}
                disabled={stopFollowingBusy}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmStopFollowing()}
                disabled={stopFollowingBusy}
                className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {stopFollowingBusy ? 'Unsubscribing…' : 'Unsubscribe'}
              </button>
            </div>
          </div>
        </div>
      )}

      <PublicUserProfileDialog
        open={planOwnerPublicProfileUserId != null}
        userId={planOwnerPublicProfileUserId}
        onClose={() => setPlanOwnerPublicProfileUserId(null)}
        viewer={user}
      />
      <GroupPublicProfileDialog
        open={planSharingHubProfileGroupId != null}
        groupId={planSharingHubProfileGroupId}
        onClose={() => setPlanSharingHubProfileGroupId(null)}
        viewer={user}
      />
      <PublicUserProfileDialog
        open={planSharingConnectionProfileUserId != null}
        userId={planSharingConnectionProfileUserId}
        onClose={() => setPlanSharingConnectionProfileUserId(null)}
        viewer={user}
      />

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
            onClick={() => {
              if (!editScheduleBusy) {
                setEditSchedulePlannedWorkout(null)
                setEditScheduleWorkoutDetails('')
              }
            }}
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
                  onClick={() => {
                    setEditSchedulePlannedWorkout(null)
                    setEditScheduleWorkoutDetails('')
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
              <h3 className="text-sm font-semibold text-gray-800">Copy to plan</h3>
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

      {copyAllSourceDateKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => {
              if (!copyAllBusy) {
                setCopyAllSourceDateKey(null)
                setCopyAllSourcePlanId(null)
              }
            }}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
            <div className="border-b border-gymnext-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">Copy all to another plan</h3>
              <p className="mt-0.5 text-xs text-gray-500">
                Copy{' '}
                {((
                  copyAllSourcePlanId && selectedPlanIdSecondary && copyAllSourcePlanId === selectedPlanIdSecondary
                    ? scheduleSecondByDay ?? {}
                    : byDay
                )[copyAllSourceDateKey] ?? []
                ).length}{' '}
                workout
                {((
                  copyAllSourcePlanId && selectedPlanIdSecondary && copyAllSourcePlanId === selectedPlanIdSecondary
                    ? scheduleSecondByDay ?? {}
                    : byDay
                )[copyAllSourceDateKey] ?? []
                ).length === 1
                  ? ''
                  : 's'}{' '}
                from{' '}
                {new Date(copyAllSourceDateKey + 'T12:00:00').toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
                . Choose the plan and date to add copies (same order).
              </p>
            </div>
            <form onSubmit={handleCopyAllToPlan} className="space-y-4 p-4">
              <div>
                <label htmlFor="copy-all-target-plan" className="mb-1 block text-xs font-medium text-gray-700">
                  Plan
                </label>
                <select
                  id="copy-all-target-plan"
                  value={copyAllTargetPlanId}
                  onChange={(e) => setCopyAllTargetPlanId(e.target.value)}
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
                <label htmlFor="copy-all-target-day" className="mb-1 block text-xs font-medium text-gray-700">
                  Date
                </label>
                <input
                  id="copy-all-target-day"
                  type="date"
                  value={copyAllTargetDay}
                  onChange={(e) => setCopyAllTargetDay(e.target.value.slice(0, 10))}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                />
              </div>
              {copyAllError && <p className="text-xs text-red-600">{copyAllError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCopyAllSourceDateKey(null)
                    setCopyAllSourcePlanId(null)
                  }}
                  disabled={copyAllBusy}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={copyAllBusy || !copyAllTargetPlanId || !copyAllTargetDay}
                  className="rounded px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  {copyAllBusy ? 'Copying…' : 'Copy all'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {copyAllToDaySourceDateKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !copyAllToDayBusy && setCopyAllToDaySourceDateKey(null)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
            <div className="border-b border-gymnext-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">Copy all to another day</h3>
              <p className="mt-0.5 text-xs text-gray-500">
                Copy {(byDay[copyAllToDaySourceDateKey] ?? []).length} workout
                {(byDay[copyAllToDaySourceDateKey] ?? []).length === 1 ? '' : 's'} from{' '}
                {new Date(copyAllToDaySourceDateKey + 'T12:00:00').toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}{' '}
                onto this plan on the date you pick (same order).
              </p>
            </div>
            <form onSubmit={handleCopyAllToDay} className="space-y-4 p-4">
              <div>
                <label htmlFor="copy-all-to-day-target" className="mb-1 block text-xs font-medium text-gray-700">
                  Date
                </label>
                <input
                  id="copy-all-to-day-target"
                  type="date"
                  value={copyAllToDayTargetDay}
                  onChange={(e) => setCopyAllToDayTargetDay(e.target.value.slice(0, 10))}
                  min={todayYmd}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                />
              </div>
              {copyAllToDayError && <p className="text-xs text-red-600">{copyAllToDayError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCopyAllToDaySourceDateKey(null)}
                  disabled={copyAllToDayBusy}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={copyAllToDayBusy || !copyAllToDayTargetDay}
                  className="rounded px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  {copyAllToDayBusy ? 'Copying…' : 'Copy all'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {moveAllSourceDateKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !moveAllBusy && setMoveAllSourceDateKey(null)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
            <div className="border-b border-gymnext-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-800">Move all to another day</h3>
              <p className="mt-0.5 text-xs text-gray-500">
                Move {(byDay[moveAllSourceDateKey] ?? []).length} workout
                {(byDay[moveAllSourceDateKey] ?? []).length === 1 ? '' : 's'} from{' '}
                {new Date(moveAllSourceDateKey + 'T12:00:00').toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
                . They stay on this plan and keep the same order on the new date.
              </p>
            </div>
            <form onSubmit={handleMoveAllToDay} className="space-y-4 p-4">
              <div>
                <label htmlFor="move-all-target-day" className="mb-1 block text-xs font-medium text-gray-700">
                  Date
                </label>
                <input
                  id="move-all-target-day"
                  type="date"
                  value={moveAllTargetDay}
                  onChange={(e) => setMoveAllTargetDay(e.target.value.slice(0, 10))}
                  min={todayYmd}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                />
              </div>
              {moveAllError && <p className="text-xs text-red-600">{moveAllError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setMoveAllSourceDateKey(null)}
                  disabled={moveAllBusy}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={moveAllBusy || !moveAllTargetDay}
                  className="rounded px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  {moveAllBusy ? 'Moving…' : 'Move all'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
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

/** Timer modes for planned workouts: Warmup and Cooldown first; no Lap Timer / Shot Clock; includes Mixed Intervals; Multi-Segment not offered. */
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
]

/** Timer modes allowed when adding a segment to a multi-segment workout. */
const SEGMENT_CREATABLE_TIMER_MODES: { value: number; label: string }[] = [
  { value: 10, label: 'Warmup' },
  { value: 11, label: 'Cooldown' },
  { value: 1, label: 'Standard' },
  { value: 2, label: 'Rounds' },
  { value: 3, label: 'Mixed Intervals' },
  { value: 12, label: 'Sets with Rest' },
  { value: 5, label: 'EMOM' },
  { value: 4, label: 'Tabata' },
  { value: 13, label: 'Rest' },
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
function parseScheduleToOptions(
  scheduleStr: string | null | undefined,
  explicitTimerMode?: unknown
): {
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
    const hasCustomIntervals =
      Array.isArray(schedule.customIntervalTypes) ||
      Array.isArray(schedule.customIntervalDurations) ||
      Array.isArray(schedule.customIntervalRestDurations) ||
      Array.isArray(schedule.customIntervalRepeats)

    const coerceMode = (val: unknown): number | undefined => {
      if (typeof val === 'number') return val
      if (typeof val === 'string') {
        const n = parseInt(val, 10)
        return Number.isNaN(n) ? undefined : n
      }
      return undefined
    }

    // Prefer explicit timerMode from caller (which may be string or number), falling back to schedule.timerMode.
    const rawTimerMode =
      coerceMode(explicitTimerMode) ?? coerceMode(schedule.timerMode)

    // Use raw timerMode when present, but override mis-labeled Standard (1) that actually has custom intervals.
    if (typeof rawTimerMode === 'number') {
      const tm = rawTimerMode
      mode = tm === 1 && hasCustomIntervals ? 3 : tm
    } else {
      mode = hasCustomIntervals ? 3 : 1
    }
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
        /** customIntervalTypes in schedule: 1=duration, 2=rest, 3=durationRepeated, 4=durationRestRepeated. Never 0 (rep).
         * customIntervalDurations:
         *   - type=duration or durationRepeated: work duration
         *   - type=rest: rest duration
         *   - type=durationRestRepeated: work duration
         * customIntervalRestDurations:
         *   - only used for type=durationRestRepeated: rest duration inside the block
         */
        const typeNumToStr = { 1: 'duration' as const, 2: 'rest' as const, 3: 'durationRepeated' as const, 4: 'durationRestRepeated' as const }
        const rawTypes = Array.isArray(schedule.customIntervalTypes) ? schedule.customIntervalTypes : []
        const types = rawTypes.map((t) => {
          const n = typeof t === 'number' ? t : typeof t === 'string' && /^[1-4]$/.test(t) ? parseInt(t, 10) : 0
          return typeNumToStr[n as 1 | 2 | 3 | 4] ?? 'duration'
        })
        const durations = Array.isArray(schedule.customIntervalDurations)
          ? (schedule.customIntervalDurations as number[])
          : []
        const restDurations = Array.isArray(schedule.customIntervalRestDurations)
          ? (schedule.customIntervalRestDurations as number[])
          : []
        const repeats = Array.isArray(schedule.customIntervalRepeats)
          ? (schedule.customIntervalRepeats as number[])
          : []
        const validIntervalTypes = ['duration', 'rest', 'durationRepeated', 'durationRestRepeated'] as const
        const intervals: Array<{ type: string; duration?: string; restDuration?: string; repeats?: number }> = types.map((normalizedType, i) => {
          const item: { type: string; duration?: string; restDuration?: string; repeats?: number } = { type: normalizedType }
          const primary = durations[i] ?? 0
          const secondary = restDurations[i] ?? 0
          if (normalizedType === 'duration' || normalizedType === 'durationRepeated' || normalizedType === 'durationRestRepeated') {
            item.duration = formatDuration(primary)
          }
          if (normalizedType === 'rest') {
            // Rest-only interval: its rest duration is stored in customIntervalDurations.
            item.restDuration = formatDuration(primary)
          }
          if (normalizedType === 'durationRestRepeated') {
            // Work/rest block: rest duration is stored in customIntervalRestDurations.
            item.restDuration = formatDuration(secondary)
          }
          if (normalizedType === 'durationRepeated' || normalizedType === 'durationRestRepeated') {
            item.repeats = repeats[i] ?? 1
          }
          return item
        })
        options.customIntervalsJson = JSON.stringify(intervals)
        options.customIntervalNumberOfRounds = num('customIntervalNumberOfRounds') || 1
        const restBetweenRoundsSeconds =
          num('customIntervalRestBetweenRounds') || dur('customIntervalRestBetweenRounds')
        options.customIntervalRestBetweenRounds = formatDuration(restBetweenRoundsSeconds)
        const restBetweenIntervalsSeconds =
          num('customIntervalRestBetweenIntervals') || dur('customIntervalRestBetweenIntervals')
        options.customIntervalRestBetweenIntervals = formatDuration(restBetweenIntervalsSeconds)
        options.customIntervalRestBetweenIntervalsEnabled = restBetweenIntervalsSeconds > 0 ? 1 : 0
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
      /** customIntervalTypes in schedule: 1=duration, 2=rest, 3=durationRepeated, 4=durationRestRepeated. Never 0.
       * customIntervalDurations:
       *   - type=duration or durationRepeated: work duration
       *   - type=rest: rest duration
       *   - type=durationRestRepeated: work duration
       * customIntervalRestDurations:
       *   - only used for type=durationRestRepeated: rest duration inside the block
       */
      const typeStrToNum: Record<string, number> = { duration: 1, rest: 2, durationRepeated: 3, durationRestRepeated: 4 }
      const types: number[] = []
      const durations: number[] = []
      const restDurations: number[] = []
      const repeats: number[] = []
      /** Set names: null means no name for that interval set. */
      const setNames: Array<string | null> = []
      try {
        const raw = options.customIntervalsJson
        const arr = typeof raw === 'string' ? (JSON.parse(raw) as Array<{ type: string; duration?: string; restDuration?: string; repeats?: number }>) : []
        const validIntervalTypes = ['duration', 'rest', 'durationRepeated', 'durationRestRepeated'] as const
        const normalizeType = (rawType: unknown): (typeof validIntervalTypes)[number] => {
          const t = typeof rawType === 'string' ? rawType : 'duration'
          if (t === 'rep') return 'durationRepeated'
          return validIntervalTypes.includes(t as (typeof validIntervalTypes)[number]) ? (t as (typeof validIntervalTypes)[number]) : 'duration'
        }
        for (const it of arr) {
          const t = normalizeType(it.type)
          types.push(typeStrToNum[t] ?? 1)
          // primarySeconds: value stored in customIntervalDurations
          // secondarySeconds: value stored in customIntervalRestDurations (only for durationRestRepeated)
          let primarySeconds = 0
          let secondarySeconds = 0
          if (t === 'duration' || t === 'durationRepeated' || t === 'durationRestRepeated') {
            primarySeconds = it.duration != null ? parseDuration(String(it.duration)) : 0
          }
          if (t === 'rest') {
            primarySeconds = it.restDuration != null ? parseDuration(String(it.restDuration)) : 0
          }
          if (t === 'durationRestRepeated') {
            secondarySeconds = it.restDuration != null ? parseDuration(String(it.restDuration)) : 0
          }
          durations.push(primarySeconds)
          restDurations.push(secondarySeconds)
          if (t === 'durationRepeated' || t === 'durationRestRepeated') {
            repeats.push(typeof it.repeats === 'number' && it.repeats > 0 ? it.repeats : 1)
          } else {
            repeats.push(0)
          }
          setNames.push(null)
        }
      } catch {
        // leave arrays empty
      }
      schedule.customIntervalTypes = types
      schedule.customIntervalDurations = durations
      schedule.customIntervalRestDurations = restDurations
      schedule.customIntervalRepeats = repeats
      schedule.customIntervalSetNames = setNames
      schedule.customIntervalNumberOfRounds = Math.max(1, num('customIntervalNumberOfRounds'))
      schedule.customIntervalRestBetweenRounds = dur('customIntervalRestBetweenRounds')
      const recurringRestEnabledOpt = options.customIntervalRestBetweenIntervalsEnabled
      const recurringRestEnabled =
        typeof recurringRestEnabledOpt === 'number'
          ? recurringRestEnabledOpt !== 0
          : recurringRestEnabledOpt === '1'
      schedule.customIntervalRestBetweenIntervals = recurringRestEnabled ? dur('customIntervalRestBetweenIntervals') : 0
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
  const dir =
    mode === 1 && (schedule.standardTimeCap === 0 || schedule.standardTimeCap === undefined)
      ? false
      : (Number(options.direction) !== 0 || options.direction === 'true')
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
  const restBetweenRepetitionsLabel = 'Rest between repeats'
  const durationInput = (
    key: string,
    label: string,
    placeholder = '0:00',
    labelClassName?: string
  ) => (
    <div key={key}>
      <label className={`block text-xs font-medium text-gray-700 ${labelClassName ?? ''}`.trim()}>
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
      const recurringRestEnabled = Number(getOpt('customIntervalRestBetweenIntervalsEnabled', 0)) === 1
      const recurringRestDisplay = String(
        getOpt('customIntervalRestBetweenIntervals', recurringRestEnabled ? '1:00' : '0:00') ?? (recurringRestEnabled ? '1:00' : '0:00')
      )
      if (mixedIntervalsStep === 2) {
        return (
          <div className={layoutClass}>
            {numberInput('customIntervalNumberOfRounds', 'Repeats', 1, 1)}
            {Number(getOpt('customIntervalNumberOfRounds', 1)) > 1 &&
              durationInput('customIntervalRestBetweenRounds', restBetweenRepetitionsLabel, '0:00', horizontalLayout ? 'whitespace-nowrap' : undefined)}
            {directionSelect()}
          </div>
        )
      }
      return (
        <div className="space-y-4">
          {mixedIntervalsStep === undefined && (
            <div className={layoutClass}>
              {numberInput('customIntervalNumberOfRounds', 'Repeats', 1, 1)}
              {Number(getOpt('customIntervalNumberOfRounds', 1)) > 1 &&
                durationInput('customIntervalRestBetweenRounds', restBetweenRepetitionsLabel, '0:00', horizontalLayout ? 'whitespace-nowrap' : undefined)}
              {directionSelect()}
            </div>
          )}
          <div>
            <div className="flex flex-wrap gap-1 mb-2 justify-end">
                <button type="button" onClick={() => addInterval('duration')} className="rounded px-2 py-1 text-xs font-medium text-white hover:opacity-90" style={{ backgroundColor: '#6B21A8' }}>+ Work Interval</button>
                <button type="button" onClick={() => addInterval('rest')} className="rounded px-2 py-1 text-xs font-medium text-white hover:opacity-90" style={{ backgroundColor: '#6B21A8' }}>+ Rest Interval</button>
                <button type="button" onClick={() => addInterval('durationRepeated')} className="rounded px-2 py-1 text-xs font-medium text-white hover:opacity-90" style={{ backgroundColor: '#6B21A8' }}>+ Work Block</button>
                <button type="button" onClick={() => addInterval('durationRestRepeated')} className="rounded px-2 py-1 text-xs font-medium text-white hover:opacity-90" style={{ backgroundColor: '#6B21A8' }}>+ Work/Rest Block</button>
              </div>
            <ul className="space-y-2 max-h-[40vh] overflow-y-auto">
              {intervals.map((it, index) => (
                <Fragment key={index}>
                  {index > 0 && recurringRestEnabled && (
                    <li className="rounded border border-dashed border-gray-200 bg-white p-2 flex justify-between items-center text-xs text-gray-700">
                      <span className="font-medium">Rest</span>
                      <span className="font-mono">{recurringRestDisplay}</span>
                    </li>
                  )}
                  <li className="rounded border border-gray-200 bg-gray-50/50 p-2 flex gap-2 items-center">
                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                      <span className="text-xs font-medium text-gray-800">{typeLabels[it.type] ?? it.type}</span>
                      <div className="flex flex-wrap gap-2 items-end">
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
                      </div>
                    </div>
                    <div className="flex gap-0.5 shrink-0">
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
                </Fragment>
              ))}
            </ul>
            {intervals.length === 0 && (
              <p className="text-xs text-gray-500">Add at least one interval above.</p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={recurringRestEnabled}
                  onChange={(e) => {
                    if (e.target.checked) {
                      const raw = String(getOpt('customIntervalRestBetweenIntervals', '') ?? '').trim()
                      const isZeroLike =
                        raw === '' || raw === '0' || raw === '0:00' || raw === '00:00'
                      const next = isZeroLike ? '1:00' : raw
                      setOpt('customIntervalRestBetweenIntervals', next)
                      setOpt('customIntervalRestBetweenIntervalsEnabled', 1)
                    } else {
                      setOpt('customIntervalRestBetweenIntervalsEnabled', 0)
                    }
                  }}
                  className="h-3 w-3 rounded border-gray-300 text-gymnext focus:ring-gymnext"
                />
                <span>Recurring Rest</span>
              </label>
              <input
                type="text"
                placeholder="0:00"
                value={String(getOpt('customIntervalRestBetweenIntervals', recurringRestEnabled ? '1:00' : '0:00') ?? '')}
                onChange={(e) => setOpt('customIntervalRestBetweenIntervals', e.target.value)}
                disabled={!recurringRestEnabled}
                className="w-20 rounded border border-gray-300 px-2 py-1 text-xs focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext disabled:bg-gray-100 disabled:text-gray-400"
              />
            </div>
          </div>
        </div>
      )
    }
    case 1: {
      const timeCapSec = parseDurationInput(String(getOpt('timeCap', '') ?? ''))
      const isInfinite = timeCapSec === 0
      return (
        <div className={layoutClass}>
          <div key="timeCap">
            <label className="block text-xs font-medium text-gray-700">
              Time cap (0 = infinite)
            </label>
            <input
              type="text"
              placeholder="3:00"
              value={String(getOpt('timeCap', '') ?? '')}
              onChange={(e) => {
                const val = e.target.value
                const sec = parseDurationInput(val)
                if (sec === 0) {
                  onChange({ ...options, timeCap: val, direction: 0 })
                } else {
                  setOpt('timeCap', val)
                }
              }}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
            />
          </div>
          {isInfinite ? (
            <div key="direction">
              <label className="block text-xs font-medium text-gray-700">
                Direction
              </label>
              <select
                value="down"
                disabled
                className="mt-1 block w-full rounded border border-gray-300 px-3 py-1.5 text-sm bg-gray-50 text-gray-600 cursor-not-allowed"
              >
                <option value="down">Count down</option>
              </select>
            </div>
          ) : (
            directionSelect()
          )}
        </div>
      )
    }
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

