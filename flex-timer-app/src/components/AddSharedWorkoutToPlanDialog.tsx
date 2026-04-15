'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import type { Workout, WorkoutPlan } from '@/types/user'
import { workoutToPlanDayEntry } from '@/lib/workout-to-plan-day-entry'
import { SUBSCRIPTION_TIER, type SubscriptionTier } from '@/lib/subscription-limits-constants'

export function AddSharedWorkoutToPlanDialog({
  open,
  onClose,
  viewer,
  workout,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  viewer: User
  workout: Workout | null
  onSuccess?: () => void
}) {
  const [plans, setPlans] = useState<WorkoutPlan[]>([])
  const [tier, setTier] = useState<SubscriptionTier>(SUBSCRIPTION_TIER.basic)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [planId, setPlanId] = useState('')
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10))

  const clientToday = new Date().toISOString().slice(0, 10)

  const reset = useCallback(() => {
    setPlans([])
    setTier(SUBSCRIPTION_TIER.basic)
    setLoading(false)
    setSubmitting(false)
    setError(null)
    setPlanId('')
    setDay(clientToday)
  }, [clientToday])

  useEffect(() => {
    if (!open) {
      reset()
      return
    }
    if (!workout) return
    setError(null)
    setDay(clientToday)
    setLoading(true)
    ;(async () => {
      try {
        const token = await viewer.getIdToken()
        const res = await fetch('/api/app/overview', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
          workoutPlans?: WorkoutPlan[]
          subscriptionLimits?: { tier?: SubscriptionTier }
        }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        const list = (Array.isArray(data.workoutPlans) ? data.workoutPlans : []).filter((p) => !p.deletedAt)
        setPlans(list)
        if (typeof data.subscriptionLimits?.tier === 'string') {
          setTier(data.subscriptionLimits.tier)
        }
        if (list.length > 0) {
          setPlanId((prev) => (prev && list.some((p) => p.id === prev) ? prev : list[0].id))
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load plans')
      } finally {
        setLoading(false)
      }
    })()
  }, [open, workout, viewer, clientToday, reset])

  const canPickFutureDay = tier === SUBSCRIPTION_TIER.pro

  const onSubmit = useCallback(async () => {
    if (!workout || !planId) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setError('Pick a valid date.')
      return
    }
    if (day > clientToday && !canPickFutureDay) {
      setError('Upgrade to Pro to plan for future dates.')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const token = await viewer.getIdToken()
      const rangeRes = await fetch(
        `/api/app/plans/${encodeURIComponent(planId)}/planned-workouts?from=${encodeURIComponent(day)}&to=${encodeURIComponent(day)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const rangeData = (await rangeRes.json().catch(() => ({}))) as {
        error?: string
        plannedWorkouts?: { id: string }[]
      }
      if (!rangeRes.ok) throw new Error(rangeData.error || `HTTP ${rangeRes.status}`)
      const ordinal = Array.isArray(rangeData.plannedWorkouts) ? rangeData.plannedWorkouts.length : 0

      const res = await fetch(`/api/app/plans/${encodeURIComponent(planId)}/planned-workouts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          day,
          ordinal,
          workout: workoutToPlanDayEntry(workout),
          sourceWorkoutId: null,
          clientToday,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      onSuccess?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add to plan')
    } finally {
      setSubmitting(false)
    }
  }, [workout, planId, day, clientToday, canPickFutureDay, viewer, onClose, onSuccess])

  if (!open || !workout) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden onClick={() => !submitting && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-shared-plan-title"
        className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-xl overflow-hidden"
      >
        <div className="border-b border-gymnext-muted/30 px-4 py-3 flex items-center justify-between">
          <h2 id="add-shared-plan-title" className="text-sm font-semibold text-gray-900">
            Add workout to plan
          </h2>
          <button
            type="button"
            className="text-gray-500 hover:text-gray-800 px-2 text-lg leading-none"
            aria-label="Close"
            disabled={submitting}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-4">
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          {loading && <p className="text-sm text-gray-500">Loading plans…</p>}
          {!loading && plans.length === 0 && (
            <p className="text-sm text-gray-500">You do not have any plans yet. Create a plan in the Planning tab.</p>
          )}
          {!loading && plans.length > 0 && (
            <>
              <div>
                <label htmlFor="shared-add-plan" className="block text-xs font-semibold text-gray-500 mb-1">
                  Plan
                </label>
                <select
                  id="shared-add-plan"
                  className="w-full rounded-md border border-gymnext-muted/40 px-2 py-1.5 text-sm"
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.workoutPlanName?.trim() || p.id}
                      {p.isPersonal ? ' (personal)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="shared-add-day" className="block text-xs font-semibold text-gray-500 mb-1">
                  Day
                </label>
                <input
                  id="shared-add-day"
                  type="date"
                  className="w-full rounded-md border border-gymnext-muted/40 px-2 py-1.5 text-sm"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />
                {!canPickFutureDay && (
                  <p className="text-xs text-gray-500 mt-1">Future dates require a Pro subscription.</p>
                )}
              </div>
              <p className="text-xs text-gray-500">
                This adds a snapshot of the workout to your schedule. It is not linked to the shared original.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="rounded-md border border-gymnext-muted/40 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                  disabled={submitting}
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                  disabled={submitting || !planId}
                  onClick={() => void onSubmit()}
                >
                  {submitting ? 'Adding…' : 'Add to plan'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
