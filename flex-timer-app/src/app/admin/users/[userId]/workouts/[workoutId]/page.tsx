'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase'
import type { Workout } from '@/types/user'
import {
  parseWorkoutScheduleForDisplay,
  buildOptionsSection,
  getWorkoutDisplayName,
  getWorkoutDisplayDescription,
} from '@/lib/json-workout-format'

export default function AdminWorkoutDetailPage() {
  const params = useParams()
  const router = useRouter()
  const userId = params.userId as string
  const workoutId = params.workoutId as string
  const [workout, setWorkout] = useState<Workout | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const user = auth.currentUser
    if (!user || !userId || !workoutId) {
      setLoading(false)
      return
    }
    user
      .getIdToken()
      .then((token) =>
        fetch(`/api/admin/users/${encodeURIComponent(userId)}/workouts/${encodeURIComponent(workoutId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      )
      .then((res) => {
        if (cancelled) return res
        if (!res.ok) return res.json().then((d) => Promise.reject(new Error(d.error || res.statusText)))
        return res.json()
      })
      .then((data) => {
        if (!cancelled) setWorkout(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load workout')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId, workoutId])

  if (loading) {
    return <p className="text-gray-500">Loading workout…</p>
  }

  if (error || !workout) {
    return (
      <div className="space-y-4">
        <div className="rounded bg-red-50 p-3 text-sm text-red-700">
          {error ?? 'Workout not found'}
        </div>
        <Link href={`/admin/users/${userId}`} className="text-blue-600 hover:text-blue-800">
          ← Back to user profile
        </Link>
      </div>
    )
  }

  const handleSoftDelete = async () => {
    if (!confirm('Delete this workout? It can be recovered from deleted items.')) return
    const user = auth.currentUser
    if (!user) return
    setDeleteError(null)
    setDeleting(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/workouts/${encodeURIComponent(workoutId)}`,
        { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? res.statusText)
      }
      const getRes = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/workouts/${encodeURIComponent(workoutId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (getRes.ok) {
        const data = await getRes.json()
        setWorkout(data)
      }
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  const handleRecover = async () => {
    if (!workout.deletedAt) return
    const user = auth.currentUser
    if (!user) return
    setDeleteError(null)
    setRecovering(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/workouts/${encodeURIComponent(workoutId)}`,
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
        `/api/admin/users/${encodeURIComponent(userId)}/workouts/${encodeURIComponent(workoutId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (getRes.ok) {
        const data = await getRes.json()
        setWorkout(data)
      }
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to recover')
    } finally {
      setRecovering(false)
    }
  }

  const handlePermanentDelete = async () => {
    if (!workout.deletedAt) return
    if (!confirm('Permanently delete this workout? This cannot be undone.')) return
    const user = auth.currentUser
    if (!user) return
    setDeleteError(null)
    setDeleting(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/workouts/${encodeURIComponent(workoutId)}`,
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

  const singleSections: { title: string; rows: { label: string; value: string }[] }[] = []
  if (workout.type === 'SingleSegmentWorkout') {
    const optionsSection = buildOptionsSection({
      prelude: workout.prelude,
      segue: workout.segue,
      warnings: workout.warnings,
      metronome: workout.metronome,
      direction: workout.direction,
      restDirection: workout.restDirection,
      warningStrategy: workout.warningStrategy,
      continuity: workout.continuity,
    })
    if (optionsSection.rows.length > 0) singleSections.push(optionsSection)
    const scheduleSection = parseWorkoutScheduleForDisplay(workout.workoutSchedule)
    if (scheduleSection) singleSections.push(scheduleSection)
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
        <h1 className="text-xl font-semibold text-gray-900">Workout</h1>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-sm font-medium text-gray-700">Details</h2>
        </div>
        <dl className="divide-y divide-gray-200">
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Workout ID</dt>
            <dd className="mt-1 text-sm font-mono text-gray-900 sm:col-span-2">{workout.workoutId}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Name</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{getWorkoutDisplayName(workout) || '—'}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Description</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{getWorkoutDisplayDescription(workout) || '—'}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Share ID</dt>
            <dd className="mt-1 text-sm font-mono text-gray-900 sm:col-span-2">{workout.workoutShareId ?? '—'}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Type</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{workout.type}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Deleted</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2 flex flex-wrap items-center gap-3">
              {workout.deletedAt && (
                <span className="text-amber-600">{new Date(workout.deletedAt).toLocaleString()}</span>
              )}
              {workout.deletedAt && (
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
                onClick={workout.deletedAt ? handlePermanentDelete : handleSoftDelete}
                disabled={deleting}
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : workout.deletedAt ? 'Permanently delete' : 'Delete'}
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

      {singleSections.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h2 className="text-sm font-medium text-gray-700">Schedule & options</h2>
          </div>
          <div className="divide-y divide-gray-200">
            {singleSections.map((section) => (
              <div key={section.title} className="px-4 py-3">
                <h3 className="text-xs font-medium uppercase text-gray-500 mb-2">
                  {section.title}
                </h3>
                <dl className="sm:grid sm:grid-cols-3 sm:gap-4 space-y-2 sm:space-y-0">
                  {section.rows.map((row) => (
                    <div key={row.label} className="sm:grid sm:grid-cols-3 sm:gap-4">
                      <dt className="text-sm font-medium text-gray-500">{row.label}</dt>
                      <dd className="mt-0.5 text-sm text-gray-900 font-mono sm:col-span-2 break-all">
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </div>
      )}

      {workout.type === 'MultiSegmentWorkout' && (workout.segments?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h2 className="text-sm font-medium text-gray-700">Segments</h2>
          </div>
          <div className="divide-y divide-gray-200">
            <div className="px-4 py-3 flex flex-wrap gap-4 text-sm">
              <span><strong>Auto progress:</strong> {workout.autoProgress ? 'Yes' : 'No'}</span>
              {workout.timerModes != null && (
                <span><strong>Timer modes:</strong> {Array.isArray(workout.timerModes) ? (workout.timerModes as number[]).join(', ') : String(workout.timerModes)}</span>
              )}
            </div>
            {workout.segments!.map((seg, index) => {
              const segOptions = buildOptionsSection({
                prelude: seg.prelude,
                segue: seg.segue,
                warnings: seg.warnings,
                metronome: seg.metronome,
                direction: seg.direction,
                restDirection: seg.restDirection,
                warningStrategy: seg.warningStrategy,
                continuity: seg.continuity,
              })
              const segSchedule = parseWorkoutScheduleForDisplay(seg.workoutSchedule)
              return (
                <div key={seg.workoutId} className="px-4 py-4 border-t border-gray-200">
                  <h3 className="text-sm font-medium text-gray-800 mb-2">
                    Segment {index + 1}: {seg.workoutName ?? seg.workoutId}
                  </h3>
                  {(segOptions.rows.length > 0 || segSchedule) && (
                    <div className="space-y-3 pl-2">
                      {segOptions.rows.length > 0 && (
                        <dl className="sm:grid sm:grid-cols-3 sm:gap-4 space-y-1 text-sm">
                          {segOptions.rows.map((row) => (
                            <div key={row.label} className="sm:grid sm:grid-cols-3 sm:gap-4">
                              <dt className="font-medium text-gray-500">{row.label}</dt>
                              <dd className="font-mono text-gray-900 sm:col-span-2">{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {segSchedule && (
                        <dl className="sm:grid sm:grid-cols-3 sm:gap-4 space-y-1 text-sm">
                          {segSchedule.rows.map((row) => (
                            <div key={row.label} className="sm:grid sm:grid-cols-3 sm:gap-4">
                              <dt className="font-medium text-gray-500">{row.label}</dt>
                              <dd className="font-mono text-gray-900 sm:col-span-2">{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
