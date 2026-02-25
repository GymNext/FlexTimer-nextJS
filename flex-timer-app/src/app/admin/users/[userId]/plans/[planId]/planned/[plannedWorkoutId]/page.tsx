'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase'
import type { PlannedWorkout, WorkoutSegment } from '@/types/user'
import { parseWorkoutScheduleForDisplay, buildOptionsSection, getWorkoutDisplayName, getWorkoutDisplayDescription } from '@/lib/json-workout-format'

export default function AdminPlannedWorkoutDetailPage() {
  const params = useParams()
  const userId = params.userId as string
  const planId = params.planId as string
  const plannedWorkoutId = params.plannedWorkoutId as string
  const router = useRouter()
  const [plannedWorkout, setPlannedWorkout] = useState<PlannedWorkout | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const user = auth.currentUser
    if (!user || !userId || !planId || !plannedWorkoutId) {
      setLoading(false)
      return
    }
    user
      .getIdToken()
      .then((token) =>
        fetch(
          `/api/admin/users/${encodeURIComponent(userId)}/plans/${encodeURIComponent(planId)}/planned-workouts/${encodeURIComponent(plannedWorkoutId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
      )
      .then((res) => {
        if (cancelled) return res
        if (!res.ok) return res.json().then((d) => Promise.reject(new Error(d.error || res.statusText)))
        return res.json()
      })
      .then((data) => {
        if (!cancelled) setPlannedWorkout(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load planned workout')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId, planId, plannedWorkoutId])

  if (loading) {
    return <p className="text-gray-500">Loading planned workout…</p>
  }

  if (error || !plannedWorkout) {
    return (
      <div className="space-y-4">
        <div className="rounded bg-red-50 p-3 text-sm text-red-700">
          {error ?? 'Planned workout not found'}
        </div>
        <Link
          href={`/admin/users/${userId}/plans/${planId}`}
          className="text-blue-600 hover:text-blue-800"
        >
          ← Back to plan
        </Link>
      </div>
    )
  }

  const w = plannedWorkout.workout
  const isMulti = (w.segments?.length ?? 0) > 0
  const singleSections: { title: string; rows: { label: string; value: string }[] }[] = []
  if (!isMulti) {
    const optionsSection = buildOptionsSection({
      prelude: w.prelude,
      segue: w.segue,
      warnings: w.warnings,
      metronome: w.metronome,
      direction: w.direction,
      restDirection: w.restDirection,
      warningStrategy: w.warningStrategy,
      continuity: w.continuity,
    })
    if (optionsSection.rows.length > 0) singleSections.push(optionsSection)
    const scheduleSection = parseWorkoutScheduleForDisplay(w.workoutSchedule)
    if (scheduleSection) singleSections.push(scheduleSection)
  }

  const scheduledDay = plannedWorkout.day
    ? new Date(plannedWorkout.day).toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '—'

  const handleDelete = async () => {
    if (!confirm('Remove this workout from the plan? This cannot be undone.')) return
    const user = auth.currentUser
    if (!user) return
    setDeleteError(null)
    setDeleting(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/plans/${encodeURIComponent(planId)}/planned-workouts/${encodeURIComponent(plannedWorkoutId)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? res.statusText)
      }
      router.push(`/admin/users/${userId}/plans/${planId}`)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/admin/users/${userId}/plans/${planId}`}
          className="text-sm text-blue-600 hover:text-blue-800 mb-2 inline-block"
        >
          ← Back to plan
        </Link>
        <h1 className="text-xl font-semibold text-gray-900">Planned workout</h1>
        <p className="text-sm text-gray-600 mt-1">
          {getWorkoutDisplayName(w)} — {getWorkoutDisplayDescription(w)}
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-sm font-medium text-gray-700">Details</h2>
        </div>
        <dl className="divide-y divide-gray-200">
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Planned workout ID</dt>
            <dd className="mt-1 text-sm font-mono text-gray-900 sm:col-span-2">{plannedWorkout.id}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Name</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{getWorkoutDisplayName(w) || '—'}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Description</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{getWorkoutDisplayDescription(w) || '—'}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Type</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{w.type ?? (isMulti ? 'MultiSegmentWorkout' : 'SingleSegmentWorkout')}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Scheduled day</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{scheduledDay}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Ordinal</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{plannedWorkout.ordinal}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Source workout</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">
              {plannedWorkout.sourceWorkoutId ? (
                <Link
                  href={`/admin/users/${userId}/workouts/${encodeURIComponent(plannedWorkout.sourceWorkoutId)}`}
                  className="text-blue-600 hover:text-blue-800"
                >
                  {plannedWorkout.sourceWorkoutId}
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Actions</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Removing…' : 'Remove from plan'}
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

      {isMulti && w.segments && w.segments.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h2 className="text-sm font-medium text-gray-700">Segments</h2>
          </div>
          <div className="divide-y divide-gray-200">
            <div className="px-4 py-3 flex flex-wrap gap-4 text-sm">
              <span><strong>Auto progress:</strong> {w.autoProgress ? 'Yes' : 'No'}</span>
              {w.timerModes != null && (
                <span><strong>Timer modes:</strong> {Array.isArray(w.timerModes) ? w.timerModes.join(', ') : String(w.timerModes)}</span>
              )}
            </div>
            {w.segments.map((seg, index) => (
              <SegmentBlock key={seg.workoutId} segment={seg} index={index} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SegmentBlock({ segment, index }: { segment: WorkoutSegment; index: number }) {
  const segOptions = buildOptionsSection({
    prelude: segment.prelude,
    segue: segment.segue,
    warnings: segment.warnings,
    metronome: segment.metronome,
    direction: segment.direction,
    restDirection: segment.restDirection,
    warningStrategy: segment.warningStrategy,
    continuity: segment.continuity,
  })
  const segSchedule = parseWorkoutScheduleForDisplay(segment.workoutSchedule)
  return (
    <div className="px-4 py-4 border-t border-gray-200">
      <h3 className="text-sm font-medium text-gray-800 mb-2">
        Segment {index + 1}: {segment.workoutName ?? segment.workoutId ?? `Segment ${index + 1}`}
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
}
