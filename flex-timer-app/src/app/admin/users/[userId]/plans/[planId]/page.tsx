'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase'
import type { PlannedWorkout, WorkoutPlan } from '@/types/user'
import {
  getTimerModeColor,
  getTimerModeBarTextDark,
  getWorkoutDisplayName,
  getWorkoutDisplayDescription,
  timerModeToDisplayString,
} from '@/lib/json-workout-format'

function toYYYYMMDD(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getMondayOfWeek(date: Date): string {
  const d = new Date(date)
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return toYYYYMMDD(d)
}

function addDays(ymd: string, days: number): string {
  const d = new Date(ymd + 'T12:00:00.000Z')
  d.setUTCDate(d.getUTCDate() + days)
  return toYYYYMMDD(d)
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export default function AdminPlanDetailPage() {
  const params = useParams()
  const router = useRouter()
  const userId = params.userId as string
  const planId = params.planId as string
  const [plan, setPlan] = useState<WorkoutPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()))
  const [plannedWorkouts, setPlannedWorkouts] = useState<PlannedWorkout[]>([])
  const [loadingCalendar, setLoadingCalendar] = useState(false)
  const [calendarError, setCalendarError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const user = auth.currentUser
    if (!user || !userId || !planId) {
      setLoading(false)
      return
    }
    user
      .getIdToken()
      .then((token) =>
        fetch(`/api/admin/users/${encodeURIComponent(userId)}/plans/${encodeURIComponent(planId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      )
      .then((res) => {
        if (cancelled) return res
        if (!res.ok) return res.json().then((d) => Promise.reject(new Error(d.error || res.statusText)))
        return res.json()
      })
      .then((data) => {
        if (!cancelled) setPlan(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load plan')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId, planId])

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart])

  useEffect(() => {
    if (!plan || !userId || !planId) return
    const user = auth.currentUser
    if (!user) return
    setCalendarError(null)
    setLoadingCalendar(true)
    user
      .getIdToken()
      .then((token) =>
        fetch(
          `/api/admin/users/${encodeURIComponent(userId)}/plans/${encodeURIComponent(planId)}/planned-workouts?from=${encodeURIComponent(weekStart)}&to=${encodeURIComponent(weekEnd)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
      )
      .then((res) => {
        if (!res.ok) return res.json().then((d) => Promise.reject(new Error(d.error ?? res.statusText)))
        return res.json()
      })
      .then((data) => {
        setPlannedWorkouts(data.plannedWorkouts ?? [])
      })
      .catch((e) => {
        setCalendarError(e instanceof Error ? e.message : 'Failed to load planned workouts')
        setPlannedWorkouts([])
      })
      .finally(() => setLoadingCalendar(false))
  }, [plan, userId, planId, weekStart, weekEnd])

  const byDay = useMemo(() => {
    const map: Record<string, PlannedWorkout[]> = {}
    const weekDays = DAY_NAMES.map((_, i) => addDays(weekStart, i))
    weekDays.forEach((d) => (map[d] = []))
    plannedWorkouts.forEach((pw) => {
      const key = pw.day.slice(0, 10)
      if (!map[key]) map[key] = []
      map[key].push(pw)
    })
    return map
  }, [plannedWorkouts, weekStart])

  const handleSoftDelete = async () => {
    if (!confirm('Delete this plan? It can be recovered from deleted items.')) return
    const user = auth.currentUser
    if (!user) return
    setDeleteError(null)
    setDeleting(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/plans/${encodeURIComponent(planId)}`,
        { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? res.statusText)
      }
      const getRes = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/plans/${encodeURIComponent(planId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (getRes.ok) {
        const data = await getRes.json()
        setPlan(data)
      }
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  const handleRecover = async () => {
    if (!plan?.deletedAt) return
    const user = auth.currentUser
    if (!user) return
    setDeleteError(null)
    setRecovering(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/plans/${encodeURIComponent(planId)}`,
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
        `/api/admin/users/${encodeURIComponent(userId)}/plans/${encodeURIComponent(planId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (getRes.ok) {
        const data = await getRes.json()
        setPlan(data)
      }
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to recover')
    } finally {
      setRecovering(false)
    }
  }

  const handlePermanentDelete = async () => {
    if (!plan?.deletedAt) return
    if (!confirm('Permanently delete this plan and all its plan days? This cannot be undone.')) return
    const user = auth.currentUser
    if (!user) return
    setDeleteError(null)
    setDeleting(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/plans/${encodeURIComponent(planId)}`,
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

  if (loading) {
    return <p className="text-gray-500">Loading plan…</p>
  }

  if (error || !plan) {
    return (
      <div className="space-y-4">
        <div className="rounded bg-red-50 p-3 text-sm text-red-700">
          {error ?? 'Plan not found'}
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
        <h1 className="text-xl font-semibold text-gray-900">Workout plan</h1>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-sm font-medium text-gray-700">Details</h2>
        </div>
        <dl className="divide-y divide-gray-200">
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Plan ID</dt>
            <dd className="mt-1 text-sm font-mono text-gray-900 sm:col-span-2">{plan.workoutPlanId}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Name</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{plan.workoutPlanName}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Description</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{plan.workoutPlanDescription ?? '—'}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Personal</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{plan.isPersonal ? 'Yes' : 'No'}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Deleted</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2 flex flex-wrap items-center gap-3">
              {plan.deletedAt && (
                <span className="text-amber-600">{new Date(plan.deletedAt).toLocaleString()}</span>
              )}
              {plan.deletedAt && (
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
                onClick={plan.deletedAt ? handlePermanentDelete : handleSoftDelete}
                disabled={deleting}
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : plan.deletedAt ? 'Permanently delete' : 'Delete'}
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
          <h2 className="text-sm font-medium text-gray-700">Weekly calendar</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWeekStart(addDays(weekStart, -7))}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              ← Previous week
            </button>
            <span className="text-sm text-gray-600">
              {new Date(weekStart + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              {' – '}
              {new Date(weekEnd + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            <button
              type="button"
              onClick={() => setWeekStart(addDays(weekStart, 7))}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Next week →
            </button>
          </div>
        </div>
        {calendarError && (
          <div className="px-4 py-2 bg-red-50 text-sm text-red-700">{calendarError}</div>
        )}
        {loadingCalendar ? (
          <div className="px-4 py-8 text-sm text-gray-500">Loading planned workouts…</div>
        ) : (
          <div className="grid grid-cols-7 min-w-0 divide-x divide-gray-200">
            {DAY_NAMES.map((name, i) => {
              const dateKey = addDays(weekStart, i)
              const dayDate = new Date(dateKey + 'T12:00:00')
              const items = byDay[dateKey] ?? []
              return (
                <div key={dateKey} className="flex flex-col min-w-0">
                  <div className="px-2 py-2 bg-gray-50 border-b border-gray-200 text-center">
                    <div className="text-xs font-medium uppercase text-gray-500">{name}</div>
                    <div className="text-sm font-medium text-gray-900">
                      {dayDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                  <div className="p-2 space-y-2 flex-1 min-h-[120px]">
                    {items.map((pw) => (
                      <PlannedWorkoutCard key={pw.id} userId={userId} planId={planId} plannedWorkout={pw} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function PlannedWorkoutCard({
  userId,
  planId,
  plannedWorkout,
}: {
  userId: string
  planId: string
  plannedWorkout: PlannedWorkout
}) {
  const w = plannedWorkout.workout
  const displayName = getWorkoutDisplayName(w)
  const displayDescription = getWorkoutDisplayDescription(w)
  const timerModeValue = w.timerMode ?? w.timerModes
  const barColor = getTimerModeColor(timerModeValue)
  const barTextWhite = getTimerModeBarTextDark(timerModeValue)
  const timerDisplayLabel = timerModeToDisplayString(timerModeValue)
  const detailHref = `/admin/users/${userId}/plans/${planId}/planned/${encodeURIComponent(plannedWorkout.id)}`
  return (
    <div className="rounded border border-gray-200 bg-white overflow-hidden text-xs">
      <div
        className="px-2 py-1.5 font-medium truncate"
        style={{ backgroundColor: barColor, color: barTextWhite ? '#fff' : '#000' }}
      >
        <Link
          href={detailHref}
          className={barTextWhite ? 'text-white hover:opacity-90' : 'text-gray-900 hover:opacity-90'}
        >
          {displayName || '—'}
        </Link>
      </div>
      <div className="p-2 space-y-0.5">
        {displayDescription && <div className="text-gray-600">{displayDescription}</div>}
        {timerDisplayLabel !== 'Unknown' && displayDescription !== timerDisplayLabel && (
          <div className="text-gray-500">Timer: {timerDisplayLabel}</div>
        )}
        {plannedWorkout.sourceWorkoutId && (
          <Link
            href={`/admin/users/${userId}/workouts/${encodeURIComponent(plannedWorkout.sourceWorkoutId)}`}
            className="text-blue-600 hover:text-blue-800"
          >
            View source workout →
          </Link>
        )}
      </div>
    </div>
  )
}
