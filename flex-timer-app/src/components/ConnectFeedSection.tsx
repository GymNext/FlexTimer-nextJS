'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import toast from 'react-hot-toast'
import { Bookmark, ListFilter, Users } from 'lucide-react'
import { PublicUserProfileDialog } from '@/components/PublicUserProfileDialog'
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
import type { AppFeedItemResponse, AppFeedPageResponse, AppFeedSharedResource } from '@/types/feed'
import type { HubTreeNode } from '@/types/hub-tree'
import type { Workout } from '@/types/user'

const MAX_TOTAL_ITEMS = 500

/** Plan / collection / workout share rows (library shared content). */
function feedItemIsSharedContent(item: AppFeedItemResponse): boolean {
  return (
    item.type === 'sharePlan' || item.type === 'shareCollection' || item.type === 'shareWorkout'
  )
}

/** User connections, hub join/leave, and new hub creation — not library shares. */
function feedItemIsConnectionActivity(item: AppFeedItemResponse): boolean {
  return (
    item.type === 'joinGroup' ||
    item.type === 'leaveGroup' ||
    item.type === 'userConnect' ||
    item.type === 'createGroup'
  )
}

/** Personal stream: `users/{uid}/feed` (no hub id on the row). */
function feedItemFromPersonalUserFeed(item: AppFeedItemResponse): boolean {
  return !item.groupId?.trim()
}

/** Hub stream: `groups/{groupId}/feed`. */
function feedItemFromGroupFeed(item: AppFeedItemResponse): boolean {
  return Boolean(item.groupId?.trim())
}

function collectOwnedHubIdsFromTree(nodes: HubTreeNode[]): Set<string> {
  const out = new Set<string>()
  const walk = (ns: HubTreeNode[]) => {
    for (const n of ns) {
      const id = n.id?.trim()
      if (id) out.add(id)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (sec < 45) return 'moments ago'
  const min = Math.floor(sec / 60)
  if (min < 60) return min <= 1 ? '1 minute ago' : `${min} minutes ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return hr === 1 ? '1 hour ago' : `${hr} hours ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return day === 1 ? '1 day ago' : `${day} days ago`
  const week = Math.floor(day / 7)
  if (week < 5) return week === 1 ? '1 week ago' : `${week} weeks ago`
  const month = Math.floor(day / 30)
  if (month < 12) return month <= 1 ? '1 month ago' : `${month} months ago`
  const year = Math.floor(day / 365)
  return year <= 1 ? '1 year ago' : `${year} years ago`
}

function sharedKindLabel(kind: AppFeedSharedResource['kind']): string {
  if (kind === 'plan') return 'Plan'
  if (kind === 'collection') return 'Collection'
  return 'Workout'
}

function feedShareResourceNoun(kind: 'plan' | 'collection' | 'workout'): string {
  if (kind === 'collection') return 'collection'
  if (kind === 'workout') return 'workout'
  return 'plan'
}

function libraryBookmarkKey(ownerUserId: string, resourceId: string): string {
  return `${ownerUserId.trim()}\u001e${resourceId.trim()}`
}

type PlanShareMenuCase =
  | 'group_peer_plan'
  | 'personal_inbound'
  | 'personal_outbound_own'
  | 'group_own_share'

function planShareMenuCase(item: AppFeedItemResponse, viewerUid: string): PlanShareMenuCase | null {
  const shared = item.sharedResource
  if (item.type !== 'sharePlan' || !shared || shared.kind !== 'plan') return null
  const isOwnerPlan = shared.ownerUserId === viewerUid
  const isGroup = Boolean(item.groupId?.trim())
  const isActor = item.actorUserId === viewerUid
  const variant = item.sharePlanPersonalPresentation?.variant

  if (isGroup && !isOwnerPlan) return 'group_peer_plan'
  if (!isGroup && !isOwnerPlan) return 'personal_inbound'
  if (!isGroup && isOwnerPlan && variant === 'you_shared_with') return 'personal_outbound_own'
  if (isGroup && isOwnerPlan && isActor) return 'group_own_share'
  return null
}

/** Workout/collection share row: viewer owns the library item (outbound or hub self-share) vs recipient actions. */
type LibraryItemShareMenuMode = 'owner_personal' | 'owner_group' | 'recipient'

function libraryItemShareMenuMode(
  item: AppFeedItemResponse,
  viewerUid: string,
  kind: 'workout' | 'collection',
): LibraryItemShareMenuMode {
  const shared = item.sharedResource
  if (!shared || shared.kind !== kind) return 'recipient'
  if (shared.ownerUserId !== viewerUid) return 'recipient'
  const personal = !item.groupId?.trim()
  if (personal) {
    return item.sharePlanPersonalPresentation?.variant === 'you_shared_with'
      ? 'owner_personal'
      : 'recipient'
  }
  return item.actorUserId === viewerUid ? 'owner_group' : 'recipient'
}

/** Direct (personal) feed: another user shared their workout/collection with the viewer (`… shared a … with you`). */
function isPersonalInboundDirectLibraryShare(item: AppFeedItemResponse, kind: 'workout' | 'collection'): boolean {
  if (item.groupId?.trim()) return false
  if (item.sharePlanPersonalPresentation?.variant !== 'peer_shared') return false
  const shared = item.sharedResource
  return Boolean(shared && shared.kind === kind)
}

function FeedRow({
  item,
  viewerUid,
  onOpenActorProfile,
  onOpenShared,
  followPlanFromFeed,
  isAlreadyFollowingPlan,
  onFollowedPlanFromFeed,
  onStartDuplicateSharedWorkout,
  onStartAddSharedWorkoutToPlan,
  onStartDuplicateSharedCollection,
  onGoToOwnedPlan,
  onGoToSubscribedPlanAhead,
  removePersonalFeedItem,
  removeGroupFeedItem,
  onRemoveFeedItemSuccess,
  ownedHubIds,
  onGoToOwnedWorkout,
  onGoToOwnedCollection,
  isLibraryBookmarkActive,
  bookmarkSharedWorkoutFromFeed,
  removeSharedWorkoutBookmarkFromFeed,
  bookmarkSharedCollectionFromFeed,
  removeSharedCollectionBookmarkFromFeed,
}: {
  item: AppFeedItemResponse
  viewerUid: string
  onOpenActorProfile: (userId: string) => void
  onOpenShared: (target: SharedResourcePreviewTarget) => void
  followPlanFromFeed: (params: {
    ownerUserId: string
    planId: string
    groupId: string
    planNameSnapshot?: string | null
    planDescriptionSnapshot?: string | null
  }) => Promise<{ status: string }>
  isAlreadyFollowingPlan: (ownerUserId: string, planId: string) => boolean
  onFollowedPlanFromFeed?: () => void | Promise<void>
  onStartDuplicateSharedWorkout: (ctx: DuplicateSharedWorkoutContext) => void
  onStartAddSharedWorkoutToPlan: (ownerUserId: string, resourceId: string, groupId: string) => void
  onStartDuplicateSharedCollection: (ctx: DuplicateSharedCollectionContext) => void
  onGoToOwnedPlan?: (planId: string) => void
  /** When the viewer already follows this shared plan, card click goes to Plan Ahead instead of preview. */
  onGoToSubscribedPlanAhead?: (ownerUserId: string, remotePlanId: string) => void
  removePersonalFeedItem: (feedItemId: string) => Promise<void>
  removeGroupFeedItem: (groupId: string, feedItemId: string) => Promise<void>
  onRemoveFeedItemSuccess: () => void
  /** Hub ids the viewer owns (roots + subgroups); `null` while loading owned hubs list. */
  ownedHubIds: Set<string> | null
  onGoToOwnedWorkout?: (workoutId: string) => void
  onGoToOwnedCollection?: (collectionId: string) => void
  isLibraryBookmarkActive?: LibraryBookmarkLookup
  bookmarkSharedWorkoutFromFeed?: (
    ownerUserId: string,
    resourceId: string,
    groupId: string,
  ) => Promise<void>
  removeSharedWorkoutBookmarkFromFeed?: (ownerUserId: string, resourceId: string) => Promise<void>
  bookmarkSharedCollectionFromFeed?: (
    ownerUserId: string,
    resourceId: string,
    groupId: string,
  ) => Promise<void>
  removeSharedCollectionBookmarkFromFeed?: (ownerUserId: string, resourceId: string) => Promise<void>
}) {
  const when = formatRelativeTime(item.createdAt)
  const actorLabel = item.actorDisplayName?.trim() || 'Someone'
  const title = item.title
  const groupShareHeadline = item.groupShareHeadline
  const sharePlanPersonal = item.sharePlanPersonalPresentation
  const userConnectPersonal = item.userConnectPersonalPresentation
  const canLinkName =
    Boolean(item.actorUserId) &&
    title.startsWith(actorLabel) &&
    (title.length === actorLabel.length || /\s/.test(title.charAt(actorLabel.length)))
  const titleRest = canLinkName ? title.slice(actorLabel.length) : null
  const commentText = item.shareComment?.trim() ?? ''
  const hasComment = commentText.length > 0
  const shared = item.sharedResource
  const hasSharedCard = Boolean(shared)
  const hasBody = hasComment || hasSharedCard
  const planMenuCase = planShareMenuCase(item, viewerUid)
  const showPlanActivityMenu = planMenuCase != null
  const showUserConnectMenu = userConnectPersonal != null
  const alreadyFollowing =
    shared?.kind === 'plan' && isAlreadyFollowingPlan(shared.ownerUserId, shared.resourceId)
  const sharedWorkoutBookmarked =
    shared?.kind === 'workout' &&
    typeof isLibraryBookmarkActive === 'function' &&
    isLibraryBookmarkActive({
      kind: 'workout',
      ownerUserId: shared.ownerUserId,
      resourceId: shared.resourceId,
    })
  const sharedCollectionBookmarked =
    shared?.kind === 'collection' &&
    typeof isLibraryBookmarkActive === 'function' &&
    isLibraryBookmarkActive({
      kind: 'collection',
      ownerUserId: shared.ownerUserId,
      resourceId: shared.resourceId,
    })
  const showWorkoutShareMenu = shared?.kind === 'workout'
  const showCollectionShareMenu = shared?.kind === 'collection'
  const workoutShareMenuMode =
    shared?.kind === 'workout' ? libraryItemShareMenuMode(item, viewerUid, 'workout') : 'recipient'
  const collectionShareMenuMode =
    shared?.kind === 'collection'
      ? libraryItemShareMenuMode(item, viewerUid, 'collection')
      : 'recipient'
  const showRemoveInboundPersonalWorkout =
    workoutShareMenuMode === 'recipient' && isPersonalInboundDirectLibraryShare(item, 'workout')
  const showRemoveInboundPersonalCollection =
    collectionShareMenuMode === 'recipient' && isPersonalInboundDirectLibraryShare(item, 'collection')
  const gid = item.groupId?.trim() ?? ''
  const showCreateGroupOwnerMenu =
    item.type === 'createGroup' &&
    Boolean(gid) &&
    ownedHubIds != null &&
    ownedHubIds.has(gid)
  const [planMenuOpen, setPlanMenuOpen] = useState(false)
  const [connectMenuOpen, setConnectMenuOpen] = useState(false)
  const [createGroupMenuOpen, setCreateGroupMenuOpen] = useState(false)
  const [workoutMenuOpen, setWorkoutMenuOpen] = useState(false)
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  const [removeFeedBusy, setRemoveFeedBusy] = useState(false)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const planMenuRef = useRef<HTMLDivElement>(null)
  const connectMenuRef = useRef<HTMLDivElement>(null)
  const createGroupMenuRef = useRef<HTMLDivElement>(null)
  const workoutMenuRef = useRef<HTMLDivElement>(null)
  const collectionMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!planMenuOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (planMenuRef.current && !planMenuRef.current.contains(e.target as Node)) {
        setPlanMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [planMenuOpen])

  useEffect(() => {
    if (!workoutMenuOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (workoutMenuRef.current && !workoutMenuRef.current.contains(e.target as Node)) {
        setWorkoutMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [workoutMenuOpen])

  useEffect(() => {
    if (!connectMenuOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (connectMenuRef.current && !connectMenuRef.current.contains(e.target as Node)) {
        setConnectMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [connectMenuOpen])

  useEffect(() => {
    if (!createGroupMenuOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (createGroupMenuRef.current && !createGroupMenuRef.current.contains(e.target as Node)) {
        setCreateGroupMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [createGroupMenuOpen])

  useEffect(() => {
    if (!collectionMenuOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (collectionMenuRef.current && !collectionMenuRef.current.contains(e.target as Node)) {
        setCollectionMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [collectionMenuOpen])

  const onFollowPlanClick = async () => {
    if (!shared || shared.kind !== 'plan') return
    setFollowBusy(true)
    try {
      const planNameSnapshot =
        shared.label?.trim() || item.planName?.trim() || undefined
      const { status } = await followPlanFromFeed({
        ownerUserId: shared.ownerUserId,
        planId: shared.resourceId,
        groupId: item.groupId,
        planNameSnapshot,
      })
      toast.success(
        status === 'pending'
          ? 'Subscription request sent. The coach will need to approve it.'
          : 'You are now following this plan',
      )
      await Promise.resolve(onFollowedPlanFromFeed?.())
      setPlanMenuOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not subscribe to this plan')
    } finally {
      setFollowBusy(false)
    }
  }

  const onRemovePersonalActivity = async () => {
    setRemoveFeedBusy(true)
    try {
      await removePersonalFeedItem(item.id)
      toast.success('Activity hidden from your feed')
      onRemoveFeedItemSuccess()
      setPlanMenuOpen(false)
      setConnectMenuOpen(false)
      setCreateGroupMenuOpen(false)
      setWorkoutMenuOpen(false)
      setCollectionMenuOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not hide activity')
    } finally {
      setRemoveFeedBusy(false)
    }
  }

  const onRemoveGroupActivity = async () => {
    const gid = item.groupId?.trim()
    if (!gid) return
    setRemoveFeedBusy(true)
    try {
      await removeGroupFeedItem(gid, item.id)
      toast.success('Activity hidden from group feed')
      onRemoveFeedItemSuccess()
      setPlanMenuOpen(false)
      setCreateGroupMenuOpen(false)
      setWorkoutMenuOpen(false)
      setCollectionMenuOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not hide activity from group feed')
    } finally {
      setRemoveFeedBusy(false)
    }
  }

  const onEditPlanClick = () => {
    if (!shared || shared.kind !== 'plan') return
    setPlanMenuOpen(false)
    onGoToOwnedPlan?.(shared.resourceId)
  }

  const showSubscribeToPlan =
    planMenuCase === 'group_peer_plan' || planMenuCase === 'personal_inbound'
  const showRemovePersonal =
    planMenuCase === 'personal_inbound' || planMenuCase === 'personal_outbound_own'
  const showEditPlan = planMenuCase === 'personal_outbound_own' || planMenuCase === 'group_own_share'
  const showRemoveGroup = planMenuCase === 'group_own_share'

  const workoutRecipientCanLibraryBookmark =
    shared?.kind === 'workout' &&
    workoutShareMenuMode === 'recipient' &&
    shared.ownerUserId.trim() !== viewerUid.trim()
  const workoutFeedBookmarked =
    workoutRecipientCanLibraryBookmark &&
    typeof isLibraryBookmarkActive === 'function' &&
    isLibraryBookmarkActive({
      kind: 'workout',
      ownerUserId: shared.ownerUserId,
      resourceId: shared.resourceId,
    })
  const collectionRecipientCanLibraryBookmark =
    shared?.kind === 'collection' &&
    collectionShareMenuMode === 'recipient' &&
    shared.ownerUserId.trim() !== viewerUid.trim()
  const collectionFeedBookmarked =
    collectionRecipientCanLibraryBookmark &&
    typeof isLibraryBookmarkActive === 'function' &&
    isLibraryBookmarkActive({
      kind: 'collection',
      ownerUserId: shared.ownerUserId,
      resourceId: shared.resourceId,
    })

  return (
    <li className="px-4 py-3">
      <article
        className="rounded-lg border border-gymnext-muted/40 bg-white p-3 shadow-sm"
        aria-label={item.title}
      >
        <div className="flex gap-2 min-w-0 items-start">
          <div className="flex gap-3 min-w-0 flex-1">
            <div className="shrink-0">
              {item.actorPhotoUrl ? (
                <img
                  src={item.actorPhotoUrl}
                  alt=""
                  className="h-11 w-11 rounded-full object-cover border border-gymnext-muted/30 bg-gymnext-background"
                  width={44}
                  height={44}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div
                  className="h-11 w-11 rounded-full border border-gymnext-muted/30 bg-gymnext-background flex items-center justify-center text-sm font-semibold text-gray-600"
                  aria-hidden
                >
                  {(item.actorDisplayName || '?').slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 leading-snug">
                {groupShareHeadline && item.groupId ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onOpenActorProfile(groupShareHeadline.profileUserId)}
                      className="font-medium text-[#6B21A8] hover:underline text-left"
                      aria-label={`View profile for ${groupShareHeadline.profileDisplayName}`}
                    >
                      {groupShareHeadline.profileDisplayName}
                    </button>
                    <span>
                      {' '}
                      shared a {feedShareResourceNoun(groupShareHeadline.resourceKind)}
                    </span>
                  </>
                ) : sharePlanPersonal ? (
                  sharePlanPersonal.variant === 'you_shared_with' ? (
                    <>
                      <span>
                        You shared a {feedShareResourceNoun(sharePlanPersonal.resourceKind)} with{' '}
                      </span>
                      <button
                        type="button"
                        onClick={() => onOpenActorProfile(sharePlanPersonal.profileUserId)}
                        className="font-medium text-[#6B21A8] hover:underline text-left"
                        aria-label={`View profile for ${sharePlanPersonal.profileDisplayName}`}
                      >
                        {sharePlanPersonal.profileDisplayName}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onOpenActorProfile(sharePlanPersonal.profileUserId)}
                        className="font-medium text-[#6B21A8] hover:underline text-left"
                        aria-label={`View profile for ${sharePlanPersonal.profileDisplayName}`}
                      >
                        {sharePlanPersonal.profileDisplayName}
                      </button>
                      <span>
                        {' '}
                        shared a {feedShareResourceNoun(sharePlanPersonal.resourceKind)} with you
                      </span>
                    </>
                  )
                ) : userConnectPersonal ? (
                  userConnectPersonal.variant === 'peer_connected_with_you' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onOpenActorProfile(userConnectPersonal.profileUserId)}
                        className="font-medium text-[#6B21A8] hover:underline text-left"
                        aria-label={`View profile for ${userConnectPersonal.profileDisplayName}`}
                      >
                        {userConnectPersonal.profileDisplayName}
                      </button>
                      <span> connected with you</span>
                    </>
                  ) : (
                    <>
                      <span>You connected with </span>
                      <button
                        type="button"
                        onClick={() => onOpenActorProfile(userConnectPersonal.profileUserId)}
                        className="font-medium text-[#6B21A8] hover:underline text-left"
                        aria-label={`View profile for ${userConnectPersonal.profileDisplayName}`}
                      >
                        {userConnectPersonal.profileDisplayName}
                      </button>
                    </>
                  )
                ) : canLinkName && titleRest != null ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onOpenActorProfile(item.actorUserId)}
                      className="font-medium text-[#6B21A8] hover:underline text-left"
                      aria-label={`View profile for ${actorLabel}`}
                    >
                      {actorLabel}
                    </button>
                    <span>{titleRest}</span>
                  </>
                ) : (
                  item.title
                )}
              </p>
              <p className="text-xs text-gray-500 mt-1.5 truncate">
                <span
                  className={
                    item.groupId
                      ? 'font-medium text-gray-600'
                      : 'font-medium text-black'
                  }
                >
                  {item.groupName}
                </span>
                <span className="mx-1.5 opacity-60" aria-hidden>
                  ·
                </span>
                <span>{when}</span>
              </p>
            </div>
          </div>
          {showUserConnectMenu && (
            <div className="relative shrink-0" ref={connectMenuRef}>
              <button
                type="button"
                onClick={() => setConnectMenuOpen((o) => !o)}
                className="rounded-md px-2 py-1 text-gray-500 hover:bg-gymnext-background hover:text-gray-800 text-lg font-bold leading-none"
                aria-label="More actions"
                aria-expanded={connectMenuOpen}
                aria-haspopup="menu"
              >
                …
              </button>
              {connectMenuOpen && (
                <div
                  className="absolute right-0 top-full z-20 mt-1 min-w-[12rem] rounded-md border border-gymnext-muted/40 bg-white py-1 shadow-lg"
                  role="menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled={removeFeedBusy}
                    onClick={() => void onRemovePersonalActivity()}
                    className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:opacity-50"
                  >
                    Hide activity from feed
                  </button>
                </div>
              )}
            </div>
          )}
          {showCreateGroupOwnerMenu && (
            <div className="relative shrink-0" ref={createGroupMenuRef}>
              <button
                type="button"
                onClick={() => setCreateGroupMenuOpen((o) => !o)}
                className="rounded-md px-2 py-1 text-gray-500 hover:bg-gymnext-background hover:text-gray-800 text-lg font-bold leading-none"
                aria-label="More actions"
                aria-expanded={createGroupMenuOpen}
                aria-haspopup="menu"
              >
                …
              </button>
              {createGroupMenuOpen && (
                <div
                  className="absolute right-0 top-full z-20 mt-1 min-w-[14rem] rounded-md border border-gymnext-muted/40 bg-white py-1 shadow-lg"
                  role="menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled={removeFeedBusy}
                    onClick={() => void onRemoveGroupActivity()}
                    className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:opacity-50"
                  >
                    Hide from group activity feed
                  </button>
                </div>
              )}
            </div>
          )}
          {showPlanActivityMenu && (
            <div className="relative shrink-0" ref={planMenuRef}>
              <button
                type="button"
                onClick={() => setPlanMenuOpen((o) => !o)}
                className="rounded-md px-2 py-1 text-gray-500 hover:bg-gymnext-background hover:text-gray-800 text-lg font-bold leading-none"
                aria-label="More actions"
                aria-expanded={planMenuOpen}
                aria-haspopup="menu"
              >
                …
              </button>
              {planMenuOpen && (
                <div
                  className="absolute right-0 top-full z-20 mt-1 min-w-[12rem] rounded-md border border-gymnext-muted/40 bg-white py-1 shadow-lg"
                  role="menu"
                >
                  {showSubscribeToPlan &&
                    (alreadyFollowing ? (
                      onGoToSubscribedPlanAhead ? (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            if (!shared || shared.kind !== 'plan') return
                            onGoToSubscribedPlanAhead(shared.ownerUserId, shared.resourceId)
                            setPlanMenuOpen(false)
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background"
                        >
                          Show Plan
                        </button>
                      ) : (
                        <div
                          role="menuitem"
                          aria-disabled="true"
                          className="w-full px-3 py-2 text-left text-sm text-gray-400 cursor-not-allowed select-none"
                          aria-label="You are following this plan"
                        >
                          Subscribed
                        </div>
                      )
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={followBusy}
                        onClick={() => void onFollowPlanClick()}
                        className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:opacity-50"
                      >
                        Follow plan
                      </button>
                    ))}
                  {showEditPlan && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!onGoToOwnedPlan}
                      onClick={() => onEditPlanClick()}
                      className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Edit plan
                    </button>
                  )}
                  {showRemovePersonal && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={removeFeedBusy}
                      onClick={() => void onRemovePersonalActivity()}
                      className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:opacity-50"
                    >
                      Hide activity from feed
                    </button>
                  )}
                  {showRemoveGroup && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={removeFeedBusy}
                      onClick={() => void onRemoveGroupActivity()}
                      className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:opacity-50"
                    >
                      Hide activity from group feed
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {showWorkoutShareMenu && shared && (
            <div className="relative shrink-0" ref={workoutMenuRef}>
              <button
                type="button"
                onClick={() => setWorkoutMenuOpen((o) => !o)}
                className="rounded-md px-2 py-1 text-gray-500 hover:bg-gymnext-background hover:text-gray-800 text-lg font-bold leading-none"
                aria-label="More actions"
                aria-expanded={workoutMenuOpen}
                aria-haspopup="menu"
              >
                …
              </button>
              {workoutMenuOpen && (
                <div
                  className="absolute right-0 top-full z-20 mt-1 min-w-[14rem] rounded-md border border-gymnext-muted/40 bg-white py-1 shadow-lg"
                  role="menu"
                >
                  {workoutShareMenuMode === 'owner_personal' || workoutShareMenuMode === 'owner_group' ? (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!onGoToOwnedWorkout}
                        onClick={() => {
                          setWorkoutMenuOpen(false)
                          onGoToOwnedWorkout?.(shared.resourceId)
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Edit workout
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={removeFeedBusy}
                        onClick={() =>
                          void (workoutShareMenuMode === 'owner_group'
                            ? onRemoveGroupActivity()
                            : onRemovePersonalActivity())
                        }
                        className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:opacity-50"
                      >
                        {workoutShareMenuMode === 'owner_group'
                          ? 'Hide activity from group feed'
                          : 'Hide activity from feed'}
                      </button>
                    </>
                  ) : (
                    <>
                      {workoutFeedBookmarked && removeSharedWorkoutBookmarkFromFeed && (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={bookmarkBusy}
                          className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => {
                            void (async () => {
                              setBookmarkBusy(true)
                              try {
                                await removeSharedWorkoutBookmarkFromFeed(
                                  shared.ownerUserId,
                                  shared.resourceId,
                                )
                                setWorkoutMenuOpen(false)
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
                      {!workoutFeedBookmarked && bookmarkSharedWorkoutFromFeed && (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={bookmarkBusy}
                          className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => {
                            void (async () => {
                              setBookmarkBusy(true)
                              try {
                                await bookmarkSharedWorkoutFromFeed(
                                  shared.ownerUserId,
                                  shared.resourceId,
                                  item.groupId,
                                )
                                setWorkoutMenuOpen(false)
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
                          setWorkoutMenuOpen(false)
                          onStartAddSharedWorkoutToPlan(shared.ownerUserId, shared.resourceId, item.groupId)
                        }}
                      >
                        Add workout to plan
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background"
                        onClick={() => {
                          setWorkoutMenuOpen(false)
                          onStartDuplicateSharedWorkout({
                            ownerUserId: shared.ownerUserId,
                            sourceWorkoutId: shared.resourceId,
                            groupId: item.groupId,
                          })
                        }}
                      >
                        Duplicate workout to library
                      </button>
                      {showRemoveInboundPersonalWorkout ? (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={removeFeedBusy}
                          onClick={() => void onRemovePersonalActivity()}
                          className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:opacity-50"
                        >
                          Hide activity from feed
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          {showCollectionShareMenu && shared && (
            <div className="relative shrink-0" ref={collectionMenuRef}>
              <button
                type="button"
                onClick={() => setCollectionMenuOpen((o) => !o)}
                className="rounded-md px-2 py-1 text-gray-500 hover:bg-gymnext-background hover:text-gray-800 text-lg font-bold leading-none"
                aria-label="More actions"
                aria-expanded={collectionMenuOpen}
                aria-haspopup="menu"
              >
                …
              </button>
              {collectionMenuOpen && (
                <div
                  className="absolute right-0 top-full z-20 mt-1 min-w-[14rem] rounded-md border border-gymnext-muted/40 bg-white py-1 shadow-lg"
                  role="menu"
                >
                  {collectionShareMenuMode === 'owner_personal' || collectionShareMenuMode === 'owner_group' ? (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!onGoToOwnedCollection}
                        onClick={() => {
                          setCollectionMenuOpen(false)
                          onGoToOwnedCollection?.(shared.resourceId)
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Edit collection
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={removeFeedBusy}
                        onClick={() =>
                          void (collectionShareMenuMode === 'owner_group'
                            ? onRemoveGroupActivity()
                            : onRemovePersonalActivity())
                        }
                        className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:opacity-50"
                      >
                        {collectionShareMenuMode === 'owner_group'
                          ? 'Hide activity from group feed'
                          : 'Hide activity from feed'}
                      </button>
                    </>
                  ) : (
                    <>
                      {collectionFeedBookmarked && removeSharedCollectionBookmarkFromFeed && (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={bookmarkBusy}
                          className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => {
                            void (async () => {
                              setBookmarkBusy(true)
                              try {
                                await removeSharedCollectionBookmarkFromFeed(
                                  shared.ownerUserId,
                                  shared.resourceId,
                                )
                                setCollectionMenuOpen(false)
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
                      {!collectionFeedBookmarked && bookmarkSharedCollectionFromFeed && (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={bookmarkBusy}
                          className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => {
                            void (async () => {
                              setBookmarkBusy(true)
                              try {
                                await bookmarkSharedCollectionFromFeed(
                                  shared.ownerUserId,
                                  shared.resourceId,
                                  item.groupId,
                                )
                                setCollectionMenuOpen(false)
                              } catch (e) {
                                toast.error(
                                  e instanceof Error ? e.message : 'Could not bookmark collection',
                                )
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
                          setCollectionMenuOpen(false)
                          onStartDuplicateSharedCollection({
                            ownerUserId: shared.ownerUserId,
                            sourceCollectionId: shared.resourceId,
                            groupId: item.groupId,
                          })
                        }}
                      >
                        Duplicate collection to library
                      </button>
                      {showRemoveInboundPersonalCollection ? (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={removeFeedBusy}
                          onClick={() => void onRemovePersonalActivity()}
                          className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:opacity-50"
                        >
                          Hide activity from feed
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {hasBody && (
          <div className="mt-3 space-y-3 border-t border-gymnext-muted/25 pt-3">
            {hasComment && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                  Comment
                </p>
                <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{commentText}</p>
              </div>
            )}
            {shared && (
              <div>
                {!hasComment && (
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                    Shared
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (
                      shared.kind === 'plan' &&
                      isAlreadyFollowingPlan(shared.ownerUserId, shared.resourceId) &&
                      onGoToSubscribedPlanAhead
                    ) {
                      onGoToSubscribedPlanAhead(shared.ownerUserId, shared.resourceId)
                      return
                    }
                    onOpenShared({
                      ownerUserId: shared.ownerUserId,
                      kind: shared.kind,
                      resourceId: shared.resourceId,
                      groupId: item.groupId,
                      titleFallback: shared.label,
                    })
                  }}
                  className="flex w-full items-center gap-3 rounded-md border border-gymnext-muted/40 bg-gymnext-background/50 px-3 py-2.5 text-left transition-colors hover:bg-gymnext-background/80 focus:outline-none focus:ring-2 focus:ring-gymnext/30"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[#6B21A8]">
                      {sharedKindLabel(shared.kind)}
                    </span>
                    <p className="text-sm font-medium text-gray-900 mt-0.5 line-clamp-3">{shared.label}</p>
                    <p className="text-xs font-medium text-[#6B21A8] mt-1.5">View details</p>
                  </div>
                  {shared.kind === 'plan' && alreadyFollowing && (
                    <span
                      className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-teal-100 text-teal-800"
                      aria-label="You are following this plan"
                    >
                      <Users className="h-4 w-4" strokeWidth={2} aria-hidden />
                    </span>
                  )}
                  {shared.kind === 'workout' && sharedWorkoutBookmarked && (
                    <span
                      className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-purple-200 text-purple-900 shadow-sm"
                      aria-label="You have bookmarked this workout"
                    >
                      <Bookmark className="h-4 w-4" strokeWidth={2} aria-hidden />
                    </span>
                  )}
                  {shared.kind === 'collection' && sharedCollectionBookmarked && (
                    <span
                      className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-purple-200 text-purple-900 shadow-sm"
                      aria-label="You have bookmarked this collection"
                    >
                      <Bookmark className="h-4 w-4" strokeWidth={2} aria-hidden />
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </article>
    </li>
  )
}

type FollowedPlanRef = { ownerUserId: string; remotePlanId: string }

export function ConnectFeedSection({
  user,
  followedPlans = [],
  onFollowedPlanFromFeed,
  reloadOverview,
  onGoToOwnedPlan,
  onGoToSubscribedPlanAhead,
  onGoToOwnedWorkout,
  onGoToOwnedCollection,
}: {
  user: User
  followedPlans?: FollowedPlanRef[]
  onFollowedPlanFromFeed?: () => void | Promise<void>
  /** Refresh `/api/app/overview` after library mutations (duplicate workout/collection). */
  reloadOverview?: () => void
  /** Planning → Plans with this owned plan selected (e.g. from “You shared a plan” preview). */
  onGoToOwnedPlan?: (planId: string) => void
  /** Planning → Plan Ahead with this followed plan active when the card is a plan you already subscribe to. */
  onGoToSubscribedPlanAhead?: (ownerUserId: string, remotePlanId: string) => void
  /** Library → open an owned workout for editing (e.g. feed row “You shared a workout”). */
  onGoToOwnedWorkout?: (workoutId: string) => void
  /** Library → open an owned collection for editing (e.g. feed row “You shared a collection”). */
  onGoToOwnedCollection?: (collectionId: string) => void
}) {
  const [items, setItems] = useState<AppFeedItemResponse[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<Pick<
    AppFeedPageResponse,
    'truncatedGroups' | 'eligibleGroupCount' | 'queriedGroupCount'
  > | null>(null)
  const [feedProfileUserId, setFeedProfileUserId] = useState<string | null>(null)
  const [ownedHubIds, setOwnedHubIds] = useState<Set<string> | null>(null)
  const [sharedPreview, setSharedPreview] = useState<SharedResourcePreviewTarget | null>(null)
  const [duplicateCtx, setDuplicateCtx] = useState<DuplicateSharedWorkoutContext | null>(null)
  const [duplicateCollectionCtx, setDuplicateCollectionCtx] =
    useState<DuplicateSharedCollectionContext | null>(null)
  const [addPlanOpen, setAddPlanOpen] = useState(false)
  const [addPlanWorkout, setAddPlanWorkout] = useState<Workout | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [feedFilterDialogOpen, setFeedFilterDialogOpen] = useState(false)
  /** Applied feed filters (both true = show all known row types). */
  const [feedShowSharedContent, setFeedShowSharedContent] = useState(true)
  const [feedShowConnectionActivity, setFeedShowConnectionActivity] = useState(true)
  /** Draft values while the filter dialog is open; committed on Done. */
  const [draftShowSharedContent, setDraftShowSharedContent] = useState(true)
  const [draftShowConnectionActivity, setDraftShowConnectionActivity] = useState(true)
  const [feedShowPersonalActivity, setFeedShowPersonalActivity] = useState(true)
  const [feedShowGroupActivity, setFeedShowGroupActivity] = useState(true)
  const [draftShowPersonalActivity, setDraftShowPersonalActivity] = useState(true)
  const [draftShowGroupActivity, setDraftShowGroupActivity] = useState(true)
  const [workoutBookmarkRows, setWorkoutBookmarkRows] = useState<SharedWorkoutBookmarkRow[]>([])
  const [collectionBookmarkRows, setCollectionBookmarkRows] = useState<SharedCollectionBookmarkRow[]>([])

  const scrollRootRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const loadingRef = useRef(false)
  const refreshInFlightRef = useRef(false)

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

  const bookmarkSharedWorkoutFromFeed = useCallback(
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

  const bookmarkSharedCollectionFromFeed = useCallback(
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

  const removeSharedWorkoutBookmarkFromFeed = useCallback(
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

  const removeSharedCollectionBookmarkFromFeed = useCallback(
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

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const token = await user.getIdToken()
      const url =
        cursor == null
          ? '/api/app/feed'
          : `/api/app/feed?cursor=${encodeURIComponent(cursor)}`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as AppFeedPageResponse & { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data
    },
    [user]
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const token = await user.getIdToken()
        const res = await fetch('/api/app/owned-groups', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = (await res.json().catch(() => ({}))) as { hubs?: HubTreeNode[]; error?: string }
        if (cancelled) return
        if (!res.ok) {
          setOwnedHubIds(new Set())
          return
        }
        const hubs = Array.isArray(data.hubs) ? data.hubs : []
        setOwnedHubIds(collectOwnedHubIdsFromTree(hubs))
      } catch {
        if (!cancelled) setOwnedHubIds(new Set())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    void loadLibraryBookmarks()
  }, [loadLibraryBookmarks])

  useEffect(() => {
    let cancelled = false
    setInitialLoading(true)
    setError(null)
    setItems([])
    setNextCursor(null)
    setHasMore(false)
    setMeta(null)
    ;(async () => {
      try {
        const data = await fetchPage(null)
        if (cancelled) return
        setItems(Array.isArray(data.items) ? data.items : [])
        setNextCursor(data.nextCursor ?? null)
        setHasMore(Boolean(data.hasMore))
        setMeta({
          truncatedGroups: Boolean(data.truncatedGroups),
          eligibleGroupCount: data.eligibleGroupCount ?? 0,
          queriedGroupCount: data.queriedGroupCount ?? 0,
        })
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load activity')
          setItems([])
        }
      } finally {
        if (!cancelled) setInitialLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fetchPage, user.uid])

  const loadMore = useCallback(async () => {
    if (!nextCursor || !hasMore || loadingRef.current) return
    const startLen = items.length
    if (startLen >= MAX_TOTAL_ITEMS) return
    loadingRef.current = true
    setLoadingMore(true)
    setError(null)
    try {
      const data = await fetchPage(nextCursor)
      const batch = Array.isArray(data.items) ? data.items : []
      const room = Math.max(0, MAX_TOTAL_ITEMS - startLen)
      const slice = batch.slice(0, room)
      const newLen = startLen + slice.length
      setItems((prev) => [...prev, ...slice])
      const capped = newLen >= MAX_TOTAL_ITEMS
      setHasMore(!capped && Boolean(data.hasMore))
      setNextCursor(capped ? null : (data.nextCursor ?? null))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load more')
    } finally {
      setLoadingMore(false)
      loadingRef.current = false
    }
  }, [fetchPage, hasMore, nextCursor, items.length])

  useEffect(() => {
    const el = sentinelRef.current
    const root = scrollRootRef.current
    if (!el || initialLoading || !hasMore || items.length >= MAX_TOTAL_ITEMS) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore()
      },
      { root: root ?? undefined, rootMargin: '120px', threshold: 0 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, initialLoading, loadMore, items.length])

  const retry = useCallback(() => {
    setInitialLoading(true)
    setError(null)
    setItems([])
    setNextCursor(null)
    setHasMore(false)
    void (async () => {
      try {
        const data = await fetchPage(null)
        setItems(Array.isArray(data.items) ? data.items : [])
        setNextCursor(data.nextCursor ?? null)
        setHasMore(Boolean(data.hasMore))
        setMeta({
          truncatedGroups: Boolean(data.truncatedGroups),
          eligibleGroupCount: data.eligibleGroupCount ?? 0,
          queriedGroupCount: data.queriedGroupCount ?? 0,
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load activity')
        setItems([])
      } finally {
        setInitialLoading(false)
      }
    })()
  }, [fetchPage])

  const fetchSharedWorkout = useCallback(
    async (ownerUserId: string, resourceId: string, groupId: string) => {
      const token = await user.getIdToken()
      const qs = new URLSearchParams()
      if (groupId.trim()) qs.set('groupId', groupId.trim())
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
    [user],
  )

  const onStartAddSharedWorkoutToPlan = useCallback(
    (ownerUserId: string, resourceId: string, groupId: string) => {
      void (async () => {
        try {
          const w = await fetchSharedWorkout(ownerUserId, resourceId, groupId)
          setAddPlanWorkout(w)
          setAddPlanOpen(true)
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Could not load workout')
        }
      })()
    },
    [fetchSharedWorkout],
  )

  const onStartDuplicateSharedWorkout = useCallback((ctx: DuplicateSharedWorkoutContext) => {
    setDuplicateCtx(ctx)
  }, [])

  const onPreviewWorkoutDuplicate = useCallback((t: SharedResourcePreviewTarget) => {
    setSharedPreview(null)
    setDuplicateCtx({
      ownerUserId: t.ownerUserId,
      sourceWorkoutId: t.resourceId,
      groupId: t.groupId,
    })
  }, [])

  const onPreviewWorkoutAddToPlan = useCallback((w: Workout) => {
    setSharedPreview(null)
    setAddPlanWorkout(w)
    setAddPlanOpen(true)
  }, [])

  const onStartDuplicateSharedCollection = useCallback((ctx: DuplicateSharedCollectionContext) => {
    setDuplicateCollectionCtx(ctx)
  }, [])

  const onPreviewCollectionDuplicate = useCallback((t: SharedResourcePreviewTarget) => {
    setSharedPreview(null)
    setDuplicateCollectionCtx({
      ownerUserId: t.ownerUserId,
      sourceCollectionId: t.resourceId,
      groupId: t.groupId,
    })
  }, [])

  const isAlreadyFollowingPlan = useMemo(() => {
    const keys = new Set(
      followedPlans.map((f) => `${f.ownerUserId}\n${f.remotePlanId}`)
    )
    return (ownerUserId: string, planId: string) => keys.has(`${ownerUserId}\n${planId}`)
  }, [followedPlans])

  const followPlanFromFeed = useCallback(
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
      if (planDescriptionSnapshot?.trim())
        body.planDescriptionSnapshot = planDescriptionSnapshot.trim()
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
    [user],
  )

  const refreshFeed = useCallback(async () => {
    if (initialLoading || refreshInFlightRef.current) return
    refreshInFlightRef.current = true
    setRefreshing(true)
    setError(null)
    try {
      const data = await fetchPage(null)
      setItems(Array.isArray(data.items) ? data.items : [])
      setNextCursor(data.nextCursor ?? null)
      setHasMore(Boolean(data.hasMore))
      setMeta({
        truncatedGroups: Boolean(data.truncatedGroups),
        eligibleGroupCount: data.eligibleGroupCount ?? 0,
        queriedGroupCount: data.queriedGroupCount ?? 0,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh activity')
    } finally {
      refreshInFlightRef.current = false
      setRefreshing(false)
    }
  }, [fetchPage, initialLoading])

  const feedFilterIsActive =
    !feedShowSharedContent ||
    !feedShowConnectionActivity ||
    !feedShowPersonalActivity ||
    !feedShowGroupActivity

  const openFeedFilterDialog = useCallback(() => {
    setDraftShowSharedContent(feedShowSharedContent)
    setDraftShowConnectionActivity(feedShowConnectionActivity)
    setDraftShowPersonalActivity(feedShowPersonalActivity)
    setDraftShowGroupActivity(feedShowGroupActivity)
    setFeedFilterDialogOpen(true)
  }, [
    feedShowSharedContent,
    feedShowConnectionActivity,
    feedShowPersonalActivity,
    feedShowGroupActivity,
  ])

  const applyFeedFilterDraft = useCallback(() => {
    setFeedShowSharedContent(draftShowSharedContent)
    setFeedShowConnectionActivity(draftShowConnectionActivity)
    setFeedShowPersonalActivity(draftShowPersonalActivity)
    setFeedShowGroupActivity(draftShowGroupActivity)
    setFeedFilterDialogOpen(false)
  }, [
    draftShowSharedContent,
    draftShowConnectionActivity,
    draftShowPersonalActivity,
    draftShowGroupActivity,
  ])

  const displayedFeedItems = useMemo(() => {
    return items.filter((item) => {
      let matchesKind: boolean
      if (feedItemIsSharedContent(item)) {
        matchesKind = feedShowSharedContent
      } else if (feedItemIsConnectionActivity(item)) {
        matchesKind = feedShowConnectionActivity
      } else if (item.type === 'unknown') {
        matchesKind = feedShowSharedContent && feedShowConnectionActivity
      } else {
        matchesKind = feedShowSharedContent && feedShowConnectionActivity
      }
      if (!matchesKind) return false

      if (feedItemFromPersonalUserFeed(item) && !feedShowPersonalActivity) return false
      if (feedItemFromGroupFeed(item) && !feedShowGroupActivity) return false
      return true
    })
  }, [
    items,
    feedShowSharedContent,
    feedShowConnectionActivity,
    feedShowPersonalActivity,
    feedShowGroupActivity,
  ])

  const removePersonalFeedItemApi = useCallback(
    async (feedItemId: string) => {
      const token = await user.getIdToken()
      const res = await fetch(`/api/app/feed/personal/${encodeURIComponent(feedItemId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    },
    [user],
  )

  const removeGroupFeedItemApi = useCallback(
    async (groupId: string, feedItemId: string) => {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/app/feed/group/${encodeURIComponent(groupId)}/${encodeURIComponent(feedItemId)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      )
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    },
    [user],
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white shadow-sm">
      <PublicUserProfileDialog
        open={feedProfileUserId != null}
        userId={feedProfileUserId}
        onClose={() => setFeedProfileUserId(null)}
        viewer={user}
      />
      <SharedResourcePreviewDialog
        open={sharedPreview != null}
        target={sharedPreview}
        onClose={() => setSharedPreview(null)}
        viewer={user}
        onWorkoutMenuDuplicate={onPreviewWorkoutDuplicate}
        onWorkoutMenuAddToPlan={onPreviewWorkoutAddToPlan}
        onCollectionMenuDuplicate={onPreviewCollectionDuplicate}
        followPlanFromFeed={followPlanFromFeed}
        isAlreadyFollowingPlan={isAlreadyFollowingPlan}
        onFollowPlanSuccess={() => void onFollowedPlanFromFeed?.()}
        onGoToOwnedPlan={onGoToOwnedPlan}
        onGoToSubscribedPlanAhead={onGoToSubscribedPlanAhead}
        isLibraryBookmarkActive={isLibraryBookmarkActive}
        onLibraryBookmarksSaved={loadLibraryBookmarks}
      />
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
                : `Collection copied. ${skippedWorkoutCount} workouts were missing and were skipped.`,
            )
          } else {
            toast.success('Collection and workouts copied to your library')
          }
          reloadOverview?.()
        }}
      />
      <DuplicateSharedWorkoutDialog
        open={duplicateCtx != null}
        context={duplicateCtx}
        viewer={user}
        onClose={() => setDuplicateCtx(null)}
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

      <div className="flex shrink-0 items-center justify-end border-b border-gymnext-muted/30 bg-gymnext-background px-3 py-2">
        <div className="flex w-[18.5rem] shrink-0 gap-2">
          <button
            type="button"
            onClick={openFeedFilterDialog}
            disabled={initialLoading}
            className={`inline-flex min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-50 ${
              feedFilterIsActive
                ? 'border-[#6B21A8] bg-purple-50/80 text-[#6B21A8]'
                : 'border-gymnext-muted/50 bg-white text-gray-800'
            }`}
          >
            <ListFilter className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
            Filter
          </button>
          <button
            type="button"
            onClick={() => void refreshFeed()}
            disabled={initialLoading || refreshing}
            className="inline-flex min-w-0 flex-1 basis-0 items-center justify-center rounded px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: '#6B21A8' }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {feedFilterDialogOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => setFeedFilterDialogOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="feed-filter-title"
            className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-xl"
          >
            <div className="border-b border-gymnext-muted/30 px-4 py-3">
              <h2 id="feed-filter-title" className="text-sm font-semibold text-gray-900">
                Activity feed filter
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                Choose which kinds of activity to show, then tap Done to update the list.
              </p>
            </div>
            <div className="space-y-4 px-4 py-4">
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-gray-900">Activity Type</h3>
                <div className="space-y-3">
                  <label className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 bg-gray-50/80 px-3 py-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-[#6B21A8] focus:ring-[#6B21A8]"
                      checked={draftShowSharedContent}
                      onChange={(e) => setDraftShowSharedContent(e.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900">Shared Content</span>
                      <span className="mt-0.5 block text-xs text-gray-600">
                        When on, the feed includes shares of workouts, collections, and training plans.
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 bg-gray-50/80 px-3 py-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-[#6B21A8] focus:ring-[#6B21A8]"
                      checked={draftShowConnectionActivity}
                      onChange={(e) => setDraftShowConnectionActivity(e.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900">Connection Activity</span>
                      <span className="mt-0.5 block text-xs text-gray-600">
                        When on, the feed includes new connections between users, joining or leaving hubs, and
                        creating a new hub.
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              <div className="space-y-3 border-t border-gymnext-muted/20 pt-3">
                <h3 className="text-xs font-semibold text-gray-900">Activity Source</h3>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border border-gray-200 bg-gray-50/80 px-2.5 py-2.5">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-[#6B21A8] focus:ring-[#6B21A8]"
                      checked={draftShowPersonalActivity}
                      onChange={(e) => setDraftShowPersonalActivity(e.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900">Personal Activity</span>
                      <span className="mt-0.5 block text-xs text-gray-600">
                        Activity from your connections
                      </span>
                    </span>
                  </label>
                  <label className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border border-gray-200 bg-gray-50/80 px-2.5 py-2.5">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-[#6B21A8] focus:ring-[#6B21A8]"
                      checked={draftShowGroupActivity}
                      onChange={(e) => setDraftShowGroupActivity(e.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900">Group Activity</span>
                      <span className="mt-0.5 block text-xs text-gray-600">
                        Activity from hubs
                      </span>
                    </span>
                  </label>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gymnext-muted/30 px-4 py-3">
              <button
                type="button"
                onClick={() => setFeedFilterDialogOpen(false)}
                className="rounded border border-gymnext-muted/40 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyFeedFilterDraft}
                className="rounded bg-[#6B21A8] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        ref={scrollRootRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {meta?.truncatedGroups && meta.eligibleGroupCount > meta.queriedGroupCount && (
          <p className="px-4 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">
            You belong to {meta.eligibleGroupCount} hubs; this activity includes the first {meta.queriedGroupCount}{' '}
            (alphabetically by hub id) because of Firestore query limits.
          </p>
        )}

        {initialLoading && (
          <p className="px-4 py-8 text-sm text-gray-500 text-center">Loading activity…</p>
        )}

        {!initialLoading && error && items.length === 0 && (
          <div className="px-4 py-4 space-y-2">
            <p className="text-sm text-red-700">{error}</p>
            <button
              type="button"
              onClick={() => retry()}
              className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90"
              style={{ backgroundColor: '#6B21A8' }}
            >
              Retry
            </button>
          </div>
        )}

        {!initialLoading && error && items.length > 0 && (
          <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
            <p className="min-w-0 flex-1 text-sm text-red-800">{error}</p>
            <button
              type="button"
              onClick={() => void refreshFeed()}
              disabled={refreshing}
              className="shrink-0 rounded px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#6B21A8' }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => setError(null)}
              className="shrink-0 rounded px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
            >
              Dismiss
            </button>
          </div>
        )}

        {!initialLoading && !error && items.length === 0 && (
          <div className="flex flex-1 items-center justify-center px-4 py-8 text-sm text-gray-500 text-center">
            No activity detected. Connect with other users or join a Hub.
          </div>
        )}

        {!initialLoading && items.length > 0 && (
          <>
            {!error && items.length > 0 && displayedFeedItems.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
                <p className="text-sm text-gray-600">
                  Nothing in the activity loaded so far matches your filters. Open Filter to adjust
                  categories, or tap Refresh / scroll to load more.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setFeedShowSharedContent(true)
                    setFeedShowConnectionActivity(true)
                    setFeedShowPersonalActivity(true)
                    setFeedShowGroupActivity(true)
                    setFeedFilterDialogOpen(false)
                  }}
                  className="text-sm font-medium text-[#6B21A8] hover:underline"
                >
                  Show all activity
                </button>
              </div>
            )}
            {displayedFeedItems.length > 0 && (
              <ul className="divide-y divide-gymnext-muted/20">
                {displayedFeedItems.map((item) => (
                  <FeedRow
                    key={`${item.groupId || 'personal'}-${item.id}-${item.createdAt}`}
                    item={item}
                    viewerUid={user.uid}
                    onOpenActorProfile={(id) => setFeedProfileUserId(id)}
                    onOpenShared={(target) => setSharedPreview(target)}
                    followPlanFromFeed={followPlanFromFeed}
                    isAlreadyFollowingPlan={isAlreadyFollowingPlan}
                    onFollowedPlanFromFeed={onFollowedPlanFromFeed}
                    onStartDuplicateSharedWorkout={onStartDuplicateSharedWorkout}
                    onStartAddSharedWorkoutToPlan={onStartAddSharedWorkoutToPlan}
                    onStartDuplicateSharedCollection={onStartDuplicateSharedCollection}
                    onGoToOwnedPlan={onGoToOwnedPlan}
                    onGoToSubscribedPlanAhead={onGoToSubscribedPlanAhead}
                    onGoToOwnedWorkout={onGoToOwnedWorkout}
                    onGoToOwnedCollection={onGoToOwnedCollection}
                    removePersonalFeedItem={removePersonalFeedItemApi}
                    removeGroupFeedItem={removeGroupFeedItemApi}
                    ownedHubIds={ownedHubIds}
                    onRemoveFeedItemSuccess={() => {
                      setItems((prev) =>
                        prev.filter(
                          (x) => !(x.id === item.id && (x.groupId || '') === (item.groupId || '')),
                        ),
                      )
                    }}
                    isLibraryBookmarkActive={isLibraryBookmarkActive}
                    bookmarkSharedWorkoutFromFeed={bookmarkSharedWorkoutFromFeed}
                    removeSharedWorkoutBookmarkFromFeed={removeSharedWorkoutBookmarkFromFeed}
                    bookmarkSharedCollectionFromFeed={bookmarkSharedCollectionFromFeed}
                    removeSharedCollectionBookmarkFromFeed={removeSharedCollectionBookmarkFromFeed}
                  />
                ))}
              </ul>
            )}
            {items.length >= MAX_TOTAL_ITEMS && (
              <p className="px-4 py-3 text-xs text-gray-500 text-center border-t border-gymnext-muted/20">
                Showing the {MAX_TOTAL_ITEMS} most recent items.
              </p>
            )}
            <div ref={sentinelRef} className="h-1 w-full" aria-hidden />
            {loadingMore && (
              <p className="px-4 py-3 text-xs text-gray-500 text-center">Loading more…</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
