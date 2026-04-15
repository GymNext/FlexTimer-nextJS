'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import type { WorkoutCollection } from '@/types/user'
import { UNLIMITED } from '@/lib/subscription-limits-constants'

export type DuplicateSharedWorkoutContext = {
  ownerUserId: string
  sourceWorkoutId: string
  groupId: string
}

function collectionRowLabel(c: WorkoutCollection): string {
  if (c.id === 'favorite') return 'Favorites'
  if (c.id === 'import') return 'Imports'
  return c.workoutCollectionName?.trim() || c.id
}

export function DuplicateSharedWorkoutDialog({
  open,
  onClose,
  viewer,
  context,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  viewer: User
  context: DuplicateSharedWorkoutContext | null
  onSuccess?: () => void
}) {
  const [step, setStep] = useState<'confirm' | 'collections'>('confirm')
  const [collections, setCollections] = useState<WorkoutCollection[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loadingOverview, setLoadingOverview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [favoritesFull, setFavoritesFull] = useState(false)

  const reset = useCallback(() => {
    setStep('confirm')
    setCollections([])
    setSelected(new Set())
    setLoadingOverview(false)
    setSubmitting(false)
    setError(null)
    setFavoritesFull(false)
  }, [])

  useEffect(() => {
    if (!open) {
      reset()
      return
    }
    setStep('confirm')
    setSelected(new Set())
    setError(null)
  }, [open, context?.ownerUserId, context?.sourceWorkoutId, reset])

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true)
    setError(null)
    try {
      const token = await viewer.getIdToken()
      const res = await fetch('/api/app/overview', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        workoutCollections?: WorkoutCollection[]
        subscriptionLimits?: { maxFavorites: number }
        counts?: { favorites?: number }
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const cols = Array.isArray(data.workoutCollections) ? data.workoutCollections : []
      setCollections(cols)
      const maxFav = typeof data.subscriptionLimits?.maxFavorites === 'number' ? data.subscriptionLimits.maxFavorites : 5
      const favCount = typeof data.counts?.favorites === 'number' ? data.counts.favorites : 0
      setFavoritesFull(maxFav < UNLIMITED && favCount >= maxFav)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load library')
    } finally {
      setLoadingOverview(false)
    }
  }, [viewer])

  const onContinueFromConfirm = useCallback(() => {
    setStep('collections')
    void loadOverview()
  }, [loadOverview])

  const toggleCollection = useCallback(
    (id: string) => {
      if (id === 'favorite' && favoritesFull) return
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },
    [favoritesFull]
  )

  const onSave = useCallback(async () => {
    if (!context || selected.size === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const token = await viewer.getIdToken()
      const body: Record<string, unknown> = {
        ownerUserId: context.ownerUserId,
        sourceWorkoutId: context.sourceWorkoutId,
        collectionIds: [...selected],
      }
      if (context.groupId.trim()) body.groupId = context.groupId.trim()
      const res = await fetch('/api/app/workouts/duplicate-from-share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      onSuccess?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save copy')
    } finally {
      setSubmitting(false)
    }
  }, [context, selected, viewer, onClose, onSuccess])

  if (!open || !context) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden onClick={() => !submitting && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dup-workout-title"
        className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-xl overflow-hidden"
      >
        <div className="border-b border-gymnext-muted/30 px-4 py-3 flex items-center justify-between">
          <h2 id="dup-workout-title" className="text-sm font-semibold text-gray-900">
            {step === 'confirm' ? 'Duplicate workout to library' : 'Choose collections'}
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

        <div className="p-4 max-h-[min(70vh,24rem)] overflow-y-auto">
          {error && (
            <p className="text-sm text-red-600 mb-3" role="alert">
              {error}
            </p>
          )}

          {step === 'confirm' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-700 leading-relaxed">
                This will make a copy of the current state of the workout. Any future changes to the original
                will not be reflected in your copy.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="rounded-md border border-gymnext-muted/40 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                  style={{ backgroundColor: '#6B21A8' }}
                  onClick={onContinueFromConfirm}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 'collections' && (
            <div className="space-y-3">
              {loadingOverview && <p className="text-sm text-gray-500">Loading your library…</p>}
              {!loadingOverview && collections.length === 0 && (
                <p className="text-sm text-gray-500">No collections found.</p>
              )}
              {!loadingOverview &&
                collections.map((c) => {
                  const checked = selected.has(c.id)
                  const disabled = c.id === 'favorite' && favoritesFull && !checked
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-2 rounded-md border border-gymnext-muted/30 px-3 py-2 text-sm ${
                        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gymnext-background/50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="rounded border-gymnext-muted/50"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleCollection(c.id)}
                      />
                      <span className="text-gray-900">{collectionRowLabel(c)}</span>
                      {c.id === 'favorite' && favoritesFull && (
                        <span className="text-xs text-amber-700 ml-auto">Favorites full</span>
                      )}
                    </label>
                  )
                })}
              <div className="flex justify-between gap-2 pt-3 border-t border-gymnext-muted/25">
                <button
                  type="button"
                  className="rounded-md border border-gymnext-muted/40 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                  disabled={submitting}
                  onClick={() => {
                    setStep('confirm')
                    setError(null)
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6B21A8' }}
                  disabled={submitting || selected.size === 0 || loadingOverview}
                  onClick={() => void onSave()}
                >
                  {submitting ? 'Saving…' : 'Save copy'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
