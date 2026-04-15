'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import toast from 'react-hot-toast'

const PERMANENT_DELETE_CONFIRMATION = 'DELETE'

type DeletedPlanRow = { id: string; workoutPlanName: string; deletedAt: string | null }
type DeletedCollectionRow = { id: string; workoutCollectionName: string; deletedAt: string | null }
type DeletedWorkoutRow = {
  id: string
  workoutName: string | null
  /** From API: same rules as `getWorkoutDisplayName` (favorites list). */
  displayName?: string
  deletedAt: string | null
}
/** Active workout not listed on any non-deleted collection (e.g. removed from all collections). */
type OrphanedWorkoutRow = {
  id: string
  workoutName: string | null
  displayName?: string
}
type DeletedGroupRow = { id: string; name: string; groupType: string | null; deletedAt: string | null }
type ActiveCollectionRow = { id: string; workoutCollectionName: string }

type DeletedItemsPayload = {
  workoutPlans: DeletedPlanRow[]
  workoutCollections: DeletedCollectionRow[]
  groups: DeletedGroupRow[]
  workouts: DeletedWorkoutRow[]
  orphanedWorkouts?: OrphanedWorkoutRow[]
  activeCollections: ActiveCollectionRow[]
}

type PermanentDeleteIntent =
  | { type: 'plan'; row: DeletedPlanRow }
  | { type: 'plans-all' }
  | { type: 'collection'; row: DeletedCollectionRow }
  | { type: 'collections-all' }
  | { type: 'group'; row: DeletedGroupRow }
  | { type: 'groups-all' }
  | { type: 'workout'; row: DeletedWorkoutRow }
  | { type: 'workouts-all' }
  | { type: 'orphanWorkout'; row: OrphanedWorkoutRow }
  | { type: 'orphanWorkouts-all' }

type RestoreConfirmIntent =
  | { type: 'plan'; row: DeletedPlanRow }
  | { type: 'collection'; row: DeletedCollectionRow }
  | { type: 'group'; row: DeletedGroupRow }

/** Label for deleted / orphaned workouts: prefer server `displayName`, else stored name, else id. */
function deletedWorkoutDisplayLabel(row: Pick<DeletedWorkoutRow, 'id' | 'workoutName' | 'displayName'>): string {
  const fromApi = row.displayName?.trim()
  if (fromApi) return fromApi
  return (row.workoutName && row.workoutName.trim()) || row.id
}

function formatDeletedAt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function groupTypeLabel(t: string | null | undefined): string | null {
  if (!t) return null
  return t.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  return body.error || `HTTP ${res.status}`
}

function describePermanentDelete(
  intent: PermanentDeleteIntent,
  lists: {
    plans: DeletedPlanRow[]
    collections: DeletedCollectionRow[]
    groups: DeletedGroupRow[]
    workouts: DeletedWorkoutRow[]
    orphans: OrphanedWorkoutRow[]
  }
): { title: string; description: string } {
  switch (intent.type) {
    case 'plan': {
      const name = intent.row.workoutPlanName || intent.row.id
      return {
        title: 'Delete plan permanently',
        description: `Plan “${name}” and all of its plan days will be removed. This cannot be undone.`,
      }
    }
    case 'plans-all': {
      const n = lists.plans.filter((p) => p.id !== 'personal').length
      return {
        title: 'Delete all plans permanently',
        description: `You are about to permanently delete ${n} deleted plan(s). Your personal plan is never removed this way. This cannot be undone.`,
      }
    }
    case 'collection': {
      const name = intent.row.workoutCollectionName || intent.row.id
      return {
        title: 'Delete collection permanently',
        description: `Collection “${name}” will be removed. This cannot be undone.`,
      }
    }
    case 'collections-all':
      return {
        title: 'Delete all collections permanently',
        description: `You are about to permanently delete ${lists.collections.length} deleted collection(s). This cannot be undone.`,
      }
    case 'group': {
      const name = intent.row.name || intent.row.id
      return {
        title: 'Delete hub permanently',
        description: `Hub “${name}” and its hub data (members, invites, shared library feed, etc.) will be removed. This cannot be undone.`,
      }
    }
    case 'groups-all':
      return {
        title: 'Delete all hubs permanently',
        description: `You are about to permanently delete ${lists.groups.length} deleted hub(s) and their hub data. This cannot be undone.`,
      }
    case 'workout': {
      const name = deletedWorkoutDisplayLabel(intent.row)
      return {
        title: 'Delete workout permanently',
        description: `Workout “${name}” will be removed. This cannot be undone.`,
      }
    }
    case 'workouts-all':
      return {
        title: 'Delete all workouts permanently',
        description: `You are about to permanently delete ${lists.workouts.length} deleted workout(s). This cannot be undone.`,
      }
    case 'orphanWorkout': {
      const name = deletedWorkoutDisplayLabel(intent.row)
      return {
        title: 'Delete orphaned workout permanently',
        description: `Workout “${name}” is not soft-deleted; it will be removed from your library entirely. This cannot be undone.`,
      }
    }
    case 'orphanWorkouts-all':
      return {
        title: 'Delete all orphaned workouts permanently',
        description: `You are about to permanently delete ${lists.orphans.length} workout(s) that are not in any collection. This cannot be undone.`,
      }
  }
}

function describeRestore(intent: RestoreConfirmIntent): { title: string; description: string } {
  switch (intent.type) {
    case 'plan': {
      const name = intent.row.workoutPlanName || intent.row.id
      return {
        title: 'Restore plan',
        description: `Restore plan “${name}”? It will appear in your library again.`,
      }
    }
    case 'collection': {
      const name = intent.row.workoutCollectionName || intent.row.id
      return {
        title: 'Restore collection',
        description: `Restore collection “${name}”? It will appear in your library again.`,
      }
    }
    case 'group': {
      const name = intent.row.name || intent.row.id
      return {
        title: 'Restore hub',
        description: `Restore hub “${name}”? It will appear under Hubs again if allowed.`,
      }
    }
  }
}

type RecoverDeletedItemsSectionProps = {
  user: User
  /** Called after restore/delete mutations so Library (overview) refetches workouts, collections, and plans. */
  onLibraryChanged?: () => void | Promise<void>
}

type CollectionPickWorkout =
  | { kind: 'deleted'; row: DeletedWorkoutRow }
  | { kind: 'orphan'; row: OrphanedWorkoutRow }

export function RecoverDeletedItemsSection({ user, onLibraryChanged }: RecoverDeletedItemsSectionProps) {
  const [data, setData] = useState<DeletedItemsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [collectionPickWorkout, setCollectionPickWorkout] = useState<CollectionPickWorkout | null>(null)
  const [restoreCollectionId, setRestoreCollectionId] = useState('')
  const [restoreConfirmDialog, setRestoreConfirmDialog] = useState<RestoreConfirmIntent | null>(null)
  const [permanentDialog, setPermanentDialog] = useState<PermanentDeleteIntent | null>(null)
  const [permanentPhrase, setPermanentPhrase] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/recover-deleted-items', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        throw new Error(await readError(res))
      }
      const json = (await res.json()) as DeletedItemsPayload
      setData({
        ...json,
        groups: Array.isArray(json.groups) ? json.groups : [],
        orphanedWorkouts: Array.isArray(json.orphanedWorkouts) ? json.orphanedWorkouts : [],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [user])

  const reloadDeletedItemsAndLibrary = useCallback(async () => {
    await load()
    if (onLibraryChanged) await onLibraryChanged()
  }, [load, onLibraryChanged])

  useEffect(() => {
    void load()
  }, [load])

  const activeCollections = data?.activeCollections ?? []

  useEffect(() => {
    if (!collectionPickWorkout) {
      setRestoreCollectionId('')
      return
    }
    if (activeCollections.length === 0) {
      setRestoreCollectionId('')
      return
    }
    setRestoreCollectionId((prev) =>
      prev && activeCollections.some((c) => c.id === prev) ? prev : activeCollections[0].id
    )
  }, [collectionPickWorkout, activeCollections])

  const plans = data?.workoutPlans ?? []
  const collections = data?.workoutCollections ?? []
  const groups = data?.groups ?? []
  const workouts = data?.workouts ?? []
  const orphans = data?.orphanedWorkouts ?? []
  const empty =
    !loading &&
    !error &&
    plans.length === 0 &&
    collections.length === 0 &&
    groups.length === 0 &&
    workouts.length === 0 &&
    orphans.length === 0

  const authFetch = useCallback(
    async (input: string, init: RequestInit) => {
      const token = await user.getIdToken()
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${token}`)
      if (init.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json')
      }
      return fetch(input, { ...init, headers })
    },
    [user]
  )

  const executePermanentDeletion = useCallback(
    async (intent: PermanentDeleteIntent): Promise<void> => {
      switch (intent.type) {
        case 'plan': {
          const row = intent.row
          if (row.id === 'personal') {
            toast.error('The personal plan cannot be permanently deleted.')
            return
          }
          const res = await authFetch(`/api/app/plans/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
          if (!res.ok && res.status !== 204) throw new Error(await readError(res))
          toast.success('Plan permanently deleted')
          break
        }
        case 'plans-all': {
          const deletable = plans.filter((p) => p.id !== 'personal')
          if (deletable.length === 0) {
            toast.error('No plans here can be permanently deleted.')
            return
          }
          let failed = 0
          for (const row of deletable) {
            const res = await authFetch(`/api/app/plans/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
            if (!res.ok && res.status !== 204) failed += 1
          }
          if (failed) toast.error(`${failed} plan(s) could not be deleted.`)
          else toast.success('All listed plans permanently deleted')
          break
        }
        case 'collection': {
          const res = await authFetch(`/api/app/collections/${encodeURIComponent(intent.row.id)}`, {
            method: 'DELETE',
          })
          if (!res.ok && res.status !== 204) throw new Error(await readError(res))
          toast.success('Collection permanently deleted')
          break
        }
        case 'collections-all': {
          if (collections.length === 0) return
          let failed = 0
          for (const row of collections) {
            const res = await authFetch(`/api/app/collections/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
            if (!res.ok && res.status !== 204) failed += 1
          }
          if (failed) toast.error(`${failed} collection(s) could not be deleted.`)
          else toast.success('All listed collections permanently deleted')
          break
        }
        case 'group': {
          const res = await authFetch(`/api/app/groups/${encodeURIComponent(intent.row.id)}?permanent=1`, {
            method: 'DELETE',
          })
          if (!res.ok && res.status !== 204) throw new Error(await readError(res))
          toast.success('Hub permanently deleted')
          break
        }
        case 'groups-all': {
          if (groups.length === 0) return
          let failed = 0
          for (const row of groups) {
            const res = await authFetch(`/api/app/groups/${encodeURIComponent(row.id)}?permanent=1`, {
              method: 'DELETE',
            })
            if (!res.ok && res.status !== 204) failed += 1
          }
          if (failed) toast.error(`${failed} hub(s) could not be deleted.`)
          else toast.success('All listed hubs permanently deleted')
          break
        }
        case 'workout': {
          const res = await authFetch(`/api/app/workouts/${encodeURIComponent(intent.row.id)}`, { method: 'DELETE' })
          if (!res.ok && res.status !== 204) throw new Error(await readError(res))
          toast.success('Workout permanently deleted')
          break
        }
        case 'workouts-all': {
          if (workouts.length === 0) return
          let failed = 0
          for (const row of workouts) {
            const res = await authFetch(`/api/app/workouts/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
            if (!res.ok && res.status !== 204) failed += 1
          }
          if (failed) toast.error(`${failed} workout(s) could not be deleted.`)
          else toast.success('All listed workouts permanently deleted')
          break
        }
        case 'orphanWorkout': {
          const res = await authFetch(`/api/app/workouts/${encodeURIComponent(intent.row.id)}`, { method: 'DELETE' })
          if (!res.ok && res.status !== 204) throw new Error(await readError(res))
          toast.success('Orphaned workout permanently deleted')
          break
        }
        case 'orphanWorkouts-all': {
          if (orphans.length === 0) return
          let failed = 0
          for (const row of orphans) {
            const res = await authFetch(`/api/app/workouts/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
            if (!res.ok && res.status !== 204) failed += 1
          }
          if (failed) toast.error(`${failed} orphaned workout(s) could not be deleted.`)
          else toast.success('All listed orphaned workouts permanently deleted')
          break
        }
      }
      await reloadDeletedItemsAndLibrary()
    },
    [authFetch, reloadDeletedItemsAndLibrary, plans, collections, groups, workouts, orphans]
  )

  const openPermanentDialog = useCallback((intent: PermanentDeleteIntent) => {
    setPermanentPhrase('')
    setPermanentDialog(intent)
  }, [])

  const closePermanentDialog = useCallback(() => {
    if (busy) return
    setPermanentDialog(null)
    setPermanentPhrase('')
  }, [busy])

  const confirmPermanentDialog = useCallback(async () => {
    if (!permanentDialog || permanentPhrase.trim() !== PERMANENT_DELETE_CONFIRMATION) return
    setBusy(true)
    try {
      await executePermanentDeletion(permanentDialog)
      setPermanentDialog(null)
      setPermanentPhrase('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }, [busy, executePermanentDeletion, permanentDialog, permanentPhrase])

  const executeRestore = useCallback(
    async (intent: RestoreConfirmIntent): Promise<void> => {
      switch (intent.type) {
        case 'plan': {
          const res = await authFetch(`/api/app/plans/${encodeURIComponent(intent.row.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ recover: true }),
          })
          if (!res.ok) throw new Error(await readError(res))
          toast.success('Plan restored')
          break
        }
        case 'collection': {
          const res = await authFetch(`/api/app/collections/${encodeURIComponent(intent.row.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ recover: true }),
          })
          if (!res.ok) throw new Error(await readError(res))
          toast.success('Collection restored')
          break
        }
        case 'group': {
          const res = await authFetch(`/api/app/groups/${encodeURIComponent(intent.row.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ recover: true }),
          })
          if (!res.ok) throw new Error(await readError(res))
          toast.success('Hub restored')
          break
        }
      }
      await reloadDeletedItemsAndLibrary()
    },
    [authFetch, reloadDeletedItemsAndLibrary]
  )

  const closeRestoreConfirmDialog = useCallback(() => {
    if (busy) return
    setRestoreConfirmDialog(null)
  }, [busy])

  const confirmRestoreConfirmDialog = useCallback(async () => {
    if (!restoreConfirmDialog) return
    setBusy(true)
    try {
      await executeRestore(restoreConfirmDialog)
      setRestoreConfirmDialog(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Restore failed')
    } finally {
      setBusy(false)
    }
  }, [busy, executeRestore, restoreConfirmDialog])

  const confirmCollectionPickWorkout = useCallback(async () => {
    if (!collectionPickWorkout) return
    if (!restoreCollectionId) {
      toast.error('Choose a collection.')
      return
    }
    setBusy(true)
    try {
      const id = collectionPickWorkout.row.id
      const body =
        collectionPickWorkout.kind === 'deleted'
          ? { recover: true, restoreToCollectionId: restoreCollectionId }
          : { addToCollectionId: restoreCollectionId }
      const res = await authFetch(`/api/app/workouts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await readError(res))
      toast.success(collectionPickWorkout.kind === 'deleted' ? 'Workout restored' : 'Workout added to collection')
      setCollectionPickWorkout(null)
      await reloadDeletedItemsAndLibrary()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }, [authFetch, reloadDeletedItemsAndLibrary, restoreCollectionId, collectionPickWorkout])

  const workoutLabel = useCallback(
    (row: Pick<DeletedWorkoutRow, 'id' | 'workoutName' | 'displayName'>) => deletedWorkoutDisplayLabel(row),
    []
  )

  const actionBarClass =
    'mt-2 flex flex-wrap items-center gap-2 sm:mt-0 sm:justify-end shrink-0'

  const sectionToolbar = useMemo(
    () => ({
      plans: plans.length > 0 && plans.some((p) => p.id !== 'personal'),
      collections: collections.length > 0,
      groups: groups.length > 0,
      workouts: workouts.length > 0,
      orphanWorkouts: orphans.length > 0,
    }),
    [plans, collections, groups, workouts, orphans]
  )

  const permanentCopy = permanentDialog
    ? describePermanentDelete(permanentDialog, { plans, collections, groups, workouts, orphans })
    : null
  const canConfirmPermanent = permanentPhrase.trim() === PERMANENT_DELETE_CONFIRMATION
  const restoreConfirmCopy = restoreConfirmDialog ? describeRestore(restoreConfirmDialog) : null

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white shadow-sm">
      <header className="shrink-0 border-b border-gymnext-muted/30 bg-gymnext-background px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Recover Deleted Items</h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {error && (
          <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
            <button
              type="button"
              onClick={() => void load()}
              className="ml-2 font-medium text-red-900 underline"
            >
              Retry
            </button>
          </div>
        )}
        {empty && (
          <p className="text-sm text-gray-600">
            You do not have any deleted plans, collections, hubs, workouts, or orphaned workouts right now.
          </p>
        )}

        {!loading && !error && plans.length > 0 && (
          <section className="mb-12" aria-labelledby="deleted-plans-heading">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 id="deleted-plans-heading" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Plans
              </h3>
              {sectionToolbar.plans && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const deletable = plans.filter((p) => p.id !== 'personal')
                    if (deletable.length === 0) {
                      toast.error('No plans here can be permanently deleted.')
                      return
                    }
                    openPermanentDialog({ type: 'plans-all' })
                  }}
                  className="self-start rounded border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                >
                  Delete all permanently…
                </button>
              )}
            </div>
            <ul className="divide-y divide-gymnext-muted/30 rounded-lg border border-gymnext-muted/30">
              {plans.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-gray-900">{row.workoutPlanName || row.id}</span>
                    <p className="text-xs text-amber-700">Deleted {formatDeletedAt(row.deletedAt)}</p>
                  </div>
                  <div className={actionBarClass}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRestoreConfirmDialog({ type: 'plan', row })}
                      className="rounded bg-gymnext px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      Restore
                    </button>
                    {row.id !== 'personal' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openPermanentDialog({ type: 'plan', row })}
                        className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"
                      >
                        Delete permanently
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && !error && collections.length > 0 && (
          <section className="mb-12" aria-labelledby="deleted-collections-heading">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3
                id="deleted-collections-heading"
                className="text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                Collections
              </h3>
              {sectionToolbar.collections && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openPermanentDialog({ type: 'collections-all' })}
                  className="self-start rounded border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                >
                  Delete all permanently…
                </button>
              )}
            </div>
            <ul className="divide-y divide-gymnext-muted/30 rounded-lg border border-gymnext-muted/30">
              {collections.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-gray-900">{row.workoutCollectionName || row.id}</span>
                    <p className="text-xs text-amber-700">Deleted {formatDeletedAt(row.deletedAt)}</p>
                  </div>
                  <div className={actionBarClass}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRestoreConfirmDialog({ type: 'collection', row })}
                      className="rounded bg-gymnext px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => openPermanentDialog({ type: 'collection', row })}
                      className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete permanently
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && !error && groups.length > 0 && (
          <section className="mb-12" aria-labelledby="deleted-groups-heading">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 id="deleted-groups-heading" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Hubs
              </h3>
              {sectionToolbar.groups && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openPermanentDialog({ type: 'groups-all' })}
                  className="self-start rounded border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                >
                  Delete all permanently…
                </button>
              )}
            </div>
            <ul className="divide-y divide-gymnext-muted/30 rounded-lg border border-gymnext-muted/30">
              {groups.map((row) => {
                const typeLine = groupTypeLabel(row.groupType)
                return (
                  <li
                    key={row.id}
                    className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-gray-900">{row.name || row.id}</span>
                      {typeLine && (
                        <p className="text-xs text-gray-500">{typeLine}</p>
                      )}
                      <p className="text-xs text-amber-700">Deleted {formatDeletedAt(row.deletedAt)}</p>
                    </div>
                    <div className={actionBarClass}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRestoreConfirmDialog({ type: 'group', row })}
                        className="rounded bg-gymnext px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openPermanentDialog({ type: 'group', row })}
                        className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"
                      >
                        Delete permanently
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {!loading && !error && workouts.length > 0 && (
          <section className="mb-12" aria-labelledby="deleted-workouts-heading">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3
                id="deleted-workouts-heading"
                className="text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                Workouts
              </h3>
              {sectionToolbar.workouts && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openPermanentDialog({ type: 'workouts-all' })}
                  className="self-start rounded border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                >
                  Delete all permanently…
                </button>
              )}
            </div>
            <ul className="divide-y divide-gymnext-muted/30 rounded-lg border border-gymnext-muted/30">
              {workouts.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-gray-900">{workoutLabel(row)}</span>
                    <p className="text-xs text-amber-700">Deleted {formatDeletedAt(row.deletedAt)}</p>
                  </div>
                  <div className={actionBarClass}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setCollectionPickWorkout({ kind: 'deleted', row })}
                      className="rounded bg-gymnext px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      Restore…
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => openPermanentDialog({ type: 'workout', row })}
                      className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete permanently
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && !error && orphans.length > 0 && (
          <section className="mb-12" aria-labelledby="orphaned-workouts-heading">
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3
                id="orphaned-workouts-heading"
                className="text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                Orphaned workouts
              </h3>
              {sectionToolbar.orphanWorkouts && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openPermanentDialog({ type: 'orphanWorkouts-all' })}
                  className="self-start rounded border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                >
                  Delete all permanently…
                </button>
              )}
            </div>
            <ul className="divide-y divide-gymnext-muted/30 rounded-lg border border-gymnext-muted/30">
              {orphans.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-gray-900">{workoutLabel(row)}</span>
                    <p className="text-xs text-gray-600">Not in any collection</p>
                  </div>
                  <div className={actionBarClass}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setCollectionPickWorkout({ kind: 'orphan', row })}
                      className="rounded bg-gymnext px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      Add to collection…
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => openPermanentDialog({ type: 'orphanWorkout', row })}
                      className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete permanently
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {restoreConfirmDialog && restoreConfirmCopy && (
        <div
          className="fixed inset-0 z-[58] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restore-confirm-title"
          onClick={() => closeRestoreConfirmDialog()}
        >
          <div
            className="w-full max-w-md rounded-lg border border-gymnext-muted/40 bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 id="restore-confirm-title" className="text-sm font-semibold text-gray-900">
              {restoreConfirmCopy.title}
            </h4>
            <p className="mt-2 text-sm text-gray-700">{restoreConfirmCopy.description}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => closeRestoreConfirmDialog()}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmRestoreConfirmDialog()}
                className="rounded bg-gymnext px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          </div>
        </div>
      )}

      {permanentDialog && permanentCopy && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="permanent-delete-title"
          onClick={() => closePermanentDialog()}
        >
          <div
            className="w-full max-w-md rounded-lg border border-gymnext-muted/40 bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 id="permanent-delete-title" className="text-sm font-semibold text-gray-900">
              {permanentCopy.title}
            </h4>
            <p className="mt-2 text-sm text-gray-700">{permanentCopy.description}</p>
            <p className="mt-3 text-xs font-medium text-gray-800">
              Type <span className="font-mono">{PERMANENT_DELETE_CONFIRMATION}</span> to confirm.
            </p>
            <input
              id="permanent-delete-phrase"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={permanentPhrase}
              onChange={(e) => setPermanentPhrase(e.target.value)}
              className="mt-1 w-full rounded border border-gymnext-muted/40 bg-white px-3 py-2 text-sm text-gray-900 font-mono"
              placeholder={PERMANENT_DELETE_CONFIRMATION}
              aria-label={`Type ${PERMANENT_DELETE_CONFIRMATION} to confirm permanent deletion`}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => closePermanentDialog()}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !canConfirmPermanent}
                onClick={() => void confirmPermanentDialog()}
                className="rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
              >
                {busy ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {collectionPickWorkout && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restore-workout-title"
          onClick={() => !busy && setCollectionPickWorkout(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-gymnext-muted/40 bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 id="restore-workout-title" className="text-sm font-semibold text-gray-900">
              {collectionPickWorkout.kind === 'deleted' ? 'Restore workout' : 'Add workout to collection'}
            </h4>
            <p className="mt-1 text-xs text-gray-600">
              {collectionPickWorkout.kind === 'deleted' ? (
                <>
                  Choose a collection for{' '}
                  <span className="font-medium text-gray-800">{workoutLabel(collectionPickWorkout.row)}</span>.
                </>
              ) : (
                <>
                  Add <span className="font-medium text-gray-800">{workoutLabel(collectionPickWorkout.row)}</span> to
                  a collection so it appears in your library again.
                </>
              )}
            </p>
            {activeCollections.length === 0 ? (
              <p className="mt-3 text-sm text-amber-800">
                You do not have any active collections. Recover or create a collection first.
              </p>
            ) : (
              <label className="mt-3 block text-xs font-medium text-gray-700" htmlFor="restore-collection-select">
                Collection
              </label>
            )}
            {activeCollections.length > 0 && (
              <select
                id="restore-collection-select"
                className="mt-1 w-full rounded border border-gymnext-muted/40 bg-white px-3 py-2 text-sm text-gray-900"
                value={restoreCollectionId}
                onChange={(e) => setRestoreCollectionId(e.target.value)}
              >
                {activeCollections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id === 'favorite' ? 'Favorites' : c.workoutCollectionName || c.id}
                  </option>
                ))}
              </select>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setCollectionPickWorkout(null)}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || activeCollections.length === 0 || !restoreCollectionId}
                onClick={() => void confirmCollectionPickWorkout()}
                className="rounded bg-gymnext px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Working…' : collectionPickWorkout.kind === 'deleted' ? 'Restore' : 'Add to collection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
