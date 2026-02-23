'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { auth } from '@/lib/firebase'
import type { AdminUserProfile, Workout } from '@/types/user'

export default function AdminUserProfilePage() {
  const params = useParams()
  const userId = params.userId as string
  const [profile, setProfile] = useState<AdminUserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedCollectionId, setExpandedCollectionId] = useState<string | null>(null)
  const [workoutsByCollectionId, setWorkoutsByCollectionId] = useState<Record<string, Workout[]>>({})
  const [loadingWorkoutsFor, setLoadingWorkoutsFor] = useState<string | null>(null)

  const fetchWorkoutsForCollection = useCallback(
    async (collectionId: string, workoutIds: string[]) => {
      if (workoutIds.length === 0) {
        setWorkoutsByCollectionId((prev) => ({ ...prev, [collectionId]: [] }))
        return
      }
      setLoadingWorkoutsFor(collectionId)
      const user = auth.currentUser
      if (!user) return
      try {
        const token = await user.getIdToken()
        const ids = workoutIds.map((id) => encodeURIComponent(id)).join(',')
        const res = await fetch(
          `/api/admin/users/${encodeURIComponent(userId)}/workouts?ids=${ids}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!res.ok) throw new Error((await res.json()).error || res.statusText)
        const data = await res.json()
        setWorkoutsByCollectionId((prev) => ({ ...prev, [collectionId]: data.workouts ?? [] }))
      } catch {
        setWorkoutsByCollectionId((prev) => ({ ...prev, [collectionId]: [] }))
      } finally {
        setLoadingWorkoutsFor(null)
      }
    },
    [userId]
  )

  useEffect(() => {
    if (!expandedCollectionId || !profile) return
    if (workoutsByCollectionId[expandedCollectionId] !== undefined) return
    const coll = (profile.workoutCollections ?? []).find((c) => c.id === expandedCollectionId)
    if (coll) fetchWorkoutsForCollection(expandedCollectionId, coll.workoutIds)
  }, [expandedCollectionId, profile, workoutsByCollectionId, fetchWorkoutsForCollection])

  const toggleCollectionExpand = useCallback((coll: { id: string }) => {
    setExpandedCollectionId((prev) => (prev === coll.id ? null : coll.id))
  }, [])

  useEffect(() => {
    let cancelled = false
    const user = auth.currentUser
    if (!user || !userId) {
      setLoading(false)
      return
    }
    user
      .getIdToken()
      .then((token) =>
        fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      )
      .then((res) => {
        if (cancelled) return res
        if (!res.ok) return res.json().then((d) => Promise.reject(new Error(d.error || res.statusText)))
        return res.json()
      })
      .then((data) => {
        if (!cancelled) setProfile(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load profile')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  if (loading) {
    return <p className="text-gray-500">Loading profile…</p>
  }

  if (error || !profile) {
    return (
      <div className="space-y-4">
        <div className="rounded bg-red-50 p-3 text-sm text-red-700">
          {error ?? 'User not found'}
        </div>
        <Link href="/admin" className="text-blue-600 hover:text-blue-800">
          ← Back to users
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin" className="text-sm text-blue-600 hover:text-blue-800 mb-2 inline-block">
          ← Back to users
        </Link>
        <h1 className="text-xl font-semibold text-gray-900">User profile</h1>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-sm font-medium text-gray-700">Auth record</h2>
        </div>
        <dl className="divide-y divide-gray-200">
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">User ID</dt>
            <dd className="mt-1 text-sm text-gray-900 font-mono sm:col-span-2">{profile.uid}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Email</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{profile.email ?? '—'}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Display name</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{profile.displayName ?? '—'}</dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Email verified</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">
              {profile.emailVerified ? 'Yes' : 'No'}
            </dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Disabled</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">
              {profile.disabled ? 'Yes' : 'No'}
            </dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Created</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">
              {profile.metadata.creationTime
                ? new Date(profile.metadata.creationTime).toLocaleString()
                : '—'}
            </dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Last sign-in</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">
              {profile.metadata.lastSignInTime
                ? new Date(profile.metadata.lastSignInTime).toLocaleString()
                : '—'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-sm font-medium text-gray-700">Firestore data (users/{profile.uid})</h2>
        </div>
        <dl className="divide-y divide-gray-200">
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Workouts</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{profile.dataCounts.workouts}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-sm font-medium text-gray-700">
            Workout collections ({(profile.workoutCollections ?? []).length})
          </h2>
        </div>
        {(profile.workoutCollections ?? []).length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">No workout collections.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-10 px-2 py-2" aria-label="Expand" />
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Name
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Collection ID
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Share ID
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Ordinal
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Workouts
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {(profile.workoutCollections ?? []).map((coll) => (
                  <React.Fragment key={coll.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="w-10 px-2 py-3">
                        {coll.workoutIds.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => toggleCollectionExpand(coll)}
                            className="text-gray-500 hover:text-gray-700"
                            aria-expanded={expandedCollectionId === coll.id}
                            title={expandedCollectionId === coll.id ? 'Collapse' : 'View workouts'}
                          >
                            {expandedCollectionId === coll.id ? (
                              <span className="inline-block rotate-90">▶</span>
                            ) : (
                              <span>▶</span>
                            )}
                          </button>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {coll.workoutCollectionName}
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-600">
                        {coll.workoutCollectionId}
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-600">
                        {coll.workoutCollectionShareId}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{coll.ordinal}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{coll.workoutIds.length}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {coll.workoutCollectionDescription ?? '—'}
                      </td>
                    </tr>
                    {expandedCollectionId === coll.id && (
                      <tr key={`${coll.id}-workouts`}>
                        <td colSpan={7} className="bg-gray-50 p-4">
                          {loadingWorkoutsFor === coll.id ? (
                            <p className="text-sm text-gray-500">Loading workouts…</p>
                          ) : (
                            <div className="overflow-x-auto rounded border border-gray-200 bg-white">
                              <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-100">
                                  <tr>
                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                                      Type
                                    </th>
                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                                      Workout ID
                                    </th>
                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                                      Share ID
                                    </th>
                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                                      Name
                                    </th>
                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                                      Description
                                    </th>
                                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                                      Deleted
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                  {(workoutsByCollectionId[coll.id] ?? []).length === 0 ? (
                                    <tr>
                                      <td colSpan={6} className="px-3 py-4 text-sm text-gray-500">
                                        No workouts in this collection.
                                      </td>
                                    </tr>
                                  ) : (
                                    (workoutsByCollectionId[coll.id] ?? []).map((w) => (
                                      <tr key={w.id} className="bg-white">
                                        <td className="px-3 py-2 text-sm text-gray-900">
                                          {w.type}
                                        </td>
                                        <td className="px-3 py-2 text-sm font-mono text-gray-600">
                                          {w.workoutId}
                                        </td>
                                        <td className="px-3 py-2 text-sm font-mono text-gray-600">
                                          {w.workoutShareId}
                                        </td>
                                        <td className="px-3 py-2 text-sm text-gray-600">
                                          {w.workoutName ?? '—'}
                                        </td>
                                        <td className="px-3 py-2 text-sm text-gray-600">
                                          {w.workoutDescription ?? '—'}
                                        </td>
                                        <td className="px-3 py-2 text-sm text-gray-600">
                                          {w.deletedAt ? (
                                            <span className="text-amber-600">
                                              {new Date(w.deletedAt).toLocaleString()}
                                            </span>
                                          ) : (
                                            '—'
                                          )}
                                        </td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(profile.deletedWorkoutCollectionsCount ?? 0) > 0 && (
          <div className="flex justify-end px-4 py-2 border-t border-gray-200 bg-gray-50">
            <span className="text-sm text-gray-500">
              {profile.deletedWorkoutCollectionsCount} deleted collection{profile.deletedWorkoutCollectionsCount === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-sm font-medium text-gray-700">
            Workout plans ({(profile.workoutPlans ?? []).length})
          </h2>
        </div>
        {(profile.workoutPlans ?? []).length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">No workout plans.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Name
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Plan ID
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Ordinal
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Personal
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {(profile.workoutPlans ?? []).map((plan) => (
                  <tr key={plan.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {plan.workoutPlanName}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-600">
                      {plan.workoutPlanId}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{plan.ordinal}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {plan.isPersonal ? 'Yes' : 'No'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {plan.workoutPlanDescription ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(profile.deletedWorkoutPlansCount ?? 0) > 0 && (
          <div className="flex justify-end px-4 py-2 border-t border-gray-200 bg-gray-50">
            <span className="text-sm text-gray-500">
              {profile.deletedWorkoutPlansCount} deleted plan{profile.deletedWorkoutPlansCount === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
