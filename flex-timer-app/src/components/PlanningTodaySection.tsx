'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import type { PlanDayEntry, PlannedWorkout, WorkoutPlan } from '@/types/user'
import {
  getWorkoutBarColor,
  getWorkoutDetailDescription,
  getWorkoutDisplayName,
} from '@/lib/json-workout-format'
import { planDayTimeZoneQuerySuffix } from '@/lib/client-plan-day-timezone'

function trimWorkoutDetailsForPreview(entry: PlanDayEntry): string {
  if (entry.type === 'MultiSegmentWorkout') return ''
  return (entry.workoutDetails ?? '').trim()
}

/** Matches Plans / Plan Ahead expanded panel: optional user notes with line-clamp + expand. */
function TodayWorkoutUserDetails({ details }: { details: string }) {
  const [expanded, setExpanded] = useState(false)
  const [truncates, setTruncates] = useState(false)
  const contentRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    setExpanded(false)
  }, [details])

  useEffect(() => {
    if (expanded) return
    const el = contentRef.current
    if (!el) return
    const id = requestAnimationFrame(() => {
      setTruncates(el.scrollHeight > el.clientHeight + 1)
    })
    return () => cancelAnimationFrame(id)
  }, [details, expanded])

  return (
    <div className="mt-2 border-t border-gymnext-muted/25 pt-2">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">Workout details</p>
      <p
        ref={contentRef}
        className={`whitespace-pre-wrap break-words text-sm text-gray-700 ${expanded ? '' : 'line-clamp-3'}`}
      >
        {details}
      </p>
      {truncates && (
        <button
          type="button"
          className="mt-1.5 text-xs font-medium hover:underline"
          style={{ color: '#6B21A8' }}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? 'Show less' : 'Expand…'}
        </button>
      )}
    </div>
  )
}

function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Shift a calendar day in local time (`YYYY-MM-DD` in / out). */
function shiftLocalYmd(ymd: string, deltaDays: number): string {
  const [y, mo, d] = ymd.split('-').map((n) => parseInt(n, 10))
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return ymd
  const dt = new Date(y, mo - 1, d)
  dt.setDate(dt.getDate() + deltaDays)
  return localDateKey(dt)
}

export type TodayFollowedPlanEntry = {
  subscriptionDocumentId: string
  plan: WorkoutPlan
}

type PlanGroup = { sectionKey: string; plan: WorkoutPlan; workouts: PlannedWorkout[] }

export type PlanAheadLookTarget =
  | { kind: 'owned'; planId: string }
  | { kind: 'followed'; subscriptionDocumentId: string }

export function PlanningTodaySection({
  user,
  plans,
  followedPlans = [],
  onOpenPlanAhead,
}: {
  user: User
  plans: WorkoutPlan[]
  followedPlans?: TodayFollowedPlanEntry[]
  /** Jump to Plan Ahead: owned plan or followed subscription. */
  onOpenPlanAhead?: (target: PlanAheadLookTarget) => void
}) {
  const [viewDateKey, setViewDateKey] = useState(() => localDateKey(new Date()))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [groups, setGroups] = useState<PlanGroup[]>([])
  const [planMenuOpenKey, setPlanMenuOpenKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    const day = viewDateKey
    if (plans.length === 0 && followedPlans.length === 0) {
      setGroups([])
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const token = await user.getIdToken()
      const headers = { Authorization: `Bearer ${token}` }
      const ownedFetches = plans.map(async (plan) => {
        const res = await fetch(
          `/api/app/plans/${encodeURIComponent(plan.id)}/planned-workouts?from=${encodeURIComponent(day)}&to=${encodeURIComponent(day)}${planDayTimeZoneQuerySuffix()}`,
          { headers }
        )
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(data.error || `HTTP ${res.status}`)
        }
        const data = (await res.json()) as { plannedWorkouts: PlannedWorkout[] }
        const list = (data.plannedWorkouts ?? []).filter((pw) => pw.day.slice(0, 10) === day)
        list.sort((a, b) => a.ordinal - b.ordinal)
        return { sectionKey: `owned-${plan.id}`, plan, workouts: list }
      })
      const followedFetches = followedPlans.map(async ({ subscriptionDocumentId, plan }) => {
        const res = await fetch(
          `/api/app/following-plans/${encodeURIComponent(subscriptionDocumentId)}/planned-workouts?from=${encodeURIComponent(day)}&to=${encodeURIComponent(day)}${planDayTimeZoneQuerySuffix()}`,
          { headers }
        )
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(data.error || `HTTP ${res.status}`)
        }
        const data = (await res.json()) as { plannedWorkouts: PlannedWorkout[] }
        const list = (data.plannedWorkouts ?? []).filter((pw) => pw.day.slice(0, 10) === day)
        list.sort((a, b) => a.ordinal - b.ordinal)
        return { sectionKey: `followed-${subscriptionDocumentId}`, plan, workouts: list }
      })
      const results = await Promise.all([...ownedFetches, ...followedFetches])
      setGroups(results)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workouts for this day')
      setGroups([])
    } finally {
      setLoading(false)
    }
  }, [user, plans, followedPlans, viewDateKey])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setPlanMenuOpenKey(null)
  }, [groups, viewDateKey])

  const calendarToday = localDateKey(new Date())
  const isViewingCalendarToday = viewDateKey === calendarToday

  const viewDayLabel = useMemo(() => {
    const [y, m, d] = viewDateKey.split('-').map((n) => parseInt(n, 10))
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return viewDateKey
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }, [viewDateKey])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white">
      <div className="shrink-0 border-b border-gymnext-muted/30 bg-gymnext-background px-4 py-3">
        <h2 className="text-center text-sm font-medium text-gray-800">Today&apos;s Plan</h2>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            aria-label="View previous day"
            onClick={() => setViewDateKey((k) => shiftLocalYmd(k, -1))}
            className="rounded border border-gymnext-muted/50 bg-white px-2.5 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-background"
          >
            ← Prev
          </button>
          <span className="min-w-0 text-center text-xs text-gray-600">{viewDayLabel}</span>
          <button
            type="button"
            aria-label="View next day"
            onClick={() => setViewDateKey((k) => shiftLocalYmd(k, 1))}
            className="rounded border border-gymnext-muted/50 bg-white px-2.5 py-1.5 text-xs font-medium text-gymnext-dark hover:bg-gymnext-background disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
          >
            Next →
          </button>
        </div>
        {!isViewingCalendarToday && (
          <button
            type="button"
            onClick={() => setViewDateKey(calendarToday)}
            className="mt-2 w-full text-center text-xs font-medium hover:underline"
            style={{ color: '#6B21A8' }}
          >
            Jump to today
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading && <p className="px-4 py-8 text-center text-sm text-gray-500">Loading…</p>}

        {!loading && error && (
          <div className="space-y-2 px-4 py-4">
            <p className="text-sm text-red-700">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              style={{ backgroundColor: '#6B21A8' }}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && groups.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-gray-500">
            You do not have any plans yet. Create a plan or subscribe to a coach&apos;s plan to see it here.
          </p>
        )}

        {!loading && !error && groups.length > 0 && (
          <div
            className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2"
          >
            {groups.map(({ sectionKey, plan, workouts }) => {
              const isOwned = sectionKey.startsWith('owned-')
              const showPlanMenu = Boolean(onOpenPlanAhead)
              return (
              <section
                key={sectionKey}
                className="min-w-0 flex flex-col rounded-lg border border-gymnext-muted/25 bg-gymnext-background/40 p-3"
                aria-labelledby={`today-${sectionKey}`}
              >
                <div className="relative mb-2 flex items-start justify-between gap-2">
                  <h3
                    id={`today-${sectionKey}`}
                    className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wide text-gray-500"
                  >
                    {plan.workoutPlanName}
                  </h3>
                  {showPlanMenu ? (
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() => setPlanMenuOpenKey((k) => (k === sectionKey ? null : sectionKey))}
                        className="rounded p-1 text-gray-500 hover:bg-white/80 hover:text-gray-700"
                        aria-label={`More options for ${plan.workoutPlanName}`}
                        aria-expanded={planMenuOpenKey === sectionKey}
                      >
                        ⋯
                      </button>
                      {planMenuOpenKey === sectionKey && (
                        <>
                          <div
                            className="fixed inset-0 z-40"
                            aria-hidden
                            onClick={() => setPlanMenuOpenKey(null)}
                          />
                          <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                              onClick={() => {
                                setPlanMenuOpenKey(null)
                                if (isOwned) {
                                  onOpenPlanAhead?.({ kind: 'owned', planId: plan.id })
                                } else {
                                  const subscriptionDocumentId = sectionKey.slice('followed-'.length)
                                  onOpenPlanAhead?.({
                                    kind: 'followed',
                                    subscriptionDocumentId,
                                  })
                                }
                              }}
                            >
                              {isOwned ? 'Plan ahead' : 'Look ahead'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
                {workouts.length === 0 ? (
                  <p className="rounded-md border border-dashed border-gymnext-muted/40 bg-white/80 px-3 py-4 text-center text-sm text-gray-500">
                    Rest Day
                  </p>
                ) : (
                  <ul className="min-w-0 space-y-2">
                    {workouts.map((pw) => {
                      const w = pw.workout
                      const barColor = getWorkoutBarColor(w)
                      const userDetails = trimWorkoutDetailsForPreview(w)
                      return (
                        <li key={pw.id}>
                          <article
                            className="flex items-stretch gap-3 overflow-hidden rounded-lg border border-gymnext-muted/40 bg-white shadow-sm"
                            aria-label={getWorkoutDisplayName(w) || 'Workout'}
                          >
                            <span
                              className="w-1 shrink-0 self-stretch min-h-[3rem]"
                              style={{ backgroundColor: barColor }}
                              aria-hidden
                            />
                            <div className="min-w-0 flex-1 py-3 pr-3">
                              <p className="text-sm font-medium leading-snug text-gray-900">
                                {getWorkoutDisplayName(w) || 'Workout'}
                              </p>
                              <p className="mt-0.5 text-sm text-gray-600 break-words">
                                {getWorkoutDetailDescription(w) || '—'}
                              </p>
                              {userDetails !== '' && <TodayWorkoutUserDetails details={userDetails} />}
                            </div>
                          </article>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )})}
          </div>
        )}
      </div>
    </div>
  )
}
