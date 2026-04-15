'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'

export type DuplicateSharedCollectionContext = {
  ownerUserId: string
  sourceCollectionId: string
  groupId: string
}

export function DuplicateSharedCollectionDialog({
  open,
  onClose,
  viewer,
  context,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  viewer: User
  context: DuplicateSharedCollectionContext | null
  onSuccess?: (detail: { skippedWorkoutCount: number }) => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setSubmitting(false)
    setError(null)
  }, [])

  useEffect(() => {
    if (!open) {
      reset()
      return
    }
    setError(null)
  }, [open, context?.ownerUserId, context?.sourceCollectionId, reset])

  const onDuplicate = useCallback(async () => {
    if (!context) return
    setSubmitting(true)
    setError(null)
    try {
      const token = await viewer.getIdToken()
      const body: Record<string, unknown> = {
        ownerUserId: context.ownerUserId,
        sourceCollectionId: context.sourceCollectionId,
      }
      if (context.groupId.trim()) body.groupId = context.groupId.trim()
      const res = await fetch('/api/app/collections/duplicate-from-share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        skippedWorkoutCount?: number
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const skipped =
        typeof data.skippedWorkoutCount === 'number' && data.skippedWorkoutCount > 0
          ? data.skippedWorkoutCount
          : 0
      onSuccess?.({ skippedWorkoutCount: skipped })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not copy collection')
    } finally {
      setSubmitting(false)
    }
  }, [context, viewer, onClose, onSuccess])

  const handleClose = useCallback(() => {
    if (submitting) return
    onClose()
  }, [submitting, onClose])

  if (!open || !context) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden onClick={handleClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dup-coll-title"
        className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-xl overflow-hidden"
      >
        <div className="border-b border-gymnext-muted/30 px-4 py-3 flex items-center justify-between">
          <h2 id="dup-coll-title" className="text-sm font-semibold text-gray-900">
            Duplicate collection to library
          </h2>
          <button
            type="button"
            className="text-gray-500 hover:text-gray-800 px-2 text-lg leading-none"
            aria-label="Close"
            disabled={submitting}
            onClick={handleClose}
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

          <div className="space-y-4">
            <p className="text-sm text-gray-700 leading-relaxed">
              This will copy the collection and all of its workouts as they are right now. The copy is added to
              your library as a new collection. Any future changes on the original will not appear in your copy.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="rounded-md border border-gymnext-muted/40 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                disabled={submitting}
                onClick={handleClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#6B21A8' }}
                disabled={submitting}
                onClick={() => void onDuplicate()}
              >
                {submitting ? 'Continuing…' : 'Continue'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
