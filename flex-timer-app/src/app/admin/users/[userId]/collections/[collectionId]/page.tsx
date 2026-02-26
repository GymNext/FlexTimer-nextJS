'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase'
import type { Workout, WorkoutCollection } from '@/types/user'
import {
  formatTimerModeForDisplay,
  getCollectionDisplayName,
  getCollectionDisplayDescription,
  getWorkoutDisplayName,
  getWorkoutDisplayDescription,
} from '@/lib/json-workout-format'

/** Timer modes we can create. */
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

/** Parse "M:SS" or "M" to seconds. */
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
    const s = parseInt(parts[1]!, 10)
    return (Number.isNaN(m) ? 0 : m * 60) + (Number.isNaN(s) ? 0 : s)
  }
  if (parts.length === 3) {
    const h = parseInt(parts[0]!, 10)
    const m = parseInt(parts[1]!, 10)
    const s = parseInt(parts[2]!, 10)
    return (Number.isNaN(h) ? 0 : h * 3600) + (Number.isNaN(m) ? 0 : m * 60) + (Number.isNaN(s) ? 0 : s)
  }
  return 0
}

export default function AdminCollectionDetailPage() {
  const params = useParams()
  const router = useRouter()
  const userId = params.userId as string
  const collectionId = params.collectionId as string
  const [collection, setCollection] = useState<WorkoutCollection | null>(null)
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createStep, setCreateStep] = useState<1 | 2>(1)
  const [createMode, setCreateMode] = useState<number>(1)
  const [createOptions, setCreateOptions] = useState<Record<string, string | number>>({})
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const user = auth.currentUser
    if (!user || !userId || !collectionId) {
      setLoading(false)
      return
    }
    user
      .getIdToken()
      .then((token) =>
        fetch(
          `/api/admin/users/${encodeURIComponent(userId)}/collections/${encodeURIComponent(collectionId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
      )
      .then((res) => {
        if (cancelled) return res
        if (!res.ok) return res.json().then((d) => Promise.reject(new Error(d.error || res.statusText)))
        return res.json()
      })
      .then((data) => {
        if (!cancelled) {
          setCollection(data.collection)
          setWorkouts(data.workouts ?? [])
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load collection')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId, collectionId])

  const handleSoftDelete = async () => {
    if (!confirm('Delete this collection? It can be recovered from deleted items.')) return
    const user = auth.currentUser
    if (!user) return
    setDeleteError(null)
    setDeleting(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/collections/${encodeURIComponent(collectionId)}`,
        { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? res.statusText)
      }
      const getRes = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/collections/${encodeURIComponent(collectionId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (getRes.ok) {
        const data = await getRes.json()
        setCollection(data.collection)
        setWorkouts(data.workouts ?? [])
      }
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  const handleRecover = async () => {
    if (!collection?.deletedAt) return
    const user = auth.currentUser
    if (!user) return
    setDeleteError(null)
    setRecovering(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/collections/${encodeURIComponent(collectionId)}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recover: true }),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? res.statusText)
      }
      const getRes = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/collections/${encodeURIComponent(collectionId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (getRes.ok) {
        const data = await getRes.json()
        setCollection(data.collection)
        setWorkouts(data.workouts ?? [])
      }
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to recover')
    } finally {
      setRecovering(false)
    }
  }

  const handlePermanentDelete = async () => {
    if (!collection?.deletedAt) return
    if (!confirm('Permanently delete this collection? This cannot be undone.')) return
    const user = auth.currentUser
    if (!user) return
    setDeleteError(null)
    setDeleting(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/collections/${encodeURIComponent(collectionId)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? res.statusText)
      }
      router.push(`/admin/users/${userId}`)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  const buildWorkoutFromCreateForm = useCallback((): { timerMode: number; workoutSchedule: string; direction: boolean } => {
    const schedule: Record<string, unknown> = { timerMode: createMode }
    const dir = createOptions.direction === true || createOptions.direction === 'true'
    const num = (key: string) => {
      const v = createOptions[key]
      if (typeof v === 'number') return v
      if (typeof v === 'string') { const n = parseInt(v, 10); return Number.isNaN(n) ? 0 : n }
      return 0
    }
    const dur = (key: string) => {
      const v = createOptions[key]
      if (typeof v === 'number') return v
      if (typeof v === 'string') return parseDurationInput(v)
      return 0
    }
    switch (createMode) {
      case 1: schedule.standardTimeCap = dur('timeCap'); break
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
      case 7: schedule.shotClockDuration = num('shotClockSeconds'); break
      case 10: schedule.warmupTimeCap = dur('timeCap'); break
      case 11: schedule.cooldownTimeCap = dur('timeCap'); break
      case 12:
        schedule.restDrivenNumberOfSets = num('sets')
        schedule.restDrivenType = num('restDrivenType')
        if (schedule.restDrivenType === 0) schedule.restDrivenFixedRestDuration = dur('fixedRest')
        else {
          schedule.restDrivenWorkRatio = num('workRatio')
          schedule.restDrivenRestRatio = num('restRatio')
        }
        break
      case 13: schedule.restTimeCap = dur('timeCap'); break
      default: break
    }
    return {
      timerMode: createMode,
      workoutSchedule: JSON.stringify(schedule),
      direction: dir,
    }
  }, [createMode, createOptions])

  const handleCreateWorkoutSubmit = useCallback(async () => {
    const user = auth.currentUser
    if (!user || !userId || !collectionId) return
    setCreateError(null)
    setCreateSubmitting(true)
    try {
      const workout = buildWorkoutFromCreateForm()
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/collections/${encodeURIComponent(collectionId)}/workouts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ workout }),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? res.statusText)
      }
      const created = (await res.json()) as Workout
      setWorkouts((prev) => [...prev, created])
      setCollection((prev) => prev ? { ...prev, workoutIds: [...prev.workoutIds, created.id] } : null)
      setCreateModalOpen(false)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create workout')
    } finally {
      setCreateSubmitting(false)
    }
  }, [userId, collectionId, buildWorkoutFromCreateForm])

  if (loading) {
    return <p className="text-gray-500">Loading collection…</p>
  }

  if (error || !collection) {
    return (
      <div className="space-y-4">
        <div className="rounded bg-red-50 p-3 text-sm text-red-700">
          {error ?? 'Collection not found'}
        </div>
        <Link href={`/admin/users/${userId}`} className="text-blue-600 hover:text-blue-800">
          ← Back to user profile
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/admin/users/${userId}`}
          className="text-sm text-blue-600 hover:text-blue-800 mb-2 inline-block"
        >
          ← Back to user profile
        </Link>
        <h1 className="text-xl font-semibold text-gray-900">Workout collection</h1>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-sm font-medium text-gray-700">Details</h2>
        </div>
        <dl className="divide-y divide-gray-200">
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Collection ID</dt>
            <dd className="mt-1 text-sm font-mono text-gray-900 sm:col-span-2">{collection.workoutCollectionId}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Name</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{getCollectionDisplayName(collection)}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Description</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{getCollectionDisplayDescription(collection)}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Share ID</dt>
            <dd className="mt-1 text-sm font-mono text-gray-900 sm:col-span-2">{collection.workoutCollectionShareId}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Workouts</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{collection.workoutIds.length}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Deleted</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2 flex flex-wrap items-center gap-3">
              {collection.deletedAt && (
                <span className="text-amber-600">{new Date(collection.deletedAt).toLocaleString()}</span>
              )}
              {collection.deletedAt && (
                <button
                  type="button"
                  onClick={handleRecover}
                  disabled={recovering}
                  className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {recovering ? 'Recovering…' : 'Recover'}
                </button>
              )}
              <button
                type="button"
                onClick={collection.deletedAt ? handlePermanentDelete : handleSoftDelete}
                disabled={deleting}
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : collection.deletedAt ? 'Permanently delete' : 'Delete'}
              </button>
            </dd>
          </div>
        </dl>
        {deleteError && (
          <div className="px-4 py-2 border-t border-gray-200 bg-red-50 text-sm text-red-700">
            {deleteError}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-gray-700">Workouts in this collection ({workouts.length})</h2>
          {!collection.deletedAt && (
            <button
              type="button"
              onClick={() => {
                setCreateModalOpen(true)
                setCreateStep(1)
                setCreateMode(1)
                setCreateOptions({})
                setCreateError(null)
              }}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Create workout
            </button>
          )}
        </div>
        {workouts.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">No workouts in this collection.</p>
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
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Timer mode(s)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {workouts.map((w) => (
                  <tr key={w.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium">
                      <Link
                        href={`/admin/users/${userId}/workouts/${encodeURIComponent(w.id)}`}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        {getWorkoutDisplayName(w) || '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{getWorkoutDisplayDescription(w) || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                      {w.type === 'SingleSegmentWorkout'
                        ? formatTimerModeForDisplay(w.timerMode)
                        : formatTimerModeForDisplay(w.timerModes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" aria-hidden onClick={() => !createSubmitting && setCreateModalOpen(false)} />
          <div className="relative w-full max-w-md rounded-lg border border-gray-200 bg-white shadow-lg">
            <div className="border-b border-gray-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">Create workout</h3>
              <p className="text-xs text-gray-500 mt-0.5">Step {createStep} of 2</p>
            </div>
            <div className="p-4 space-y-4">
              {createStep === 1 && (
                <>
                  <div>
                    <label htmlFor="create-mode" className="block text-sm font-medium text-gray-700">Workout mode</label>
                    <select
                      id="create-mode"
                      value={createMode}
                      onChange={(e) => {
                        setCreateMode(Number(e.target.value))
                        setCreateOptions({})
                      }}
                      className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    >
                      {CREATABLE_TIMER_MODES.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setCreateStep(2)}
                      className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
              {createStep === 2 && (
                <>
                  <CreateWorkoutOptions
                    mode={createMode}
                    options={createOptions}
                    onChange={setCreateOptions}
                    parseDurationInput={parseDurationInput}
                  />
                  {createError && (
                    <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{createError}</div>
                  )}
                  <div className="flex justify-between">
                    <button
                      type="button"
                      onClick={() => setCreateStep(1)}
                      disabled={createSubmitting}
                      className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateWorkoutSubmit}
                      disabled={createSubmitting}
                      className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {createSubmitting ? 'Creating…' : 'Create'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
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
  const setOpt = (key: string, value: string | number) => onChange({ ...options, [key]: value })
  const getOpt = (key: string, def: string | number) => options[key] ?? def
  const durationInput = (key: string, label: string, placeholder = '0:00') => (
    <div key={key}>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <input
        type="text"
        placeholder={placeholder}
        value={String(getOpt(key, '') ?? '')}
        onChange={(e) => setOpt(key, e.target.value)}
        className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
      />
    </div>
  )
  const numberInput = (key: string, label: string, def = 0, min = 0) => (
    <div key={key}>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <input
        type="number"
        min={min}
        value={Number(getOpt(key, def))}
        onChange={(e) => setOpt(key, parseInt(e.target.value, 10) || 0)}
        className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
      />
    </div>
  )
  const directionSelect = () => (
    <div key="direction">
      <label className="block text-sm font-medium text-gray-700">Direction</label>
      <select
        value={getOpt('direction', false) ? 'up' : 'down'}
        onChange={(e) => setOpt('direction', e.target.value === 'up')}
        className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
      >
        <option value="up">Count up</option>
        <option value="down">Count down</option>
      </select>
    </div>
  )

  switch (mode) {
    case 1:
      return <div className="space-y-3">{durationInput('timeCap', 'Time cap (0 = infinite)', '3:00')}{directionSelect()}</div>
    case 2:
      return (
        <div className="space-y-3">
          {durationInput('duration', 'Round duration', '1:00')}
          {numberInput('rounds', 'Number of rounds (0 = infinite)', 3)}
          {durationInput('restBetween', 'Rest between rounds', '0:30')}
        </div>
      )
    case 4:
      return (
        <div className="space-y-3">
          {durationInput('workDuration', 'Work duration', '0:20')}
          {durationInput('restDuration', 'Rest duration', '0:10')}
          {numberInput('roundsPerTabata', 'Rounds per tabata', 8)}
          {numberInput('numberOfTabatas', 'Number of tabatas', 1)}
        </div>
      )
    case 5:
      return (
        <div className="space-y-3">
          {numberInput('intervalSeconds', 'Interval (seconds)', 60)}
          {numberInput('intervals', 'Number of intervals', 10)}
        </div>
      )
    case 6:
      return <p className="text-sm text-gray-500">No options for lap timer.</p>
    case 7:
      return <div className="space-y-3">{numberInput('shotClockSeconds', 'Shot clock (seconds)', 24)}</div>
    case 10:
    case 11:
    case 13:
      return (
        <div className="space-y-3">
          {durationInput('timeCap', mode === 13 ? 'Rest duration' : mode === 10 ? 'Warmup duration' : 'Cooldown duration', '5:00')}
          {directionSelect()}
        </div>
      )
    case 12:
      return (
        <div className="space-y-3">
          {numberInput('sets', 'Number of sets', 3)}
          <div>
            <label className="block text-sm font-medium text-gray-700">Rest type</label>
            <select
              value={Number(getOpt('restDrivenType', 0))}
              onChange={(e) => setOpt('restDrivenType', parseInt(e.target.value, 10))}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value={0}>Fixed rest duration</option>
              <option value={1}>Work:rest ratio</option>
            </select>
          </div>
          {Number(getOpt('restDrivenType', 0)) === 0
            ? durationInput('fixedRest', 'Rest duration', '1:00')
            : <>{numberInput('workRatio', 'Work ratio', 1)}{numberInput('restRatio', 'Rest ratio', 1)}</>}
        </div>
      )
    default:
      return <p className="text-sm text-gray-500">No options for this mode.</p>
  }
}
