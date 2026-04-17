'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { User } from 'firebase/auth'
import toast from 'react-hot-toast'
import { Bookmark, Users } from 'lucide-react'
import { PlanKindIcon, planVisualKindFromFlags } from '@/components/PlanKindIcon'
import { AddSharedWorkoutToPlanDialog } from '@/components/AddSharedWorkoutToPlanDialog'
import {
  DuplicateSharedCollectionDialog,
  type DuplicateSharedCollectionContext,
} from '@/components/DuplicateSharedCollectionDialog'
import {
  DuplicateSharedWorkoutDialog,
  type DuplicateSharedWorkoutContext,
} from '@/components/DuplicateSharedWorkoutDialog'
import {
  SharedResourcePreviewDialog,
  type LibraryBookmarkLookup,
  type SharedResourcePreviewTarget,
} from '@/components/SharedResourcePreviewDialog'
import type { SharedCollectionBookmarkRow, SharedWorkoutBookmarkRow } from '@/lib/bookmarks'
import type { Workout } from '@/types/user'

function libraryBookmarkKey(ownerUserId: string, resourceId: string): string {
  return `${ownerUserId.trim()}\u001e${resourceId.trim()}`
}

type SharedItem = {
  kind: 'workout' | 'collection' | 'plan'
  ownerUserId: string
  resourceId: string
  label: string
  subtitle?: string | null
  workoutBarColor?: string
  collectionWorkoutCount?: number
  planIsPersonal?: boolean
  planTrainingIntent?: number
}

type PeerSharedRow = {
  peerUserId: string
  displayName: string
  handle: string | null
  workouts: SharedItem[]
  collections: SharedItem[]
  plans: SharedItem[]
}

type HubSharedRow = {
  groupId: string
  displayName: string
  handle: string | null
  workouts: SharedItem[]
  collections: SharedItem[]
  plans: SharedItem[]
}

/** Subset of GET /api/app/following-plans rows needed for subscribe / unfollow UI. */
export type FollowedPlanForSharedContent = {
  subscriptionDocumentId: string
  ownerUserId: string
  remotePlanId: string
}

const DEFAULT_WORKOUT_BAR = 'rgb(92, 96, 104)'
const PLAN_STRIPE = '#0d9488'

function CollectionFolderIcon({ className = 'text-amber-700/80' }: { className?: string }) {
  return (
    <span className={`shrink-0 ${className}`} aria-hidden>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <path d="M19.5 21a3 3 0 003-3v-4.875a3 3 0 00-.684-1.9l-1.425-1.9a3 3 0 00-2.4-1.2H15.75l-.787-1.05A3 3 0 0012.422 6H4.5a3 3 0 00-3 3v9a3 3 0 003 3h15z" />
      </svg>
    </span>
  )
}

function SharedWorkoutRow({
  item,
  groupId,
  viewerUid,
  onOpen,
  onStartDuplicateSharedWorkout,
  onStartAddSharedWorkoutToPlan,
  bookmarkSharedWorkout,
  removeSharedWorkoutBookmark,
  isBookmarked,
}: {
  item: SharedItem
  groupId: string
  viewerUid: string
  onOpen: (t: SharedResourcePreviewTarget) => void
  onStartDuplicateSharedWorkout: (ctx: DuplicateSharedWorkoutContext) => void
  onStartAddSharedWorkoutToPlan: (ownerUserId: string, resourceId: string, groupId: string) => void
  bookmarkSharedWorkout?: (ownerUserId: string, resourceId: string, groupId: string) => Promise<void>
  removeSharedWorkoutBookmark?: (ownerUserId: string, resourceId: string) => Promise<void>
  isBookmarked?: boolean
}) {
  const bar = item.workoutBarColor ?? DEFAULT_WORKOUT_BAR
  const sub = item.subtitle?.trim() || '—'
  const isOwnWorkout = item.ownerUserId === viewerUid
  const bookmarked = Boolean(isBookmarked)

  const [menuOpen, setMenuOpen] = useState(false)
  const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const menuWrapRef = useRef<HTMLDivElement>(null)
  const menuPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuWrapRef.current?.contains(t)) return
      if (menuPanelRef.current?.contains(t)) return
      setMenuOpen(false)
      setMenuAnchorRect(null)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [menuOpen])

  const openPreview = () =>
    onOpen({
      ownerUserId: item.ownerUserId,
      kind: 'workout',
      resourceId: item.resourceId,
      groupId,
      titleFallback: item.label,
    })

  return (
    <li className="flex items-stretch bg-white">
      {!isOwnWorkout && bookmarked && (
        <div
          className="flex shrink-0 items-center border-r border-gray-100 pl-3 pr-2"
          aria-label="You have bookmarked this workout"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-200 text-purple-900 shadow-sm">
            <Bookmark className="h-4 w-4" strokeWidth={2} aria-hidden />
          </span>
        </div>
      )}
      <button
        type="button"
        className={`flex min-w-0 flex-1 items-center gap-3 py-3 pr-2 text-left hover:bg-gray-100 ${
          !isOwnWorkout && bookmarked ? 'pl-2' : 'pl-3'
        }`}
        onClick={openPreview}
      >
        <span className="w-1 shrink-0 self-stretch min-h-[3rem] rounded-full" style={{ backgroundColor: bar }} aria-hidden />
        <span className="w-6 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900">{item.label}</p>
          <p className="truncate text-xs text-gray-500">{sub}</p>
        </div>
      </button>
      {!isOwnWorkout && (
        <div className="relative flex shrink-0 items-center pr-2" ref={menuWrapRef}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              if (menuOpen) {
                setMenuOpen(false)
                setMenuAnchorRect(null)
              } else {
                setMenuAnchorRect(rect)
                setMenuOpen(true)
              }
            }}
            className="rounded-md px-2 py-1 text-lg font-bold leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            aria-label="Workout actions"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            …
          </button>
          {menuOpen &&
            menuAnchorRect &&
            typeof document !== 'undefined' &&
            createPortal(
              <>
                <div
                  className="fixed inset-0 z-[100]"
                  aria-hidden
                  onClick={() => {
                    setMenuOpen(false)
                    setMenuAnchorRect(null)
                  }}
                />
                <div
                  ref={menuPanelRef}
                  className="fixed z-[101] min-w-[14rem] rounded-md border border-gymnext-muted/40 bg-white py-1 shadow-lg"
                  role="menu"
                  style={{
                    top: menuAnchorRect.bottom + 4,
                    right: typeof window !== 'undefined' ? window.innerWidth - menuAnchorRect.right : 0,
                  }}
                >
                  {bookmarked && removeSharedWorkoutBookmark && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={bookmarkBusy}
                      className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => {
                        void (async () => {
                          setBookmarkBusy(true)
                          try {
                            await removeSharedWorkoutBookmark(item.ownerUserId, item.resourceId)
                            setMenuOpen(false)
                            setMenuAnchorRect(null)
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : 'Could not remove bookmark')
                          } finally {
                            setBookmarkBusy(false)
                          }
                        })()
                      }}
                    >
                      Remove bookmark
                    </button>
                  )}
                  {!bookmarked && bookmarkSharedWorkout && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={bookmarkBusy}
                      className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => {
                        void (async () => {
                          setBookmarkBusy(true)
                          try {
                            await bookmarkSharedWorkout(item.ownerUserId, item.resourceId, groupId)
                            setMenuOpen(false)
                            setMenuAnchorRect(null)
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : 'Could not bookmark workout')
                          } finally {
                            setBookmarkBusy(false)
                          }
                        })()
                      }}
                    >
                      Bookmark workout
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background"
                    onClick={() => {
                      onStartDuplicateSharedWorkout({
                        ownerUserId: item.ownerUserId,
                        sourceWorkoutId: item.resourceId,
                        groupId,
                      })
                      setMenuOpen(false)
                      setMenuAnchorRect(null)
                    }}
                  >
                    Duplicate workout to library
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background"
                    onClick={() => {
                      onStartAddSharedWorkoutToPlan(item.ownerUserId, item.resourceId, groupId)
                      setMenuOpen(false)
                      setMenuAnchorRect(null)
                    }}
                  >
                    Add workout to plan
                  </button>
                </div>
              </>,
              document.body
            )}
        </div>
      )}
    </li>
  )
}

function SharedCollectionRow({
  item,
  groupId,
  viewerUid,
  onOpen,
  onStartDuplicateSharedCollection,
  bookmarkSharedCollection,
  removeSharedCollectionBookmark,
  isBookmarked,
}: {
  item: SharedItem
  groupId: string
  viewerUid: string
  onOpen: (t: SharedResourcePreviewTarget) => void
  onStartDuplicateSharedCollection: (ctx: DuplicateSharedCollectionContext) => void
  bookmarkSharedCollection?: (ownerUserId: string, resourceId: string, groupId: string) => Promise<void>
  removeSharedCollectionBookmark?: (ownerUserId: string, resourceId: string) => Promise<void>
  isBookmarked?: boolean
}) {
  const n = item.collectionWorkoutCount ?? 0
  const trimmedSubtitle = item.subtitle?.trim()
  const sub = trimmedSubtitle || (n === 1 ? '1 workout' : `${n} workouts`)
  const isOwnCollection = item.ownerUserId === viewerUid
  const bookmarked = Boolean(isBookmarked)

  const [menuOpen, setMenuOpen] = useState(false)
  const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const menuWrapRef = useRef<HTMLDivElement>(null)
  const menuPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuWrapRef.current?.contains(t)) return
      if (menuPanelRef.current?.contains(t)) return
      setMenuOpen(false)
      setMenuAnchorRect(null)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [menuOpen])

  const openPreview = () =>
    onOpen({
      ownerUserId: item.ownerUserId,
      kind: 'collection',
      resourceId: item.resourceId,
      groupId,
      titleFallback: item.label,
    })

  return (
    <li className="flex items-stretch bg-white">
      {!isOwnCollection && bookmarked && (
        <div
          className="flex shrink-0 items-center border-r border-gray-100 pl-3 pr-2"
          aria-label="You have bookmarked this collection"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-200 text-purple-900 shadow-sm">
            <Bookmark className="h-4 w-4" strokeWidth={2} aria-hidden />
          </span>
        </div>
      )}
      <button
        type="button"
        className={`flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3 pr-2 text-left hover:bg-gray-100 ${
          !isOwnCollection && bookmarked ? 'pl-2' : 'pl-3'
        }`}
        onClick={openPreview}
      >
        <span
          className="w-1 shrink-0 self-stretch min-h-[3rem] rounded-full"
          style={{ backgroundColor: '#b45309' }}
          aria-hidden
        />
        <span className="w-6 shrink-0" aria-hidden />
        <CollectionFolderIcon />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900">{item.label}</p>
          <p className="truncate text-xs text-gray-500">{sub}</p>
        </div>
      </button>
      {!isOwnCollection && (
        <div className="relative flex shrink-0 items-center pr-2" ref={menuWrapRef}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              if (menuOpen) {
                setMenuOpen(false)
                setMenuAnchorRect(null)
              } else {
                setMenuAnchorRect(rect)
                setMenuOpen(true)
              }
            }}
            className="rounded-md px-2 py-1 text-lg font-bold leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            aria-label="Collection actions"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            …
          </button>
          {menuOpen &&
            menuAnchorRect &&
            typeof document !== 'undefined' &&
            createPortal(
              <>
                <div
                  className="fixed inset-0 z-[100]"
                  aria-hidden
                  onClick={() => {
                    setMenuOpen(false)
                    setMenuAnchorRect(null)
                  }}
                />
                <div
                  ref={menuPanelRef}
                  className="fixed z-[101] min-w-[12rem] rounded-md border border-gymnext-muted/40 bg-white py-1 shadow-lg"
                  role="menu"
                  style={{
                    top: menuAnchorRect.bottom + 4,
                    right: typeof window !== 'undefined' ? window.innerWidth - menuAnchorRect.right : 0,
                  }}
                >
                  {bookmarked && removeSharedCollectionBookmark && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={bookmarkBusy}
                      className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => {
                        void (async () => {
                          setBookmarkBusy(true)
                          try {
                            await removeSharedCollectionBookmark(item.ownerUserId, item.resourceId)
                            setMenuOpen(false)
                            setMenuAnchorRect(null)
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : 'Could not remove bookmark')
                          } finally {
                            setBookmarkBusy(false)
                          }
                        })()
                      }}
                    >
                      Remove bookmark
                    </button>
                  )}
                  {!bookmarked && bookmarkSharedCollection && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={bookmarkBusy}
                      className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => {
                        void (async () => {
                          setBookmarkBusy(true)
                          try {
                            await bookmarkSharedCollection(item.ownerUserId, item.resourceId, groupId)
                            setMenuOpen(false)
                            setMenuAnchorRect(null)
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : 'Could not bookmark collection')
                          } finally {
                            setBookmarkBusy(false)
                          }
                        })()
                      }}
                    >
                      Bookmark collection
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background"
                    onClick={() => {
                      onStartDuplicateSharedCollection({
                        ownerUserId: item.ownerUserId,
                        sourceCollectionId: item.resourceId,
                        groupId,
                      })
                      setMenuOpen(false)
                      setMenuAnchorRect(null)
                    }}
                  >
                    Duplicate collection to library
                  </button>
                </div>
              </>,
              document.body
            )}
        </div>
      )}
    </li>
  )
}

function SharedPlanRow({
  item,
  groupId,
  onOpen,
  viewerUid,
  followedPlans,
  followPlanFromShared,
  unfollowPlan,
  onFollowedPlansChange,
}: {
  item: SharedItem
  groupId: string
  onOpen: (t: SharedResourcePreviewTarget) => void
  viewerUid: string
  followedPlans: FollowedPlanForSharedContent[]
  followPlanFromShared: (params: {
    ownerUserId: string
    planId: string
    groupId: string
    planNameSnapshot?: string | null
    planDescriptionSnapshot?: string | null
  }) => Promise<{ status: string }>
  unfollowPlan: (subscriptionDocumentId: string) => Promise<void>
  onFollowedPlansChange?: () => void | Promise<void>
}) {
  const isPersonal = item.planIsPersonal === true
  const ti = item.planTrainingIntent === 1 ? 1 : 0
  const sub =
    item.subtitle?.trim() ||
    (isPersonal ? 'A personal plan.' : ti === 1 ? 'A group training plan.' : 'A private training plan.')

  const isOwnPlan = item.ownerUserId === viewerUid
  const followingRow = followedPlans.find(
    (f) => f.ownerUserId === item.ownerUserId && f.remotePlanId === item.resourceId
  )
  const isFollowing = Boolean(followingRow)

  const [menuOpen, setMenuOpen] = useState(false)
  const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const menuWrapRef = useRef<HTMLDivElement>(null)
  const menuPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuWrapRef.current?.contains(t)) return
      if (menuPanelRef.current?.contains(t)) return
      setMenuOpen(false)
      setMenuAnchorRect(null)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [menuOpen])

  const openPreview = () =>
    onOpen({
      ownerUserId: item.ownerUserId,
      kind: 'plan',
      resourceId: item.resourceId,
      groupId,
      titleFallback: item.label,
    })

  const onFollowClick = async () => {
    setActionBusy(true)
    try {
      const { status } = await followPlanFromShared({
        ownerUserId: item.ownerUserId,
        planId: item.resourceId,
        groupId,
        planNameSnapshot: item.label?.trim() || null,
      })
      toast.success(
        status === 'pending'
          ? 'Subscription request sent. The coach will need to approve it.'
          : 'You are now following this plan'
      )
      await Promise.resolve(onFollowedPlansChange?.())
      setMenuOpen(false)
      setMenuAnchorRect(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not subscribe to this plan')
    } finally {
      setActionBusy(false)
    }
  }

  const onUnfollowClick = async () => {
    if (!followingRow) return
    setActionBusy(true)
    try {
      await unfollowPlan(followingRow.subscriptionDocumentId)
      toast.success('You are no longer following this plan')
      await Promise.resolve(onFollowedPlansChange?.())
      setMenuOpen(false)
      setMenuAnchorRect(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not unfollow this plan')
    } finally {
      setActionBusy(false)
    }
  }

  return (
    <li className="flex items-stretch bg-white">
      {!isOwnPlan && isFollowing && (
        <div
          className="flex shrink-0 items-center border-r border-gray-100 pl-3 pr-2"
          aria-label="You are following this plan"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-100 text-teal-800">
            <Users className="h-4 w-4" strokeWidth={2} aria-hidden />
          </span>
        </div>
      )}
      <button
        type="button"
        className={`flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3 pr-2 text-left hover:bg-gray-100 ${
          !isOwnPlan && isFollowing ? 'pl-2' : 'pl-3'
        }`}
        onClick={openPreview}
      >
        <span
          className="w-1 shrink-0 self-stretch min-h-[3rem] rounded-full"
          style={{ backgroundColor: PLAN_STRIPE }}
          aria-hidden
        />
        <span className="w-6 shrink-0" aria-hidden />
        <PlanKindIcon kind={planVisualKindFromFlags(isPersonal, ti)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900">{item.label}</p>
          <p className="truncate text-xs text-gray-500">{sub}</p>
        </div>
      </button>
      {!isOwnPlan && (
        <div className="relative flex shrink-0 items-center pr-2" ref={menuWrapRef}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              if (menuOpen) {
                setMenuOpen(false)
                setMenuAnchorRect(null)
              } else {
                setMenuAnchorRect(rect)
                setMenuOpen(true)
              }
            }}
            className="rounded-md px-2 py-1 text-lg font-bold leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            aria-label="Plan actions"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            …
          </button>
          {menuOpen &&
            menuAnchorRect &&
            typeof document !== 'undefined' &&
            createPortal(
              <>
                <div
                  className="fixed inset-0 z-[100]"
                  aria-hidden
                  onClick={() => {
                    setMenuOpen(false)
                    setMenuAnchorRect(null)
                  }}
                />
                <div
                  ref={menuPanelRef}
                  className="fixed z-[101] min-w-[12rem] rounded-md border border-gymnext-muted/40 bg-white py-1 shadow-lg"
                  role="menu"
                  style={{
                    top: menuAnchorRect.bottom + 4,
                    right: typeof window !== 'undefined' ? window.innerWidth - menuAnchorRect.right : 0,
                  }}
                >
                  {isFollowing ? (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={actionBusy}
                      className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:opacity-50"
                      onClick={() => void onUnfollowClick()}
                    >
                      Unfollow
                    </button>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={actionBusy}
                      className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:opacity-50"
                      onClick={() => void onFollowClick()}
                    >
                      Follow
                    </button>
                  )}
                </div>
              </>,
              document.body
            )}
        </div>
      )}
    </li>
  )
}

function SharedSourceBlock({
  displayName,
  subtitle,
  groupId,
  plans,
  collections,
  workouts,
  onOpenItem,
  viewerUid,
  followedPlans,
  followPlanFromShared,
  unfollowPlan,
  onFollowedPlansChange,
  onStartDuplicateSharedCollection,
  onStartDuplicateSharedWorkout,
  onStartAddSharedWorkoutToPlan,
}: {
  displayName: string
  subtitle: string
  groupId: string
  plans: SharedItem[]
  collections: SharedItem[]
  workouts: SharedItem[]
  onOpenItem: (t: SharedResourcePreviewTarget) => void
  viewerUid: string
  followedPlans: FollowedPlanForSharedContent[]
  followPlanFromShared: (params: {
    ownerUserId: string
    planId: string
    groupId: string
    planNameSnapshot?: string | null
    planDescriptionSnapshot?: string | null
  }) => Promise<{ status: string }>
  unfollowPlan: (subscriptionDocumentId: string) => Promise<void>
  onFollowedPlansChange?: () => void | Promise<void>
  onStartDuplicateSharedCollection: (ctx: DuplicateSharedCollectionContext) => void
  onStartDuplicateSharedWorkout: (ctx: DuplicateSharedWorkoutContext) => void
  onStartAddSharedWorkoutToPlan: (ownerUserId: string, resourceId: string, groupId: string) => void
}) {
  const sections = [
    { title: 'Plans', items: plans, kind: 'plan' as const },
    { title: 'Collections', items: collections, kind: 'collection' as const },
    { title: 'Workouts', items: workouts, kind: 'workout' as const },
  ].filter((s) => s.items.length > 0)

  return (
    <section className="overflow-hidden rounded-lg border border-gymnext-muted/30 bg-gymnext-background/40">
      <div className="border-b border-gymnext-muted/30 bg-white px-4 py-3">
        <h3 className="truncate text-sm font-semibold text-gray-900">{displayName}</h3>
        <p className="mt-0.5 truncate text-xs text-gray-500">{subtitle}</p>
      </div>
      <div className="space-y-4 px-4 py-3">
        {sections.map(({ title, items, kind }) => (
          <div key={title}>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
            <div className="overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white">
              <ul className="divide-y divide-gray-200">
                {items.map((item) => {
                  const key = `${item.kind}-${item.ownerUserId}-${item.resourceId}`
                  if (kind === 'workout') {
                    return (
                      <SharedWorkoutRow
                        key={key}
                        item={item}
                        groupId={groupId}
                        viewerUid={viewerUid}
                        onOpen={onOpenItem}
                        onStartDuplicateSharedWorkout={onStartDuplicateSharedWorkout}
                        onStartAddSharedWorkoutToPlan={onStartAddSharedWorkoutToPlan}
                      />
                    )
                  }
                  if (kind === 'collection') {
                    return (
                      <SharedCollectionRow
                        key={key}
                        item={item}
                        groupId={groupId}
                        viewerUid={viewerUid}
                        onOpen={onOpenItem}
                        onStartDuplicateSharedCollection={onStartDuplicateSharedCollection}
                      />
                    )
                  }
                  return (
                    <SharedPlanRow
                      key={key}
                      item={item}
                      groupId={groupId}
                      onOpen={onOpenItem}
                      viewerUid={viewerUid}
                      followedPlans={followedPlans}
                      followPlanFromShared={followPlanFromShared}
                      unfollowPlan={unfollowPlan}
                      onFollowedPlansChange={onFollowedPlansChange}
                    />
                  )
                })}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function ConnectSharedContentSection({
  user,
  followedPlans = [],
  onFollowedPlansChange,
  reloadOverview,
  onGoToOwnedPlan,
  onGoToSubscribedPlanAhead,
}: {
  user: User
  /** Active followed plans (same shape as Connect feed). */
  followedPlans?: FollowedPlanForSharedContent[]
  /** Refetch followed plans after follow / unfollow. */
  onFollowedPlansChange?: () => void | Promise<void>
  /** Refresh library overview after duplicating a shared collection. */
  reloadOverview?: () => void
  /** Planning → Plans with this owned plan selected when previewing your own plan. */
  onGoToOwnedPlan?: (planId: string) => void
  /** Planning → Plan Ahead when previewing a plan you already subscribe to. */
  onGoToSubscribedPlanAhead?: (ownerUserId: string, remotePlanId: string) => void
}) {
  const [peers, setPeers] = useState<PeerSharedRow[]>([])
  const [hubs, setHubs] = useState<HubSharedRow[]>([])
  const [totalConnections, setTotalConnections] = useState(0)
  const [totalMemberships, setTotalMemberships] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<SharedResourcePreviewTarget | null>(null)
  const [duplicateCollectionCtx, setDuplicateCollectionCtx] =
    useState<DuplicateSharedCollectionContext | null>(null)
  const [duplicateWorkoutCtx, setDuplicateWorkoutCtx] = useState<DuplicateSharedWorkoutContext | null>(null)
  const [addPlanOpen, setAddPlanOpen] = useState(false)
  const [addPlanWorkout, setAddPlanWorkout] = useState<Workout | null>(null)
  const [workoutBookmarkRows, setWorkoutBookmarkRows] = useState<SharedWorkoutBookmarkRow[]>([])
  const [collectionBookmarkRows, setCollectionBookmarkRows] = useState<SharedCollectionBookmarkRow[]>([])

  const loadLibraryBookmarks = useCallback(async () => {
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/bookmarks', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        workouts?: SharedWorkoutBookmarkRow[]
        collections?: SharedCollectionBookmarkRow[]
      }
      if (!res.ok) {
        setWorkoutBookmarkRows([])
        setCollectionBookmarkRows([])
        return
      }
      setWorkoutBookmarkRows(Array.isArray(json.workouts) ? json.workouts : [])
      setCollectionBookmarkRows(Array.isArray(json.collections) ? json.collections : [])
    } catch {
      setWorkoutBookmarkRows([])
      setCollectionBookmarkRows([])
    }
  }, [user])

  const bookmarkedWorkoutKeys = useMemo(() => {
    const s = new Set<string>()
    for (const w of workoutBookmarkRows) {
      s.add(libraryBookmarkKey(w.ownerUserId, w.remoteWorkoutId))
    }
    return s
  }, [workoutBookmarkRows])

  const bookmarkedCollectionKeys = useMemo(() => {
    const s = new Set<string>()
    for (const c of collectionBookmarkRows) {
      s.add(libraryBookmarkKey(c.ownerUserId, c.remoteCollectionId))
    }
    return s
  }, [collectionBookmarkRows])

  const isLibraryBookmarkActive = useCallback<LibraryBookmarkLookup>(
    ({ kind, ownerUserId, resourceId }) => {
      const k = libraryBookmarkKey(ownerUserId, resourceId)
      if (kind === 'workout') return bookmarkedWorkoutKeys.has(k)
      return bookmarkedCollectionKeys.has(k)
    },
    [bookmarkedWorkoutKeys, bookmarkedCollectionKeys],
  )

  const onStartDuplicateSharedCollection = useCallback((ctx: DuplicateSharedCollectionContext) => {
    setDuplicateCollectionCtx(ctx)
  }, [])

  const onStartDuplicateSharedWorkout = useCallback((ctx: DuplicateSharedWorkoutContext) => {
    setDuplicateWorkoutCtx(ctx)
  }, [])

  const fetchSharedWorkout = useCallback(
    async (ownerUserId: string, resourceId: string, gid: string) => {
      const token = await user.getIdToken()
      const qs = new URLSearchParams()
      if (gid.trim()) qs.set('groupId', gid.trim())
      const q = qs.toString()
      const url = `/api/app/shared-content/${encodeURIComponent(ownerUserId)}/workout/${encodeURIComponent(resourceId)}${q ? `?${q}` : ''}`
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        kind?: string
        data?: Workout
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      if (data.kind !== 'workout' || !data.data) throw new Error('Unexpected response')
      return data.data
    },
    [user]
  )

  const onStartAddSharedWorkoutToPlan = useCallback(
    (ownerUserId: string, resourceId: string, gid: string) => {
      void (async () => {
        try {
          const w = await fetchSharedWorkout(ownerUserId, resourceId, gid)
          setAddPlanWorkout(w)
          setAddPlanOpen(true)
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Could not load workout')
        }
      })()
    },
    [fetchSharedWorkout]
  )

  const onPreviewWorkoutDuplicate = useCallback((t: SharedResourcePreviewTarget) => {
    setPreview(null)
    setDuplicateWorkoutCtx({
      ownerUserId: t.ownerUserId,
      sourceWorkoutId: t.resourceId,
      groupId: t.groupId,
    })
  }, [])

  const onPreviewWorkoutAddToPlan = useCallback((w: Workout) => {
    setPreview(null)
    setAddPlanWorkout(w)
    setAddPlanOpen(true)
  }, [])

  const onPreviewCollectionDuplicate = useCallback((t: SharedResourcePreviewTarget) => {
    setPreview(null)
    setDuplicateCollectionCtx({
      ownerUserId: t.ownerUserId,
      sourceCollectionId: t.resourceId,
      groupId: t.groupId,
    })
  }, [])

  const bookmarkSharedWorkout = useCallback(
    async (ownerUserId: string, resourceId: string, groupId: string) => {
      const token = await user.getIdToken()
      const body: { ownerUserId: string; remoteWorkoutId: string; groupId?: string } = {
        ownerUserId,
        remoteWorkoutId: resourceId,
      }
      if (groupId.trim()) body.groupId = groupId.trim()
      const res = await fetch('/api/app/bookmarks/workouts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Could not bookmark workout')
      toast.success('Saved to bookmarks')
      await loadLibraryBookmarks()
    },
    [user, loadLibraryBookmarks],
  )

  const bookmarkSharedCollection = useCallback(
    async (ownerUserId: string, resourceId: string, groupId: string) => {
      const token = await user.getIdToken()
      const body: { ownerUserId: string; remoteCollectionId: string; groupId?: string } = {
        ownerUserId,
        remoteCollectionId: resourceId,
      }
      if (groupId.trim()) body.groupId = groupId.trim()
      const res = await fetch('/api/app/bookmarks/collections', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Could not bookmark collection')
      toast.success('Saved to bookmarks')
      await loadLibraryBookmarks()
    },
    [user, loadLibraryBookmarks],
  )

  const removeSharedWorkoutBookmark = useCallback(
    async (ownerUserId: string, resourceId: string) => {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/bookmarks/workouts', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ownerUserId,
          remoteWorkoutId: resourceId,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Could not remove bookmark')
      toast.success('Bookmark removed')
      await loadLibraryBookmarks()
    },
    [user, loadLibraryBookmarks],
  )

  const removeSharedCollectionBookmark = useCallback(
    async (ownerUserId: string, resourceId: string) => {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/bookmarks/collections', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ownerUserId,
          remoteCollectionId: resourceId,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Could not remove bookmark')
      toast.success('Bookmark removed')
      await loadLibraryBookmarks()
    },
    [user, loadLibraryBookmarks],
  )

  const isAlreadyFollowingPlan = useCallback(
    (ownerUserId: string, planId: string) =>
      followedPlans.some((f) => f.ownerUserId === ownerUserId && f.remotePlanId === planId),
    [followedPlans]
  )

  const followPlanFromShared = useCallback(
    async (params: {
      ownerUserId: string
      planId: string
      groupId: string
      planNameSnapshot?: string | null
      planDescriptionSnapshot?: string | null
    }) => {
      const { ownerUserId, planId, groupId, planNameSnapshot, planDescriptionSnapshot } = params
      const token = await user.getIdToken()
      const body: {
        ownerUserId: string
        remotePlanId: string
        groupId?: string
        planNameSnapshot?: string
        planDescriptionSnapshot?: string
      } = {
        ownerUserId,
        remotePlanId: planId,
      }
      if (groupId.trim()) body.groupId = groupId.trim()
      if (planNameSnapshot?.trim()) body.planNameSnapshot = planNameSnapshot.trim()
      if (planDescriptionSnapshot?.trim()) body.planDescriptionSnapshot = planDescriptionSnapshot.trim()
      const res = await fetch('/api/app/following-plans', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; status?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return { status: data.status ?? 'active' }
    },
    [user]
  )

  const subscriptionDocumentIdForPlan = useCallback(
    (ownerUserId: string, planId: string) =>
      followedPlans.find((f) => f.ownerUserId === ownerUserId && f.remotePlanId === planId)
        ?.subscriptionDocumentId ?? null,
    [followedPlans]
  )

  const unfollowPlan = useCallback(
    async (subscriptionDocumentId: string) => {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/app/following-plans/${encodeURIComponent(subscriptionDocumentId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    },
    [user]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/connections/shared', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        peers?: PeerSharedRow[]
        hubs?: HubSharedRow[]
        totalConnections?: number
        totalMemberships?: number
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setPeers(Array.isArray(data.peers) ? data.peers : [])
      setHubs(Array.isArray(data.hubs) ? data.hubs : [])
      setTotalConnections(
        typeof data.totalConnections === 'number' ? data.totalConnections : 0
      )
      setTotalMemberships(
        typeof data.totalMemberships === 'number' ? data.totalMemberships : 0
      )
      void loadLibraryBookmarks()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load shared content')
      setPeers([])
      setHubs([])
      setTotalConnections(0)
      setTotalMemberships(0)
    } finally {
      setLoading(false)
    }
  }, [user, loadLibraryBookmarks])

  useEffect(() => {
    void load()
  }, [load])

  const noNetwork = totalConnections === 0 && totalMemberships === 0
  const hasAnyShared = peers.length > 0 || hubs.length > 0

  const viewerUid = user.uid
  type SharedSource = {
    key: string
    kind: 'hub' | 'peer'
    displayName: string
    subtitle: string
    groupId: string
    plans: SharedItem[]
    collections: SharedItem[]
    workouts: SharedItem[]
  }
  const sources = useMemo<SharedSource[]>(() => {
    const hubRows = hubs.map((row) => ({
      key: `hub:${row.groupId}`,
      kind: 'hub' as const,
      displayName: row.displayName,
      subtitle: row.handle?.trim() ? `@${row.handle.replace(/^@/, '')}` : 'Hub',
      groupId: row.groupId,
      plans: row.plans,
      collections: row.collections,
      workouts: row.workouts,
    }))
    const peerRows = peers.map((row) => ({
      key: `peer:${row.peerUserId}`,
      kind: 'peer' as const,
      displayName: row.displayName,
      subtitle: row.handle?.trim() ? row.handle : 'Member',
      groupId: '',
      plans: row.plans,
      collections: row.collections,
      workouts: row.workouts,
    }))
    return [...hubRows, ...peerRows].sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [hubs, peers])

  const [selectedSourceKey, setSelectedSourceKey] = useState<string | null>(null)
  useEffect(() => {
    if (loading || error || !hasAnyShared) {
      setSelectedSourceKey(null)
      return
    }
    if (selectedSourceKey && sources.some((s) => s.key === selectedSourceKey)) return
    setSelectedSourceKey(sources[0]?.key ?? null)
  }, [error, hasAnyShared, loading, selectedSourceKey, sources])

  const selectedSource = useMemo(
    () => sources.find((s) => s.key === selectedSourceKey) ?? null,
    [sources, selectedSourceKey],
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white shadow-sm">
      <DuplicateSharedCollectionDialog
        open={duplicateCollectionCtx != null}
        context={duplicateCollectionCtx}
        viewer={user}
        onClose={() => setDuplicateCollectionCtx(null)}
        onSuccess={({ skippedWorkoutCount }) => {
          if (skippedWorkoutCount > 0) {
            toast.success(
              skippedWorkoutCount === 1
                ? 'Collection copied. One workout was missing and was skipped.'
                : `Collection copied. ${skippedWorkoutCount} workouts were missing and were skipped.`
            )
          } else {
            toast.success('Collection and workouts copied to your library')
          }
          reloadOverview?.()
        }}
      />
      <DuplicateSharedWorkoutDialog
        open={duplicateWorkoutCtx != null}
        context={duplicateWorkoutCtx}
        viewer={user}
        onClose={() => setDuplicateWorkoutCtx(null)}
        onSuccess={() => {
          toast.success('Workout copied to your library')
          reloadOverview?.()
        }}
      />
      <AddSharedWorkoutToPlanDialog
        open={addPlanOpen}
        workout={addPlanWorkout}
        viewer={user}
        onClose={() => {
          setAddPlanOpen(false)
          setAddPlanWorkout(null)
        }}
        onSuccess={() => toast.success('Added to plan')}
      />
      <SharedResourcePreviewDialog
        open={preview != null}
        target={preview}
        onClose={() => setPreview(null)}
        viewer={user}
        onWorkoutMenuDuplicate={onPreviewWorkoutDuplicate}
        onWorkoutMenuAddToPlan={onPreviewWorkoutAddToPlan}
        onCollectionMenuDuplicate={onPreviewCollectionDuplicate}
        followPlanFromFeed={followPlanFromShared}
        isAlreadyFollowingPlan={isAlreadyFollowingPlan}
        onFollowPlanSuccess={() => void onFollowedPlansChange?.()}
        unfollowPlanFromFeed={unfollowPlan}
        subscriptionDocumentIdForPlan={subscriptionDocumentIdForPlan}
        onGoToOwnedPlan={onGoToOwnedPlan}
        onGoToSubscribedPlanAhead={onGoToSubscribedPlanAhead}
        isLibraryBookmarkActive={isLibraryBookmarkActive}
        onLibraryBookmarksSaved={loadLibraryBookmarks}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {loading && (
          <div className="h-full overflow-y-auto overscroll-contain">
            <p className="px-4 py-8 text-center text-sm text-gray-500">Loading shared content…</p>
          </div>
        )}
        {!loading && error && (
          <div className="h-full overflow-y-auto overscroll-contain">
            <div className="space-y-2 px-4 py-4">
              <p className="text-sm text-red-700">{error}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="rounded px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                style={{ backgroundColor: '#6B21A8' }}
              >
                Retry
              </button>
            </div>
          </div>
        )}
        {!loading && !error && (noNetwork || !hasAnyShared) && (
          <div className="flex h-full items-center justify-center overflow-y-auto overscroll-contain">
            <p className="px-4 py-8 text-center text-sm text-gray-500">
              {noNetwork
                ? 'No shared content detected. Connect with other users or join a Hub.'
                : 'Nothing shared with you yet. When a connection shares a workout, collection, or plan—or someone shares one in a hub you belong to—it will show up here.'}
            </p>
          </div>
        )}
        {!loading && !error && hasAnyShared && (
          <div className="flex h-full min-h-0 min-w-0">
            <div className="w-[19rem] shrink-0 border-r border-gymnext-muted/30 bg-white overflow-y-auto overscroll-contain">
              <div className="px-4 py-3 border-b border-gymnext-muted/20 bg-gymnext-background">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Shared with you</p>
              </div>
              <ul className="divide-y divide-gymnext-muted/20">
                {sources.map((s) => {
                  const isActive = s.key === selectedSourceKey
                  const count = s.plans.length + s.collections.length + s.workouts.length
                  return (
                    <li key={s.key}>
                      <button
                        type="button"
                        onClick={() => setSelectedSourceKey(s.key)}
                        className={`w-full px-4 py-3 text-left hover:bg-gymnext-background/60 ${
                          isActive ? 'bg-gymnext-background/70' : 'bg-white'
                        }`}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-gray-900">{s.displayName}</p>
                            <p className="truncate text-xs text-gray-500 mt-0.5">
                              {s.kind === 'hub' ? `Hub • ${s.subtitle}` : `User • ${s.subtitle}`}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                            {count}
                          </span>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
            <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
              {selectedSource ? (
                <div className="px-4 py-4 space-y-4">
                  <div className="rounded-lg border border-gymnext-muted/25 bg-gymnext-background/40 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {selectedSource.kind === 'hub' ? 'Hub' : 'User'}
                    </p>
                    <p className="mt-1 text-base font-semibold text-gray-900">{selectedSource.displayName}</p>
                    <p className="mt-0.5 text-sm text-gray-600">{selectedSource.subtitle}</p>
                  </div>

                  {selectedSource.plans.length === 0 &&
                    selectedSource.collections.length === 0 &&
                    selectedSource.workouts.length === 0 && (
                      <p className="text-sm text-gray-500">No shared items in this thread.</p>
                    )}

                  {selectedSource.plans.length > 0 && (
                    <section className="overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white">
                      <div className="border-b border-gymnext-muted/20 bg-gymnext-background px-4 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Plans ({selectedSource.plans.length})
                        </p>
                      </div>
                      <ul className="divide-y divide-gymnext-muted/20">
                        {selectedSource.plans.map((p) => (
                          <SharedPlanRow
                            key={`${p.ownerUserId}:${p.resourceId}`}
                            item={p}
                            groupId={selectedSource.groupId}
                            onOpen={setPreview}
                            viewerUid={viewerUid}
                            followedPlans={followedPlans}
                            followPlanFromShared={followPlanFromShared}
                            unfollowPlan={unfollowPlan}
                            onFollowedPlansChange={onFollowedPlansChange}
                          />
                        ))}
                      </ul>
                    </section>
                  )}

                  {selectedSource.collections.length > 0 && (
                    <section className="overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white">
                      <div className="border-b border-gymnext-muted/20 bg-gymnext-background px-4 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Collections ({selectedSource.collections.length})
                        </p>
                      </div>
                      <ul className="divide-y divide-gymnext-muted/20">
                        {selectedSource.collections.map((c) => (
                          <SharedCollectionRow
                            key={`${c.ownerUserId}:${c.resourceId}`}
                            item={c}
                            groupId={selectedSource.groupId}
                            viewerUid={viewerUid}
                            onOpen={setPreview}
                            onStartDuplicateSharedCollection={onStartDuplicateSharedCollection}
                            bookmarkSharedCollection={bookmarkSharedCollection}
                            removeSharedCollectionBookmark={removeSharedCollectionBookmark}
                            isBookmarked={bookmarkedCollectionKeys.has(
                              libraryBookmarkKey(c.ownerUserId, c.resourceId),
                            )}
                          />
                        ))}
                      </ul>
                    </section>
                  )}

                  {selectedSource.workouts.length > 0 && (
                    <section className="overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white">
                      <div className="border-b border-gymnext-muted/20 bg-gymnext-background px-4 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Workouts ({selectedSource.workouts.length})
                        </p>
                      </div>
                      <ul className="divide-y divide-gymnext-muted/20">
                        {selectedSource.workouts.map((w) => (
                          <SharedWorkoutRow
                            key={`${w.ownerUserId}:${w.resourceId}`}
                            item={w}
                            groupId={selectedSource.groupId}
                            viewerUid={viewerUid}
                            onOpen={setPreview}
                            onStartDuplicateSharedWorkout={onStartDuplicateSharedWorkout}
                            onStartAddSharedWorkoutToPlan={onStartAddSharedWorkoutToPlan}
                            bookmarkSharedWorkout={bookmarkSharedWorkout}
                            removeSharedWorkoutBookmark={removeSharedWorkoutBookmark}
                            isBookmarked={bookmarkedWorkoutKeys.has(
                              libraryBookmarkKey(w.ownerUserId, w.resourceId),
                            )}
                          />
                        ))}
                      </ul>
                    </section>
                  )}
                </div>
              ) : (
                <p className="px-4 py-8 text-center text-sm text-gray-500">Select a hub or user to view shared items.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
