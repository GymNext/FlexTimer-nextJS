'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MoreHorizontal, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import type { User } from 'firebase/auth'
import type { Workout, WorkoutCollection } from '@/types/user'
import {
  getCollectionDisplayDescription,
  getCollectionDisplayName,
  getWorkoutBarColor,
  getWorkoutDetailDescription,
  getWorkoutDisplayName,
  parseWorkoutScheduleForDisplay,
  type WorkoutEntryLike,
} from '@/lib/json-workout-format'
import type { SharedCollectionBookmarkRow, SharedWorkoutBookmarkRow } from '@/lib/bookmarks'

/** Bar color when list row has no loaded workout (matches default / unknown timer strip). */
const BOOKMARK_LIST_WORKOUT_BAR_SOURCE: WorkoutEntryLike = {}
const BOOKMARK_LIST_WORKOUT_BAR_COLOR = getWorkoutBarColor(BOOKMARK_LIST_WORKOUT_BAR_SOURCE)

function CollectionFolderIcon({ className = 'text-amber-700/80' }: { className?: string }) {
  return (
    <span className={`shrink-0 ${className}`} aria-hidden>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <path d="M19.5 21a3 3 0 003-3v-4.875a3 3 0 00-.684-1.9l-1.425-1.9a3 3 0 00-2.4-1.2H15.75l-.787-1.05A3 3 0 0012.422 6H4.5a3 3 0 00-3 3v9a3 3 0 003 3h15z" />
      </svg>
    </span>
  )
}

type BookmarksResponse = {
  collections: SharedCollectionBookmarkRow[]
  workouts: SharedWorkoutBookmarkRow[]
}

type SelectedTarget =
  | { kind: 'collection'; row: SharedCollectionBookmarkRow }
  | { kind: 'workout'; row: SharedWorkoutBookmarkRow }

type SharedContentCollectionResponse = {
  kind: 'collection'
  data: WorkoutCollection
  workouts: Workout[]
  workoutsTruncated: boolean
}

type SharedContentWorkoutResponse = {
  kind: 'workout'
  data: Workout
}

function bookmarkDetailHeaderTitle(
  selected: SelectedTarget,
  detailWorkout: Workout | null,
  detailCollection: SharedContentCollectionResponse | null,
): string {
  if (selected.kind === 'workout') {
    if (detailWorkout) {
      const n = getWorkoutDisplayName(detailWorkout).trim()
      if (n) return n
    }
    return titleFromWorkoutBookmark(selected.row)
  }
  if (detailCollection) {
    const raw = getCollectionDisplayName(detailCollection.data).trim()
    if (raw && raw !== '<empty>') return raw
  }
  return titleFromCollectionBookmark(selected.row)
}

function bookmarkDetailHeaderSubtitle(
  selected: SelectedTarget,
  detailWorkout: Workout | null,
  detailCollection: SharedContentCollectionResponse | null,
): string | null {
  if (selected.kind === 'workout' && detailWorkout) {
    const scheduleSection =
      detailWorkout.type === 'SingleSegmentWorkout'
        ? parseWorkoutScheduleForDisplay(detailWorkout.workoutSchedule)
        : null
    const timerModeLabel =
      scheduleSection?.rows.find((r) => r.label === 'Timer mode')?.value?.trim() || ''
    const line = (timerModeLabel || getWorkoutDetailDescription(detailWorkout) || '').trim()
    return line || null
  }
  if (selected.kind === 'collection' && detailCollection) {
    const line = getCollectionDisplayDescription({
      workoutCollectionDescription: detailCollection.data.workoutCollectionDescription,
      workoutIds: detailCollection.data.workoutIds,
    }).trim()
    return line || null
  }
  return null
}

function BookmarkDetailOverflowMenu({
  disabled,
  onConfirmRemove,
}: {
  disabled: boolean
  onConfirmRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocDown(e: MouseEvent) {
      if (rootRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Bookmark actions"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-[11rem] rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className="w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
            onClick={() => {
              setOpen(false)
              if (
                window.confirm(
                  'Remove this bookmark? It will leave your list; you can add it again later if you regain access.',
                )
              ) {
                onConfirmRemove()
              }
            }}
          >
            Remove bookmark
          </button>
        </div>
      ) : null}
    </div>
  )
}

function stableKeyFor(row: SelectedTarget): string {
  if (row.kind === 'collection') {
    return `collection\u001e${row.row.ownerUserId}\u001e${row.row.remoteCollectionId}`
  }
  return `workout\u001e${row.row.ownerUserId}\u001e${row.row.remoteWorkoutId}`
}

function titleFromWorkoutBookmark(row: SharedWorkoutBookmarkRow): string {
  return row.workoutNameSnapshot?.trim() || row.workoutDescriptionSnapshot?.trim() || 'Workout'
}

function titleFromCollectionBookmark(row: SharedCollectionBookmarkRow): string {
  return row.collectionNameSnapshot?.trim() || row.collectionDescriptionSnapshot?.trim() || 'Collection'
}

function collectionOfWorkoutsSubtitle(count: number | null): string {
  if (typeof count === 'number' && count >= 0) {
    return count === 1 ? 'Collection of 1 workout' : `Collection of ${count} workouts`
  }
  return 'Collection of workouts'
}

/** Left-panel subtitle: prefer stored description when it adds info beyond the title; otherwise workout count line. */
function descriptionFromCollectionBookmark(row: SharedCollectionBookmarkRow): string {
  const name = row.collectionNameSnapshot?.trim() ?? ''
  const snap = row.collectionDescriptionSnapshot?.trim() ?? ''
  const fallback = collectionOfWorkoutsSubtitle(row.collectionWorkoutCountSnapshot)

  if (name && snap && snap !== name) return snap
  if (!snap) return fallback
  // Description exists but is already used as the title (no name, or same as name): show count line instead.
  return fallback
}

function workoutRowId(w: Workout): string {
  return w.workoutId?.trim() || w.id
}

function WorkoutBookmarkDetailPanel({
  workout,
  hideHeader,
}: {
  workout: Workout
  hideHeader?: boolean
}) {
  const name = getWorkoutDisplayName(workout) || workout.workoutId
  const workoutDetails =
    workout.type === 'SingleSegmentWorkout'
      ? (((workout as unknown as { workoutDetails?: string | null }).workoutDetails ?? '') as string)
      : ''
  const scheduleSection =
    workout.type === 'SingleSegmentWorkout'
      ? parseWorkoutScheduleForDisplay(workout.workoutSchedule)
      : null
  const timerModeLabel =
    scheduleSection?.rows.find((r) => r.label === 'Timer mode')?.value?.trim() || ''

  const formBody = (
    <form className="space-y-4">
      {workout.type === 'SingleSegmentWorkout' && (
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Workout details (optional)</label>
          <textarea
            rows={3}
            value={workoutDetails}
            disabled
            readOnly
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-gray-50"
          />
        </div>
      )}
    </form>
  )

  if (hideHeader) {
    return formBody
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="relative flex shrink-0 items-start justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">{name}</p>
          <p className="text-xs text-gray-500 mt-1">
            {(timerModeLabel || getWorkoutDetailDescription(workout) || '—').trim()}
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{formBody}</div>
    </div>
  )
}

function BookmarksCollectionDetail({
  detailCollection,
  bookmarkRow,
  collectionWorkoutId,
  onSelectWorkout,
  hideHeader,
}: {
  detailCollection: SharedContentCollectionResponse
  bookmarkRow: SharedCollectionBookmarkRow
  collectionWorkoutId: string | null
  onSelectWorkout: (workoutId: string | null) => void
  hideHeader?: boolean
}) {
  const collectionTitleRaw = getCollectionDisplayName(detailCollection.data).trim()
  const collectionTitle =
    collectionTitleRaw && collectionTitleRaw !== '<empty>'
      ? collectionTitleRaw
      : titleFromCollectionBookmark(bookmarkRow)

  const collectionDesc = getCollectionDisplayDescription({
    workoutCollectionDescription: detailCollection.data.workoutCollectionDescription,
    workoutIds: detailCollection.data.workoutIds,
  }).trim()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {!hideHeader ? (
        <div className="relative flex shrink-0 items-start justify-between gap-2 border-b border-gray-100 px-4 pb-3 pt-4">
          <div>
            <p className="text-sm font-medium text-gray-900">{collectionTitle}</p>
            <p className="text-xs text-gray-500">{collectionDesc || '—'}</p>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3">
        {detailCollection.workouts.length === 0 ? (
          <p className="text-sm text-gray-500">This collection has no workouts yet.</p>
        ) : (
          <ul>
            {detailCollection.workouts.map((w, index) => {
              const id = workoutRowId(w)
              const barColor = getWorkoutBarColor(w)
              const expanded = collectionWorkoutId === id
              return (
                <li
                  key={id}
                  className={`bg-white ${index > 0 ? 'border-t border-gray-200' : ''}`}
                >
                  <div
                    className={`flex items-center gap-3 pl-3 pr-3 py-2 hover:bg-gymnext-background/50 ${expanded ? 'bg-gymnext-background/40' : ''}`}
                  >
                    <span
                      className="w-1 shrink-0 self-stretch min-h-[3rem] rounded-full"
                      style={{ backgroundColor: barColor }}
                      aria-hidden
                    />
                    <span className="w-6 shrink-0" aria-hidden />
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => onSelectWorkout(expanded ? null : id)}
                      className="min-w-0 flex-1 cursor-pointer py-0.5 text-left"
                    >
                      <div className="text-sm font-medium text-gray-900">
                        {getWorkoutDisplayName(w).trim() || 'Workout'}
                      </div>
                      <div className="text-sm text-gray-600 mt-0.5">{getWorkoutDetailDescription(w) || '—'}</div>
                    </button>
                  </div>
                  {expanded ? (
                    <div className="border-t border-gray-200 bg-gymnext-background/30 py-3 pr-4 pl-16">
                      <WorkoutBookmarkDetailPanel workout={w} hideHeader />
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
        {detailCollection.workoutsTruncated ? (
          <p className="mt-3 rounded border border-amber-100 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
            This collection lists more workouts than we can show here; only the first portion is included.
          </p>
        ) : null}
      </div>
    </div>
  )
}

const WORKOUT_PREVIEW_FETCH_BATCH = 6

export function LibraryBookmarksSection({ user }: { user: User }) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [data, setData] = useState<BookmarksResponse>({ collections: [], workouts: [] })
  /** Shared workout payloads for left-list workout rows (stripe color + generated descriptions). */
  const [workoutLeftPreviewByKey, setWorkoutLeftPreviewByKey] = useState<Record<string, Workout>>({})

  const [selected, setSelected] = useState<SelectedTarget | null>(null)
  const [missingKeys, setMissingKeys] = useState<Set<string>>(() => new Set())
  /** Left-list workout previews: 404/403 from shared-content (deleted or no longer shared). */
  const [deadFromPreview, setDeadFromPreview] = useState<Set<string>>(() => new Set())
  const [removingKey, setRemovingKey] = useState<string | null>(null)

  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailWorkout, setDetailWorkout] = useState<Workout | null>(null)
  const [detailCollection, setDetailCollection] = useState<SharedContentCollectionResponse | null>(null)
  /** When a collection bookmark is selected: `null` = no row expanded; otherwise id of workout expanded inline. */
  const [collectionWorkoutId, setCollectionWorkoutId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    ;(async () => {
      try {
        const token = await user.getIdToken()
        const res = await fetch('/api/app/bookmarks', {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` },
        })
        const json = (await res.json()) as { error?: string } & Partial<BookmarksResponse>
        if (!res.ok) throw new Error(json.error || 'Failed to load bookmarks')
        const next: BookmarksResponse = {
          collections: Array.isArray(json.collections) ? (json.collections as SharedCollectionBookmarkRow[]) : [],
          workouts: Array.isArray(json.workouts) ? (json.workouts as SharedWorkoutBookmarkRow[]) : [],
        }
        if (cancelled) return
        setData(next)
        // Keep/repair selection
        if (!selected) {
          const first = next.collections[0]
            ? ({ kind: 'collection', row: next.collections[0] } as const)
            : next.workouts[0]
              ? ({ kind: 'workout', row: next.workouts[0] } as const)
              : null
          setSelected(first)
        } else {
          const key = stableKeyFor(selected)
          const stillExists =
            next.collections.some(
              (c) =>
                key ===
                stableKeyFor({ kind: 'collection', row: c } as SelectedTarget),
            ) ||
            next.workouts.some(
              (w) =>
                key ===
                stableKeyFor({ kind: 'workout', row: w } as SelectedTarget),
            )
          if (!stillExists) {
            setSelected(
              next.collections[0]
                ? ({ kind: 'collection', row: next.collections[0] } as const)
                : next.workouts[0]
                  ? ({ kind: 'workout', row: next.workouts[0] } as const)
                  : null,
            )
          }
        }
      } catch (e) {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : 'Failed to load bookmarks')
        setData({ collections: [], workouts: [] })
        setSelected(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => {
    let cancelled = false
    const rows = data.workouts.filter((r) => !r.isUnavailable)
    if (rows.length === 0) {
      setWorkoutLeftPreviewByKey({})
      return
    }
    setWorkoutLeftPreviewByKey({})
    setDeadFromPreview(new Set())
    ;(async () => {
      const token = await user.getIdToken()
      const merged: Record<string, Workout> = {}
      const dead = new Set<string>()
      for (let i = 0; i < rows.length; i += WORKOUT_PREVIEW_FETCH_BATCH) {
        if (cancelled) return
        const chunk = rows.slice(i, i + WORKOUT_PREVIEW_FETCH_BATCH)
        await Promise.all(
          chunk.map(async (row) => {
            const key = stableKeyFor({ kind: 'workout', row })
            try {
              const res = await fetch(
                `/api/app/shared-content/${encodeURIComponent(row.ownerUserId)}/workout/${encodeURIComponent(row.remoteWorkoutId)}`,
                { method: 'GET', headers: { authorization: `Bearer ${token}` } },
              )
              if (!res.ok) {
                if (res.status === 404 || res.status === 403) dead.add(key)
                return
              }
              const json = (await res.json().catch(() => ({}))) as SharedContentWorkoutResponse
              if (json.kind === 'workout' && json.data) merged[key] = json.data
            } catch {
              // network etc.: leave row neutral (not marked dead)
            }
          }),
        )
      }
      if (!cancelled) {
        setWorkoutLeftPreviewByKey(merged)
        setDeadFromPreview(dead)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [data.workouts, user])

  useEffect(() => {
    setCollectionWorkoutId(null)
  }, [selected])

  const leftCollections = useMemo(() => data.collections, [data.collections])
  const leftWorkouts = useMemo(() => data.workouts, [data.workouts])

  function bookmarkRowDead(key: string, kind: 'collection' | 'workout', row: SharedCollectionBookmarkRow | SharedWorkoutBookmarkRow): boolean {
    if (row.isUnavailable) return true
    if (missingKeys.has(key)) return true
    if (kind === 'workout' && deadFromPreview.has(key)) return true
    return false
  }

  async function removeBookmarkRow(target: SelectedTarget) {
    const key = stableKeyFor(target)
    setRemovingKey(key)
    try {
      const token = await user.getIdToken()
      if (target.kind === 'workout') {
        const res = await fetch('/api/app/bookmarks/workouts', {
          method: 'DELETE',
          headers: {
            authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ownerUserId: target.row.ownerUserId,
            remoteWorkoutId: target.row.remoteWorkoutId,
          }),
        })
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(j.error || 'Could not remove bookmark')
        }
      } else {
        const res = await fetch('/api/app/bookmarks/collections', {
          method: 'DELETE',
          headers: {
            authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ownerUserId: target.row.ownerUserId,
            remoteCollectionId: target.row.remoteCollectionId,
          }),
        })
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(j.error || 'Could not remove bookmark')
        }
      }

      const nextCollections =
        target.kind === 'collection'
          ? data.collections.filter((c) => stableKeyFor({ kind: 'collection', row: c }) !== key)
          : data.collections
      const nextWorkouts =
        target.kind === 'workout'
          ? data.workouts.filter((w) => stableKeyFor({ kind: 'workout', row: w }) !== key)
          : data.workouts
      setData({ collections: nextCollections, workouts: nextWorkouts })
      setMissingKeys((prev) => {
        const n = new Set(prev)
        n.delete(key)
        return n
      })
      setDeadFromPreview((prev) => {
        const n = new Set(prev)
        n.delete(key)
        return n
      })
      if (target.kind === 'workout') {
        setWorkoutLeftPreviewByKey((prev) => {
          const { [key]: _, ...rest } = prev
          return rest
        })
      }

      if (selected && stableKeyFor(selected) === key) {
        const first =
          nextCollections[0] != null
            ? ({ kind: 'collection' as const, row: nextCollections[0]! })
            : nextWorkouts[0] != null
              ? ({ kind: 'workout' as const, row: nextWorkouts[0]! })
              : null
        setSelected(first)
        setDetailError(null)
        setDetailWorkout(null)
        setDetailCollection(null)
      }

      toast.success('Bookmark removed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove bookmark')
    } finally {
      setRemovingKey(null)
    }
  }

  useEffect(() => {
    let cancelled = false
    setDetailError(null)
    setDetailWorkout(null)
    setDetailCollection(null)
    if (!selected) return

    setDetailLoading(true)
    ;(async () => {
      try {
        const token = await user.getIdToken()
        const ownerUserId = selected.row.ownerUserId
        const resourceId =
          selected.kind === 'collection' ? selected.row.remoteCollectionId : selected.row.remoteWorkoutId
        const res = await fetch(
          `/api/app/shared-content/${ownerUserId}/${selected.kind}/${resourceId}`,
          {
            method: 'GET',
            headers: { authorization: `Bearer ${token}` },
          },
        )
        if (cancelled) return
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string }
          const msg = j.error || (res.status === 404 ? 'Missing or inaccessible' : 'Failed to load')
          setDetailError(msg)
          setMissingKeys((prev) => new Set(prev).add(stableKeyFor(selected)))
          return
        }
        const json = (await res.json()) as SharedContentCollectionResponse | SharedContentWorkoutResponse
        if (cancelled) return
        if (json.kind === 'collection') {
          setDetailCollection(json)
          return
        }
        setDetailWorkout(json.data)
      } catch (e) {
        if (cancelled) return
        setDetailError(e instanceof Error ? e.message : 'Failed to load')
        setMissingKeys((prev) => (selected ? new Set(prev).add(stableKeyFor(selected)) : prev))
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selected, user])

  const empty = !loading && leftCollections.length === 0 && leftWorkouts.length === 0

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="grid min-h-[28rem] w-full flex-1 gap-6 lg:min-h-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.8fr)] lg:grid-rows-[minmax(0,1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gymnext-muted/30 bg-gymnext-background px-4 py-3">
            <h3 className="text-sm font-medium text-gray-800">Bookmarks</h3>
            <div className="flex shrink-0 items-center gap-2" />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && <div className="px-4 py-6 text-sm text-gray-600">Loading…</div>}
            {loadError && <div className="px-4 py-6 text-sm text-red-700">{loadError}</div>}
            {empty && <div className="px-4 py-6 text-sm text-gray-500">No bookmarks yet.</div>}

            {!loading && !loadError && !empty && (
              <div className="flex flex-col">
                <div className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Collections
                </div>
                <ul className="divide-y divide-gray-200">
                  {leftCollections.map((row) => {
                    const key = stableKeyFor({ kind: 'collection', row })
                    const isSelected =
                      selected?.kind === 'collection' &&
                      selected.row.ownerUserId === row.ownerUserId &&
                      selected.row.remoteCollectionId === row.remoteCollectionId
                    const isDead = bookmarkRowDead(key, 'collection', row)
                    return (
                      <li key={key} className={isDead ? 'bg-gray-50/90' : ''}>
                        <div className="flex min-w-0 items-stretch">
                          <button
                            type="button"
                            onClick={() => setSelected({ kind: 'collection', row })}
                            className={[
                              'flex min-w-0 flex-1 items-center gap-3 py-3 pl-3 pr-2 text-left',
                              isSelected ? 'bg-amber-50/40' : 'hover:bg-gray-100',
                            ].join(' ')}
                          >
                            <span
                              className="w-1 shrink-0 self-stretch min-h-[3rem] rounded-full"
                              style={{ backgroundColor: isDead ? '#9ca3af' : '#b45309' }}
                              aria-hidden
                            />
                            <span className="w-6 shrink-0" aria-hidden />
                            {isSelected && (
                              <span className="shrink-0 text-amber-800" aria-label="Selected collection">
                                ✓
                              </span>
                            )}
                            <CollectionFolderIcon
                              className={isSelected ? 'text-amber-800' : isDead ? 'text-gray-400' : 'text-amber-700/80'}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <p
                                  className={`truncate text-sm font-medium ${
                                    isDead ? 'text-gray-500 line-through decoration-gray-400' : 'text-gray-900'
                                  }`}
                                >
                                  {titleFromCollectionBookmark(row)}
                                </p>
                                {isDead && (
                                  <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                                    Unavailable
                                  </span>
                                )}
                              </div>
                              <p className={`truncate text-xs ${isDead ? 'text-gray-400' : 'text-gray-500'}`}>
                                {descriptionFromCollectionBookmark(row)}
                              </p>
                            </div>
                          </button>
                          {isDead ? (
                            <button
                              type="button"
                              aria-label="Remove bookmark"
                              disabled={removingKey === key}
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                void removeBookmarkRow({ kind: 'collection', row })
                              }}
                              className="flex shrink-0 items-center justify-center border-l border-gray-200 px-3 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                  {leftCollections.length === 0 && (
                    <li className="px-4 py-6 text-sm text-gray-500">No collection bookmarks.</li>
                  )}
                </ul>

                <div className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Workouts
                </div>
                <ul className="divide-y divide-gray-200">
                  {leftWorkouts.map((row) => {
                    const key = stableKeyFor({ kind: 'workout', row })
                    const preview = workoutLeftPreviewByKey[key]
                    const isSelected =
                      selected?.kind === 'workout' &&
                      selected.row.ownerUserId === row.ownerUserId &&
                      selected.row.remoteWorkoutId === row.remoteWorkoutId
                    const isDead = bookmarkRowDead(key, 'workout', row)
                    const barColor = isDead
                      ? '#9ca3af'
                      : preview
                        ? getWorkoutBarColor(preview)
                        : BOOKMARK_LIST_WORKOUT_BAR_COLOR
                    const listTitle = preview
                      ? getWorkoutDisplayName(preview).trim() || titleFromWorkoutBookmark(row)
                      : titleFromWorkoutBookmark(row)
                    const listSubtitle = (() => {
                      const fromLive = preview ? getWorkoutDetailDescription(preview)?.trim() : ''
                      const snap = row.workoutDescriptionSnapshot?.trim() ?? ''
                      if (fromLive) return fromLive
                      if (snap) return snap
                      return '—'
                    })()
                    return (
                      <li key={key} className={isDead ? 'bg-gray-50/90' : ''}>
                        <div className="flex min-w-0 items-stretch">
                          <button
                            type="button"
                            onClick={() => setSelected({ kind: 'workout', row })}
                            className={[
                              'flex min-w-0 flex-1 items-center gap-3 py-3 pl-3 pr-2 text-left',
                              isSelected ? 'bg-violet-50/40' : 'hover:bg-gray-100',
                            ].join(' ')}
                          >
                            <span
                              className="w-1 shrink-0 self-stretch min-h-[3rem] rounded-full"
                              style={{ backgroundColor: barColor }}
                              aria-hidden
                            />
                            <span className="w-6 shrink-0" aria-hidden />
                            {isSelected && (
                              <span className="shrink-0 text-[#6B21A8]" aria-label="Selected workout">
                                ✓
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <p
                                  className={`truncate text-sm font-medium ${
                                    isDead ? 'text-gray-500 line-through decoration-gray-400' : 'text-gray-900'
                                  }`}
                                >
                                  {listTitle}
                                </p>
                                {isDead && (
                                  <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                                    Unavailable
                                  </span>
                                )}
                              </div>
                              <p className={`truncate text-xs ${isDead ? 'text-gray-400' : 'text-gray-500'}`}>
                                {listSubtitle}
                              </p>
                            </div>
                          </button>
                          {isDead ? (
                            <button
                              type="button"
                              aria-label="Remove bookmark"
                              disabled={removingKey === key}
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                void removeBookmarkRow({ kind: 'workout', row })
                              }}
                              className="flex shrink-0 items-center justify-center border-l border-gray-200 px-3 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                  {leftWorkouts.length === 0 && (
                    <li className="px-4 py-6 text-sm text-gray-500">No workout bookmarks.</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white">
          {!selected && (
            <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6 text-center text-sm text-gray-500">
              Select a bookmark to see its details.
            </div>
          )}

          {selected && (
            <>
              <div className="flex shrink-0 items-start justify-between gap-2 border-b border-gray-200 bg-white px-4 py-2.5">
                <div className="min-w-0 flex-1 pr-2">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {bookmarkDetailHeaderTitle(selected, detailWorkout, detailCollection)}
                  </p>
                  {(() => {
                    const sub = bookmarkDetailHeaderSubtitle(selected, detailWorkout, detailCollection)
                    return sub ? <p className="mt-0.5 truncate text-xs text-gray-500">{sub}</p> : null
                  })()}
                </div>
                <BookmarkDetailOverflowMenu
                  disabled={removingKey === stableKeyFor(selected)}
                  onConfirmRemove={() => void removeBookmarkRow(selected)}
                />
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {detailLoading && (
                  <p className="shrink-0 px-4 py-6 text-sm text-gray-500">Loading…</p>
                )}

                {!detailLoading && detailError && (
                  <div className="shrink-0 border-b border-amber-100 bg-amber-50/90 px-4 py-3 text-xs text-amber-950">
                    <div className="text-sm font-semibold text-amber-950">Link unavailable</div>
                    <div className="mt-1 text-amber-900/90">{detailError}</div>
                    <div className="mt-2 text-amber-900/85">
                      The shared workout or collection may have been removed or is no longer shared with you.
                    </div>
                    <button
                      type="button"
                      className="mt-2 rounded border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={removingKey === stableKeyFor(selected)}
                      onClick={() => void removeBookmarkRow(selected)}
                    >
                      Remove bookmark
                    </button>
                  </div>
                )}

                {!detailLoading && !detailError && selected.kind === 'workout' && detailWorkout && (
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    <WorkoutBookmarkDetailPanel workout={detailWorkout} hideHeader />
                  </div>
                )}

                {!detailLoading && !detailError && selected.kind === 'collection' && detailCollection && (
                  <BookmarksCollectionDetail
                    detailCollection={detailCollection}
                    bookmarkRow={selected.row}
                    collectionWorkoutId={collectionWorkoutId}
                    onSelectWorkout={setCollectionWorkoutId}
                    hideHeader
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

