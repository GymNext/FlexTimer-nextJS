'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { User } from 'firebase/auth'
import toast from 'react-hot-toast'
import {
  getCollectionDisplayDescription,
  getCollectionDisplayName,
  getScheduleDisplayDescription,
  getSegmentDisplayName,
  getWorkoutDetailDescription,
  getWorkoutDisplayName,
} from '@/lib/json-workout-format'
import type { Workout, WorkoutCollection, WorkoutPlan } from '@/types/user'

export type SharedResourcePreviewTarget = {
  ownerUserId: string
  kind: 'workout' | 'plan' | 'collection'
  resourceId: string
  /** Hub id when the feed row was from a group; empty for personal feed. */
  groupId: string
  titleFallback: string
}

/** Per-workout … menu inside collection preview (portal so dialog overflow-hidden does not clip). */
function CollectionWorkoutRowWithMenu({
  workout,
  collectionTarget,
  onWorkoutMenuDuplicate,
  onWorkoutMenuAddToPlan,
}: {
  workout: Workout
  collectionTarget: SharedResourcePreviewTarget
  onWorkoutMenuDuplicate?: (t: SharedResourcePreviewTarget) => void
  onWorkoutMenuAddToPlan?: (w: Workout) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null)
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

  const resourceId = workout.workoutId?.trim() || workout.id
  const workoutTarget: SharedResourcePreviewTarget = {
    ownerUserId: collectionTarget.ownerUserId,
    kind: 'workout',
    resourceId,
    groupId: collectionTarget.groupId,
    titleFallback: getWorkoutDisplayName(workout).trim() || 'Workout',
  }

  const showMenu = Boolean(onWorkoutMenuDuplicate || onWorkoutMenuAddToPlan)

  return (
    <li className="flex items-start gap-2 rounded-md border border-gymnext-muted/30 bg-gymnext-background/40 px-2.5 py-2">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-gray-900">{getWorkoutDisplayName(workout)}</p>
        <p className="text-xs text-gray-500 mt-0.5">{getScheduleDisplayDescription(workout)}</p>
      </div>
      {showMenu && (
        <div className="relative flex shrink-0 items-start" ref={menuWrapRef}>
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
            className="rounded-md px-2 py-1 text-gray-500 hover:bg-white/80 hover:text-gray-800 text-lg font-bold leading-none"
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
                  className="fixed inset-0 z-[200]"
                  aria-hidden
                  onClick={() => {
                    setMenuOpen(false)
                    setMenuAnchorRect(null)
                  }}
                />
                <div
                  ref={menuPanelRef}
                  className="fixed z-[201] min-w-[14rem] rounded-md border border-gymnext-muted/40 bg-white py-1 shadow-lg"
                  role="menu"
                  style={{
                    top: menuAnchorRect.bottom + 4,
                    right: typeof window !== 'undefined' ? window.innerWidth - menuAnchorRect.right : 0,
                  }}
                >
                  {onWorkoutMenuDuplicate && (
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background"
                      onClick={() => {
                        setMenuOpen(false)
                        setMenuAnchorRect(null)
                        onWorkoutMenuDuplicate(workoutTarget)
                      }}
                    >
                      Duplicate workout to library
                    </button>
                  )}
                  {onWorkoutMenuAddToPlan && (
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background"
                      onClick={() => {
                        setMenuOpen(false)
                        setMenuAnchorRect(null)
                        onWorkoutMenuAddToPlan(workout)
                      }}
                    >
                      Add workout to plan
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

export function SharedResourcePreviewDialog({
  open,
  target,
  onClose,
  viewer,
  onWorkoutMenuDuplicate,
  onWorkoutMenuAddToPlan,
  onCollectionMenuDuplicate,
  followPlanFromFeed,
  isAlreadyFollowingPlan,
  onFollowPlanSuccess,
  unfollowPlanFromFeed,
  subscriptionDocumentIdForPlan,
  onGoToOwnedPlan,
  onGoToSubscribedPlanAhead,
}: {
  open: boolean
  target: SharedResourcePreviewTarget | null
  onClose: () => void
  viewer: User
  /** Feed / preview: duplicate shared workout into the viewer's library (picker opens in parent). */
  onWorkoutMenuDuplicate?: (target: SharedResourcePreviewTarget) => void
  /** Requires loaded workout payload. */
  onWorkoutMenuAddToPlan?: (workout: Workout) => void
  /** Duplicate shared collection + workouts into the viewer's library (confirm dialog in parent). */
  onCollectionMenuDuplicate?: (target: SharedResourcePreviewTarget) => void
  /** Same as feed plan row: POST /api/app/following-plans with owner + remote plan id. */
  followPlanFromFeed?: (params: {
    ownerUserId: string
    planId: string
    groupId: string
    planNameSnapshot?: string | null
    planDescriptionSnapshot?: string | null
  }) => Promise<{ status: string }>
  isAlreadyFollowingPlan?: (ownerUserId: string, planId: string) => boolean
  onFollowPlanSuccess?: () => void
  /** With `subscriptionDocumentIdForPlan`, plan … menu can offer Unsubscribe. */
  unfollowPlanFromFeed?: (subscriptionDocumentId: string) => Promise<void>
  subscriptionDocumentIdForPlan?: (ownerUserId: string, planId: string) => string | null
  /** When the preview is the viewer’s own plan (e.g. activity feed “You shared a plan”), jump to Planning → Plans with this plan selected. */
  onGoToOwnedPlan?: (planId: string) => void
  /** When already following someone else’s plan, … menu can open Plan Ahead with this subscription active. */
  onGoToSubscribedPlanAhead?: (ownerUserId: string, remotePlanId: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<
    | { kind: 'workout'; data: Workout }
    | { kind: 'plan'; data: WorkoutPlan }
    | { kind: 'collection'; data: WorkoutCollection; workouts: Workout[]; workoutsTruncated: boolean }
    | null
  >(null)
  const [workoutMenuOpen, setWorkoutMenuOpen] = useState(false)
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false)
  const [planMenuOpen, setPlanMenuOpen] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  const collectionMenuRef = useRef<HTMLDivElement>(null)
  const planMenuRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!target) return
    setLoading(true)
    setError(null)
    setPayload(null)
    try {
      const token = await viewer.getIdToken()
      const qs = new URLSearchParams()
      if (target.groupId.trim()) qs.set('groupId', target.groupId.trim())
      const q = qs.toString()
      const url = `/api/app/shared-content/${encodeURIComponent(target.ownerUserId)}/${target.kind}/${encodeURIComponent(target.resourceId)}${q ? `?${q}` : ''}`
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        kind?: string
        data?: unknown
        workouts?: unknown
        workoutsTruncated?: unknown
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const k = data.kind
      if (k === 'workout' && data.data && typeof data.data === 'object') {
        setPayload({ kind: 'workout', data: data.data as Workout })
      } else if (k === 'plan' && data.data && typeof data.data === 'object') {
        setPayload({ kind: 'plan', data: data.data as WorkoutPlan })
      } else if (k === 'collection' && data.data && typeof data.data === 'object') {
        const workoutsRaw = data.workouts
        const workouts = Array.isArray(workoutsRaw)
          ? (workoutsRaw as Workout[]).filter((w) => w != null && typeof w === 'object')
          : []
        setPayload({
          kind: 'collection',
          data: data.data as WorkoutCollection,
          workouts,
          workoutsTruncated: data.workoutsTruncated === true,
        })
      } else {
        throw new Error('Unexpected response')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
      setPayload(null)
    } finally {
      setLoading(false)
    }
  }, [target, viewer])

  useEffect(() => {
    if (!open || !target) {
      setPayload(null)
      setError(null)
      setLoading(false)
      setWorkoutMenuOpen(false)
      setCollectionMenuOpen(false)
      setPlanMenuOpen(false)
      return
    }
    void load()
  }, [open, target, load])

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

  if (!open || !target) return null

  const showGoToOwnedPlanButton =
    typeof onGoToOwnedPlan === 'function' &&
    target.kind === 'plan' &&
    target.ownerUserId === viewer.uid &&
    !loading &&
    !error &&
    payload?.kind === 'plan'

  const showPlanFollowMenu =
    target.kind === 'plan' &&
    target.ownerUserId !== viewer.uid &&
    typeof followPlanFromFeed === 'function' &&
    typeof isAlreadyFollowingPlan === 'function'
  const alreadyFollowingPlan =
    showPlanFollowMenu && isAlreadyFollowingPlan(target.ownerUserId, target.resourceId)
  /** Someone else's plan: subscribe is a footer CTA, not the header … menu. */
  const showSubscribeToSharedPlanFooter =
    showPlanFollowMenu &&
    !alreadyFollowingPlan &&
    !loading &&
    !error &&
    payload?.kind === 'plan'

  const onFollowPlanClick = async () => {
    if (target.kind !== 'plan' || !followPlanFromFeed) return
    setFollowBusy(true)
    try {
      const planNameSnapshot =
        payload?.kind === 'plan'
          ? payload.data.workoutPlanName?.trim() || target.titleFallback.trim() || undefined
          : target.titleFallback.trim() || undefined
      const planDescriptionSnapshot =
        payload?.kind === 'plan' ? payload.data.workoutPlanDescription?.trim() || null : null
      const { status } = await followPlanFromFeed({
        ownerUserId: target.ownerUserId,
        planId: target.resourceId,
        groupId: target.groupId,
        planNameSnapshot,
        planDescriptionSnapshot: planDescriptionSnapshot || undefined,
      })
      toast.success(
        status === 'pending'
          ? 'Subscription request sent. The coach will need to approve it.'
          : 'You are now following this plan',
      )
      onFollowPlanSuccess?.()
      setPlanMenuOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not subscribe to this plan')
    } finally {
      setFollowBusy(false)
    }
  }

  const onUnfollowPlanClick = async () => {
    if (target.kind !== 'plan' || !unfollowPlanFromFeed || !subscriptionDocumentIdForPlan) return
    const subId = subscriptionDocumentIdForPlan(target.ownerUserId, target.resourceId)
    if (!subId) return
    setFollowBusy(true)
    try {
      await unfollowPlanFromFeed(subId)
      toast.success('You are no longer following this plan')
      onFollowPlanSuccess?.()
      setPlanMenuOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not unsubscribe from this plan')
    } finally {
      setFollowBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[72] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden onClick={onClose} />
      <div
        className="relative w-full max-w-md max-h-[min(90vh,32rem)] flex flex-col rounded-lg border border-gymnext-muted/30 bg-white shadow-lg overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label={target.titleFallback.trim() || 'Shared content'}
      >
        <div className="border-b border-gymnext-muted/30 px-3 py-3 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="text-gray-500 hover:text-gray-800 text-lg leading-none px-1 shrink-0 w-9 flex justify-start"
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>
            {showPlanFollowMenu && alreadyFollowingPlan && (
              <span
                className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
                aria-label="You have a subscription to this plan"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!loading &&
              !error &&
              payload?.kind === 'workout' &&
              target &&
              (onWorkoutMenuDuplicate || onWorkoutMenuAddToPlan) && (
              <div className="relative shrink-0">
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
                    className="absolute right-0 top-full z-10 mt-1 min-w-[14rem] rounded-md border border-gymnext-muted/40 bg-white py-1 shadow-lg"
                    role="menu"
                  >
                    {onWorkoutMenuAddToPlan && (
                      <button
                        type="button"
                        role="menuitem"
                        className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background"
                        onClick={() => {
                          setWorkoutMenuOpen(false)
                          if (payload?.kind === 'workout') onWorkoutMenuAddToPlan(payload.data)
                        }}
                      >
                        Add workout to plan
                      </button>
                    )}
                    {onWorkoutMenuDuplicate && (
                      <button
                        type="button"
                        role="menuitem"
                        className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background"
                        onClick={() => {
                          setWorkoutMenuOpen(false)
                          onWorkoutMenuDuplicate(target)
                        }}
                      >
                        Duplicate workout to library
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {showPlanFollowMenu && alreadyFollowingPlan && (
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
                  {typeof onGoToSubscribedPlanAhead === 'function' && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onGoToSubscribedPlanAhead(target.ownerUserId, target.resourceId)
                        setPlanMenuOpen(false)
                        onClose()
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background"
                    >
                      Plan ahead
                    </button>
                  )}
                  {unfollowPlanFromFeed &&
                    subscriptionDocumentIdForPlan &&
                    subscriptionDocumentIdForPlan(target.ownerUserId, target.resourceId) && (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={followBusy}
                        onClick={() => void onUnfollowPlanClick()}
                        className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background disabled:opacity-50"
                      >
                        Unsubscribe
                      </button>
                    )}
                  {typeof onGoToSubscribedPlanAhead !== 'function' &&
                    !(
                      unfollowPlanFromFeed &&
                      subscriptionDocumentIdForPlan &&
                      subscriptionDocumentIdForPlan(target.ownerUserId, target.resourceId)
                    ) && (
                      <div
                        role="menuitem"
                        aria-disabled="true"
                        aria-label="You have a subscription to this plan"
                        className="w-full px-3 py-2 text-left text-sm text-gray-400 cursor-not-allowed select-none"
                      >
                        Subscribed
                      </div>
                    )}
                </div>
              )}
            </div>
            )}
            {!loading &&
              !error &&
              payload?.kind === 'collection' &&
              onCollectionMenuDuplicate && (
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
                    className="absolute right-0 top-full z-10 mt-1 min-w-[14rem] rounded-md border border-gymnext-muted/40 bg-white py-1 shadow-lg"
                    role="menu"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gymnext-background"
                      onClick={() => {
                        setCollectionMenuOpen(false)
                        onCollectionMenuDuplicate(target)
                      }}
                    >
                      Duplicate collection to library
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0 p-4">
          {loading && <p className="text-sm text-gray-500 text-center py-6">Loading…</p>}
          {!loading && error && <p className="text-sm text-red-600 text-center py-6">{error}</p>}
          {!loading && !error && payload?.kind === 'workout' && (
            <div className="space-y-3 text-sm">
              <p className="font-medium text-gray-900">
                {getWorkoutDisplayName(payload.data).trim() || target.titleFallback.trim() || 'Workout'}
              </p>
              <p className="text-gray-600">{getWorkoutDetailDescription(payload.data)}</p>
              <p className="text-gray-500 text-xs">{getScheduleDisplayDescription(payload.data)}</p>
              {payload.data.type !== 'MultiSegmentWorkout' &&
                payload.data.workoutDetails != null &&
                String(payload.data.workoutDetails).trim() !== '' && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                      Details
                    </p>
                    <p className="text-gray-700 whitespace-pre-wrap break-words">
                      {String(payload.data.workoutDetails).trim()}
                    </p>
                  </div>
                )}
              {payload.data.segments &&
                payload.data.segments.length > 0 &&
                payload.data.segments.map((seg, i) => {
                  const details = seg.workoutDetails != null ? String(seg.workoutDetails).trim() : ''
                  if (!details) return null
                  return (
                    <div key={`${seg.workoutId}-${i}`}>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                        {getSegmentDisplayName(seg, i)}
                      </p>
                      <p className="text-gray-700 whitespace-pre-wrap break-words">{details}</p>
                    </div>
                  )
                })}
            </div>
          )}
          {!loading && !error && payload?.kind === 'plan' && (
            <div className="space-y-2 text-sm">
              <p className="font-medium text-gray-900">{payload.data.workoutPlanName?.trim() || 'Plan'}</p>
              {payload.data.workoutPlanDescription?.trim() && (
                <p className="text-gray-600 whitespace-pre-wrap">{payload.data.workoutPlanDescription.trim()}</p>
              )}
            </div>
          )}
          {!loading && !error && payload?.kind === 'collection' && (
            <div className="space-y-3 text-sm">
              <p className="font-medium text-gray-900">{getCollectionDisplayName(payload.data)}</p>
              <p className="text-gray-600">{getCollectionDisplayDescription(payload.data)}</p>
              {payload.workouts.length === 0 &&
                Array.isArray(payload.data.workoutIds) &&
                payload.data.workoutIds.some((id) => typeof id === 'string' && id.trim() !== '') && (
                  <p className="text-xs text-gray-500">
                    Workouts in this collection could not be loaded (they may have been removed).
                  </p>
                )}
              {payload.workouts.length > 0 && (
                <div className="border-t border-gymnext-muted/25 pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                    Workouts in this collection
                  </p>
                  <ul className="space-y-2">
                    {payload.workouts.map((w) => (
                      <CollectionWorkoutRowWithMenu
                        key={w.workoutId || w.id}
                        workout={w}
                        collectionTarget={target}
                        onWorkoutMenuDuplicate={onWorkoutMenuDuplicate}
                        onWorkoutMenuAddToPlan={onWorkoutMenuAddToPlan}
                      />
                    ))}
                  </ul>
                  {payload.workoutsTruncated && (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1.5 mt-2">
                      This collection lists more workouts than we can show here; only the first portion is
                      included.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {showSubscribeToSharedPlanFooter && (
          <div className="shrink-0 border-t border-gymnext-muted/30 px-4 py-3 flex justify-end bg-white">
            <button
              type="button"
              disabled={followBusy}
              onClick={() => void onFollowPlanClick()}
              className="rounded-md px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: '#6B21A8' }}
            >
              Follow plan
            </button>
          </div>
        )}
        {showGoToOwnedPlanButton && (
          <div className="shrink-0 border-t border-gymnext-muted/30 px-4 py-3 flex justify-end bg-white">
            <button
              type="button"
              onClick={() => {
                const planId = target.resourceId
                onClose()
                onGoToOwnedPlan?.(planId)
              }}
              className="rounded-md px-3 py-2 text-sm font-medium text-white hover:opacity-90"
              style={{ backgroundColor: '#6B21A8' }}
            >
              Edit plan
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
