'use client'

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  DndContext,
  type DragEndEvent,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
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

/** Timer modes we can create from the plan page (raw values). */
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

/** Parse "M:SS" or "M" to seconds. "1:30" -> 90, "2" -> 120. */
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
  const [moveError, setMoveError] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createStep, setCreateStep] = useState<1 | 2 | 3>(1)
  const [createDate, setCreateDate] = useState('')
  const [createMode, setCreateMode] = useState<number>(1)
  const [createOptions, setCreateOptions] = useState<Record<string, string | number>>({})
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  )

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
    weekDays.forEach((d) => {
      if (map[d]) map[d].sort((a, b) => a.ordinal - b.ordinal)
    })
    return map
  }, [plannedWorkouts, weekStart])

  const movePlannedWorkout = useCallback(
    async (plannedWorkoutId: string, targetDay: string, targetIndex: number) => {
      const user = auth.currentUser
      if (!user || !userId || !planId) return
      setMoveError(null)
      setMovingId(plannedWorkoutId)
      try {
        const targetItems = (byDay[targetDay] ?? []).filter((pw) => pw.id !== plannedWorkoutId)
        const ordinals = targetItems.map((pw) => pw.ordinal)
        let newOrdinal: number
        if (targetIndex <= 0) {
          newOrdinal = (ordinals[0] ?? 0) - 1
        } else if (targetIndex >= ordinals.length) {
          newOrdinal = (ordinals[ordinals.length - 1] ?? 0) + 1
        } else {
          newOrdinal = (ordinals[targetIndex - 1]! + ordinals[targetIndex]!) / 2
        }
        const token = await user.getIdToken()
        const res = await fetch(
          `/api/admin/users/${encodeURIComponent(userId)}/plans/${encodeURIComponent(planId)}/planned-workouts/${encodeURIComponent(plannedWorkoutId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ day: targetDay, ordinal: newOrdinal }),
          }
        )
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error ?? res.statusText)
        }
        const updated = (await res.json()) as PlannedWorkout
        setPlannedWorkouts((prev) => {
          const without = prev.filter((pw) => pw.id !== plannedWorkoutId)
          const next = [...without, { ...updated, day: updated.day.slice(0, 10) }]
          next.sort((a, b) => a.day.localeCompare(b.day) || a.ordinal - b.ordinal)
          return next
        })
      } catch (e) {
        setMoveError(e instanceof Error ? e.message : 'Failed to move workout')
      } finally {
        setMovingId(null)
      }
    },
    [userId, planId, byDay]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over) return
      const id = over.id as string
      const match = id.match(/^(\d{4}-\d{2}-\d{2})-(\d+)$/)
      if (!match) return
      const [, targetDay, indexStr] = match
      const targetIndex = parseInt(indexStr, 10)
      if (Number.isNaN(targetIndex) || !targetDay) return
      movePlannedWorkout(active.id as string, targetDay, targetIndex)
    },
    [movePlannedWorkout]
  )

  const buildWorkoutFromCreateForm = useCallback((): Record<string, unknown> => {
    const schedule: Record<string, unknown> = { timerMode: createMode }
    const dir = createOptions.direction === 1 || createOptions.direction === 'true'
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
      case 1:
        schedule.standardTimeCap = dur('timeCap')
        break
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
      case 7:
        schedule.shotClockDuration = num('shotClockSeconds')
        break
      case 10:
        schedule.warmupTimeCap = dur('timeCap')
        break
      case 11:
        schedule.cooldownTimeCap = dur('timeCap')
        break
      case 12:
        schedule.restDrivenNumberOfSets = num('sets')
        schedule.restDrivenType = num('restDrivenType')
        if (schedule.restDrivenType === 0) {
          schedule.restDrivenFixedRestDuration = dur('fixedRest')
        } else {
          schedule.restDrivenWorkRatio = num('workRatio')
          schedule.restDrivenRestRatio = num('restRatio')
        }
        break
      case 13:
        schedule.restTimeCap = dur('timeCap')
        break
      default:
        break
    }
    return {
      type: 'SingleSegmentWorkout',
      timerMode: createMode,
      direction: dir,
      workoutSchedule: JSON.stringify(schedule),
    }
  }, [createMode, createOptions])

  const handleCreateSubmit = useCallback(async () => {
    const user = auth.currentUser
    if (!user || !userId || !planId) return
    setCreateError(null)
    setCreateSubmitting(true)
    try {
      const workout = buildWorkoutFromCreateForm()
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/plans/${encodeURIComponent(planId)}/planned-workouts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ day: createDate, ordinal: 0, workout }),
        }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? res.statusText)
      }
      const created = (await res.json()) as PlannedWorkout
      setPlannedWorkouts((prev) => {
        const next = [...prev, created]
        next.sort((a, b) => a.day.localeCompare(b.day) || a.ordinal - b.ordinal)
        return next
      })
      setCreateModalOpen(false)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create workout')
    } finally {
      setCreateSubmitting(false)
    }
  }, [userId, planId, createDate, buildWorkoutFromCreateForm])

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
          <div>
            <h2 className="text-sm font-medium text-gray-700">Weekly calendar</h2>
            <p className="text-xs text-gray-500 mt-0.5">Drag workouts to reorder or move to another day.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setCreateModalOpen(true)
                setCreateStep(1)
                setCreateDate(toYYYYMMDD(new Date()))
                setCreateMode(1)
                setCreateOptions({})
                setCreateError(null)
              }}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Add workout
            </button>
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
        {moveError && (
          <div className="px-4 py-2 bg-amber-50 text-sm text-amber-800">{moveError}</div>
        )}
        {loadingCalendar ? (
          <div className="px-4 py-8 text-sm text-gray-500">Loading planned workouts…</div>
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
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
                    <div className="p-2 flex-1 min-h-[120px] flex flex-col gap-1">
                      {Array.from({ length: items.length + 1 }, (_, slotIndex) => (
                        <Fragment key={slotIndex}>
                          <DroppableSlot dateKey={dateKey} slotIndex={slotIndex} />
                          {items[slotIndex] ? (
                            <DraggablePlannedWorkoutCard
                              userId={userId}
                              planId={planId}
                              plannedWorkout={items[slotIndex]!}
                              isMoving={movingId === items[slotIndex]!.id}
                            />
                          ) : null}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </DndContext>
        )}
      </div>

      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" aria-hidden onClick={() => !createSubmitting && setCreateModalOpen(false)} />
          <div className="relative w-full max-w-md rounded-lg border border-gray-200 bg-white shadow-lg">
            <div className="border-b border-gray-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">Add workout</h3>
              <p className="text-xs text-gray-500 mt-0.5">Step {createStep} of 3</p>
            </div>
            <div className="p-4 space-y-4">
              {createStep === 1 && (
                <>
                  <div>
                    <label htmlFor="create-date" className="block text-sm font-medium text-gray-700">Date</label>
                    <input
                      id="create-date"
                      type="date"
                      value={createDate}
                      onChange={(e) => setCreateDate(e.target.value.slice(0, 10))}
                      className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    />
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
                  <div className="flex justify-between">
                    <button
                      type="button"
                      onClick={() => setCreateStep(1)}
                      className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreateStep(3)}
                      className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
              {createStep === 3 && (
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
                      onClick={() => setCreateStep(2)}
                      disabled={createSubmitting}
                      className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateSubmit}
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
  const setOpt = (key: string, value: string | number) => {
    onChange({ ...options, [key]: value })
  }
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
        value={Number(getOpt('direction', 0)) ? 'up' : 'down'}
        onChange={(e) => setOpt('direction', e.target.value === 'up' ? 1 : 0)}
        className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
      >
        <option value="up">Count up</option>
        <option value="down">Count down</option>
      </select>
    </div>
  )

  switch (mode) {
    case 1:
      return (
        <div className="space-y-3">
          {durationInput('timeCap', 'Time cap (0 = infinite)', '3:00')}
          {directionSelect()}
        </div>
      )
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
      return (
        <div className="space-y-3">
          {numberInput('shotClockSeconds', 'Shot clock (seconds)', 24)}
        </div>
      )
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
            : (
              <>
                {numberInput('workRatio', 'Work ratio', 1)}
                {numberInput('restRatio', 'Rest ratio', 1)}
              </>
            )}
        </div>
      )
    default:
      return <p className="text-sm text-gray-500">No options for this mode.</p>
  }
}

function DroppableSlot({ dateKey, slotIndex }: { dateKey: string; slotIndex: number }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `${dateKey}-${slotIndex}`,
  })
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[6px] rounded transition-colors ${isOver ? 'bg-indigo-100' : 'bg-transparent'}`}
      aria-hidden
    />
  )
}

function DraggablePlannedWorkoutCard({
  userId,
  planId,
  plannedWorkout,
  isMoving,
}: {
  userId: string
  planId: string
  plannedWorkout: PlannedWorkout
  isMoving: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: plannedWorkout.id,
    data: { day: plannedWorkout.day.slice(0, 10), ordinal: plannedWorkout.ordinal },
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`cursor-grab active:cursor-grabbing touch-none ${isDragging ? 'opacity-50' : ''} ${isMoving ? 'opacity-70' : ''}`}
    >
      <PlannedWorkoutCard userId={userId} planId={planId} plannedWorkout={plannedWorkout} />
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
