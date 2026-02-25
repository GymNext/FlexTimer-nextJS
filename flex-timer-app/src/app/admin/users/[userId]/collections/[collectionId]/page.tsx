'use client'

import { useState, useEffect } from 'react'
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
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-sm font-medium text-gray-700">Workouts in this collection ({workouts.length})</h2>
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
    </div>
  )
}
