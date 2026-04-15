'use client'

import { useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'

type SharedWorkoutBookmarkRow = {
  subscriptionDocumentId: string
  ownerUserId: string
  remoteWorkoutId: string
  mirrorGroupId: string | null
  workoutNameSnapshot: string | null
  workoutDescriptionSnapshot: string | null
  isUnavailable: boolean
  updatedAt: string | null
}

type SharedCollectionBookmarkRow = {
  subscriptionDocumentId: string
  ownerUserId: string
  remoteCollectionId: string
  mirrorGroupId: string | null
  collectionNameSnapshot: string | null
  collectionDescriptionSnapshot: string | null
  isUnavailable: boolean
  updatedAt: string | null
}

type BookmarksResponse = {
  collections: SharedCollectionBookmarkRow[]
  workouts: SharedWorkoutBookmarkRow[]
}

type SelectedTarget =
  | { kind: 'collection'; row: SharedCollectionBookmarkRow }
  | { kind: 'workout'; row: SharedWorkoutBookmarkRow }

type SharedContentWorkout = {
  workoutId: string
  workoutName: string | null
  workoutDescription: string | null
  workoutDetails?: string | null
  workoutImage?: string | null
  workoutShareId?: string | null
  deletedAt?: string | null
  segments?: Array<{ workoutName: string | null; workoutDescription: string | null; workoutDetails?: string | null }>
}

type SharedContentCollection = {
  id: string
  name: string | null
  description: string | null
  workoutIds: string[]
  deletedAt?: string | null
}

type SharedContentCollectionResponse = {
  kind: 'collection'
  data: SharedContentCollection
  workouts: SharedContentWorkout[]
  workoutsTruncated: boolean
}

type SharedContentWorkoutResponse = {
  kind: 'workout'
  data: SharedContentWorkout
}

function stableKeyFor(row: SelectedTarget): string {
  if (row.kind === 'collection') {
    return `collection\u001e${row.row.ownerUserId}\u001e${row.row.remoteCollectionId}\u001e${row.row.mirrorGroupId ?? ''}`
  }
  return `workout\u001e${row.row.ownerUserId}\u001e${row.row.remoteWorkoutId}\u001e${row.row.mirrorGroupId ?? ''}`
}

function titleFromWorkoutData(w: SharedContentWorkout): string {
  const direct = (w.workoutName ?? '').trim()
  if (direct) return direct
  const fallback = (w.workoutDescription ?? '').trim()
  if (fallback) return fallback
  const seg = w.segments?.find((s) => (s.workoutName ?? '').trim() || (s.workoutDescription ?? '').trim())
  return (seg?.workoutName ?? seg?.workoutDescription ?? 'Workout').trim() || 'Workout'
}

function titleFromWorkoutBookmark(row: SharedWorkoutBookmarkRow): string {
  return row.workoutNameSnapshot?.trim() || row.workoutDescriptionSnapshot?.trim() || 'Workout'
}

function titleFromCollectionBookmark(row: SharedCollectionBookmarkRow): string {
  return row.collectionNameSnapshot?.trim() || row.collectionDescriptionSnapshot?.trim() || 'Collection'
}

export function LibraryBookmarksSection({ user }: { user: User }) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [data, setData] = useState<BookmarksResponse>({ collections: [], workouts: [] })

  const [selected, setSelected] = useState<SelectedTarget | null>(null)
  const [missingKeys, setMissingKeys] = useState<Set<string>>(() => new Set())

  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailWorkout, setDetailWorkout] = useState<SharedContentWorkout | null>(null)
  const [detailCollection, setDetailCollection] = useState<SharedContentCollectionResponse | null>(null)

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

  const leftCollections = useMemo(() => data.collections, [data.collections])
  const leftWorkouts = useMemo(() => data.workouts, [data.workouts])

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
        const groupId = selected.row.mirrorGroupId
        const resourceId =
          selected.kind === 'collection' ? selected.row.remoteCollectionId : selected.row.remoteWorkoutId
        const qs = groupId ? `?groupId=${encodeURIComponent(groupId)}` : ''
        const res = await fetch(`/api/app/shared-content/${ownerUserId}/${selected.kind}/${resourceId}${qs}`, {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` },
        })
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
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white shadow-sm">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gymnext-muted/30 bg-gymnext-background px-4 py-3">
            <h3 className="text-sm font-medium text-gray-800">Bookmarks</h3>
            <div className="flex shrink-0 items-center gap-2" />
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
            {loading && <div className="px-2 py-3 text-sm text-gray-600">Loading…</div>}
            {loadError && <div className="px-2 py-3 text-sm text-red-700">{loadError}</div>}
            {empty && <div className="px-2 py-3 text-sm text-gray-600">No bookmarks yet.</div>}

            {!loading && !loadError && !empty && (
              <div className="flex flex-col gap-4">
                <div>
                  <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Collections
                  </div>
                  <ul className="flex flex-col">
                    {leftCollections.map((row) => {
                      const key = stableKeyFor({ kind: 'collection', row })
                      const isSelected =
                        selected?.kind === 'collection' &&
                        selected.row.ownerUserId === row.ownerUserId &&
                        selected.row.remoteCollectionId === row.remoteCollectionId &&
                        (selected.row.mirrorGroupId ?? '') === (row.mirrorGroupId ?? '')
                      const isMissing = row.isUnavailable || missingKeys.has(key)
                      return (
                        <li key={key}>
                          <button
                            type="button"
                            onClick={() => setSelected({ kind: 'collection', row })}
                            className={[
                              'group flex w-full items-start gap-2 rounded-md px-2 py-2 text-left',
                              isSelected ? 'bg-gymnext-background/40' : 'hover:bg-gymnext-background/25',
                            ].join(' ')}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <div className="truncate text-sm font-medium text-gray-900">
                                  {titleFromCollectionBookmark(row)}
                                </div>
                                {isMissing && (
                                  <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                                    Missing
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 truncate text-xs text-gray-600">
                                {row.collectionDescriptionSnapshot?.trim() || '—'}
                              </div>
                            </div>
                          </button>
                        </li>
                      )
                    })}
                    {leftCollections.length === 0 && (
                      <li className="px-2 py-2 text-sm text-gray-600">No collection bookmarks.</li>
                    )}
                  </ul>
                </div>

                <div>
                  <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Workouts
                  </div>
                  <ul className="flex flex-col">
                    {leftWorkouts.map((row) => {
                      const key = stableKeyFor({ kind: 'workout', row })
                      const isSelected =
                        selected?.kind === 'workout' &&
                        selected.row.ownerUserId === row.ownerUserId &&
                        selected.row.remoteWorkoutId === row.remoteWorkoutId &&
                        (selected.row.mirrorGroupId ?? '') === (row.mirrorGroupId ?? '')
                      const isMissing = row.isUnavailable || missingKeys.has(key)
                      return (
                        <li key={key}>
                          <button
                            type="button"
                            onClick={() => setSelected({ kind: 'workout', row })}
                            className={[
                              'group flex w-full items-start gap-2 rounded-md px-2 py-2 text-left',
                              isSelected ? 'bg-gymnext-background/40' : 'hover:bg-gymnext-background/25',
                            ].join(' ')}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <div className="truncate text-sm font-medium text-gray-900">
                                  {titleFromWorkoutBookmark(row)}
                                </div>
                                {isMissing && (
                                  <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                                    Missing
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 truncate text-xs text-gray-600">
                                {row.workoutDescriptionSnapshot?.trim() || '—'}
                              </div>
                            </div>
                          </button>
                        </li>
                      )
                    })}
                    {leftWorkouts.length === 0 && (
                      <li className="px-2 py-2 text-sm text-gray-600">No workout bookmarks.</li>
                    )}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white shadow-sm">
          <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-4">
            {!selected && (
              <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6 text-center text-sm text-gray-500">
                Select a bookmark to see its details.
              </div>
            )}

            {selected && detailLoading && <div className="text-sm text-gray-600">Loading…</div>}

            {selected && !detailLoading && detailError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3">
                <div className="text-sm font-semibold text-red-800">Missing or inaccessible</div>
                <div className="mt-1 text-sm text-red-700">{detailError}</div>
                <div className="mt-2 text-xs text-red-700/90">
                  This bookmark stays in your list, but the underlying content can’t be loaded right now.
                </div>
              </div>
            )}

            {selected && !detailLoading && !detailError && selected.kind === 'workout' && detailWorkout && (
              <div className="flex flex-col gap-3">
                <div>
                  <div className="text-base font-semibold text-gray-900">{titleFromWorkoutData(detailWorkout)}</div>
                  <div className="mt-1 text-sm text-gray-700">
                    {(detailWorkout.workoutDescription ?? '').trim() || '—'}
                  </div>
                </div>
                <div className="rounded-md border border-gymnext-muted/20 bg-gymnext-background/10 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">Read-only</div>
                  <div className="mt-1 text-sm text-gray-700">This shared workout is available for viewing only.</div>
                </div>
              </div>
            )}

            {selected &&
              !detailLoading &&
              !detailError &&
              selected.kind === 'collection' &&
              detailCollection && (
                <div className="flex flex-col gap-4">
                  <div>
                    <div className="text-base font-semibold text-gray-900">
                      {(detailCollection.data.name ?? '').trim() || titleFromCollectionBookmark(selected.row)}
                    </div>
                    <div className="mt-1 text-sm text-gray-700">
                      {(detailCollection.data.description ?? '').trim() || '—'}
                    </div>
                  </div>

                  <div className="rounded-md border border-gymnext-muted/20 bg-gymnext-background/10 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">Workouts</div>
                    <div className="mt-1 text-sm text-gray-700">
                      Showing {detailCollection.workouts.length} workout
                      {detailCollection.workouts.length === 1 ? '' : 's'}
                      {detailCollection.workoutsTruncated ? ' (truncated)' : ''}.
                    </div>
                    <ul className="mt-2 list-disc pl-5 text-sm text-gray-700">
                      {detailCollection.workouts.map((w) => (
                        <li key={w.workoutId} className="truncate">
                          {titleFromWorkoutData(w)}
                        </li>
                      ))}
                      {detailCollection.workouts.length === 0 && <li>—</li>}
                    </ul>
                  </div>

                  <div className="rounded-md border border-gymnext-muted/20 bg-gymnext-background/10 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">Read-only</div>
                    <div className="mt-1 text-sm text-gray-700">
                      This shared collection is available for viewing only.
                    </div>
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  )
}

