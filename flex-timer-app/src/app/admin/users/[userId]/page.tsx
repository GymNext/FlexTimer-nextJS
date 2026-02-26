'use client'

import React, { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase'
import type { AdminUserProfile } from '@/types/user'
import { getSubscriptionPlanLabel } from '@/types/user'
import { getWorkoutDisplayName, getWorkoutDisplayDescription } from '@/lib/json-workout-format'
import { USER_SETTINGS_SECTIONS, getSectionSubgroupsWithRows } from '@/lib/user-settings-sections'

export default function AdminUserProfilePage() {
  const params = useParams()
  const router = useRouter()
  const userId = params.userId as string
  const [profile, setProfile] = useState<AdminUserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<'collection' | 'plan' | null>(null)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [expandedSettingsSection, setExpandedSettingsSection] = useState<string | null>(null)

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

  const openCollectionModal = () => {
    setModal('collection')
    setFormName('')
    setFormDescription('')
    setSubmitError(null)
  }
  const openPlanModal = () => {
    setModal('plan')
    setFormName('')
    setFormDescription('')
    setSubmitError(null)
  }
  const closeModal = () => {
    setModal(null)
    setFormName('')
    setFormDescription('')
    setSubmitError(null)
  }

  const sortedCollections = useMemo(
    () => [...(profile?.workoutCollections ?? [])].sort((a, b) => a.ordinal - b.ordinal),
    [profile?.workoutCollections]
  )
  const sortedPlans = useMemo(
    () => [...(profile?.workoutPlans ?? [])].sort((a, b) => a.ordinal - b.ordinal),
    [profile?.workoutPlans]
  )

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault()
    const user = auth.currentUser
    if (!user || !userId || !formName.trim()) return
    setSubmitError(null)
    setSubmitting(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: formName.trim(), description: formDescription.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? res.statusText)
      const id = data.id
      closeModal()
      const t = await user.getIdToken()
      const profileRes = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${t}` },
      })
      if (profileRes.ok) setProfile(await profileRes.json())
      if (id) router.push(`/admin/users/${userId}/collections/${encodeURIComponent(id)}`)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to create collection')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault()
    const user = auth.currentUser
    if (!user || !userId || !formName.trim()) return
    setSubmitError(null)
    setSubmitting(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: formName.trim(), description: formDescription.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? res.statusText)
      const id = data.id
      closeModal()
      const t = await user.getIdToken()
      const profileRes = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${t}` },
      })
      if (profileRes.ok) setProfile(await profileRes.json())
      if (id) router.push(`/admin/users/${userId}/plans/${encodeURIComponent(id)}`)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to create plan')
    } finally {
      setSubmitting(false)
    }
  }

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

      {/* Profile card: photo left, name/email center, subscription pill right */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="px-6 py-6 flex flex-wrap gap-6 items-center">
          <div className="flex-shrink-0">
            {profile.photoURL ? (
              <img
                src={profile.photoURL}
                alt=""
                className="h-28 w-28 rounded-full object-cover ring-2 ring-gray-200"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="h-28 w-28 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-3xl font-medium">
                {(profile.firstName?.[0] ?? profile.displayName?.[0] ?? profile.email?.[0] ?? '?').toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">
              {[profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
                profile.displayName ||
                profile.email ||
                '—'}
            </h2>
            {profile.displayName && (profile.firstName || profile.lastName) && (
              <p className="text-sm text-gray-500">Display name: {profile.displayName}</p>
            )}
            <p className="text-gray-700">
              <a
                href={profile.email ? `mailto:${profile.email}` : undefined}
                className="text-indigo-600 hover:text-indigo-800"
              >
                {profile.email ?? '—'}
              </a>
            </p>
          </div>
          <div className="flex-shrink-0">
            <span className="inline-flex items-center rounded-full px-5 py-2.5 text-lg font-semibold bg-indigo-100 text-indigo-800">
              {getSubscriptionPlanLabel(profile.subscriptionPlan)}
            </span>
          </div>
        </div>
      </div>

      {/* Account / system details */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">Account details</h2>
        </div>
        <dl className="divide-y divide-gray-200">
          <div className="px-4 py-2.5 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">User ID</dt>
            <dd className="mt-0.5 text-sm text-gray-900 font-mono sm:col-span-2">{profile.uid}</dd>
          </div>
          <div className="px-4 py-2.5 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Email verified</dt>
            <dd className="mt-0.5 text-sm text-gray-900 sm:col-span-2">
              {profile.emailVerified ? 'Yes' : 'No'}
            </dd>
          </div>
          <div className="px-4 py-2.5 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Disabled</dt>
            <dd className="mt-0.5 text-sm text-gray-900 sm:col-span-2">
              {profile.disabled ? 'Yes' : 'No'}
            </dd>
          </div>
          <div className="px-4 py-2.5 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Created</dt>
            <dd className="mt-0.5 text-sm text-gray-900 sm:col-span-2">
              {profile.metadata.creationTime
                ? new Date(profile.metadata.creationTime).toLocaleString()
                : '—'}
            </dd>
          </div>
          <div className="px-4 py-2.5 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Last sign-in</dt>
            <dd className="mt-0.5 text-sm text-gray-900 sm:col-span-2">
              {profile.metadata.lastSignInTime
                ? new Date(profile.metadata.lastSignInTime).toLocaleString()
                : '—'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">User Settings</h2>
        </div>
        <div className="divide-y divide-gray-200">
          {USER_SETTINGS_SECTIONS.map((section) => {
            const isExpanded = expandedSettingsSection === section.id
            const subgroupsWithRows = getSectionSubgroupsWithRows(profile.settings, section)
            return (
              <div key={section.id}>
                <button
                  type="button"
                  onClick={() => setExpandedSettingsSection(isExpanded ? null : section.id)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  <span className="font-medium">{section.title}</span>
                  <span className="text-gray-400" aria-hidden>{isExpanded ? '▼' : '▶'}</span>
                </button>
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50/50 max-w-4xl">
                    {subgroupsWithRows.map((subgroup) => (
                      <div key={subgroup.title} className="border-b border-gray-100 last:border-b-0">
                        <h3 className="px-4 pt-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                          {subgroup.title}
                        </h3>
                        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 px-4 pb-3">
                          {subgroup.rows.map((row) => (
                            <div key={row.key} className="min-w-0">
                              <dt className="text-sm font-medium text-gray-500 truncate" title={row.label}>{row.label}</dt>
                              <dd className="text-sm text-gray-900 font-mono break-all">{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {(!profile.settings || Object.keys(profile.settings).length === 0) && (
          <p className="px-4 py-3 text-sm text-gray-500 border-t border-gray-200">No settings stored for this user.</p>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-sm font-medium text-gray-700">
            Workout collections ({sortedCollections.length})
          </h2>
        </div>
        {sortedCollections.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">No workout collections.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Name
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
                {sortedCollections.map((coll) => (
                  <tr key={coll.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium">
                      <Link
                        href={`/admin/users/${userId}/collections/${encodeURIComponent(coll.id)}`}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        {coll.workoutCollectionName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{coll.workoutIds.length}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {coll.workoutCollectionDescription ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-3 border-t border-gray-200">
          <button
            type="button"
            onClick={openCollectionModal}
            className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Create collection
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-sm font-medium text-gray-700">
            Workout plans ({sortedPlans.length})
          </h2>
        </div>
        {sortedPlans.length === 0 ? (
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
                    Personal
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {sortedPlans.map((plan) => (
                  <tr key={plan.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium">
                      <Link
                        href={`/admin/users/${userId}/plans/${encodeURIComponent(plan.id)}`}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        {plan.workoutPlanName}
                      </Link>
                    </td>
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
        <div className="px-4 py-3 border-t border-gray-200">
          <button
            type="button"
            onClick={openPlanModal}
            className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Create plan
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-sm font-medium text-gray-700">Deleted data</h2>
        </div>
        <div className="divide-y divide-gray-200">
          <div className="px-4 py-3">
            <h3 className="text-xs font-medium uppercase text-gray-500 mb-2">
              Deleted workouts ({(profile.deletedWorkouts ?? []).length})
            </h3>
            {(profile.deletedWorkouts ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">No deleted workouts.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Description</th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Deleted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {(profile.deletedWorkouts ?? []).map((w) => (
                      <tr key={w.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium">
                          <Link
                            href={`/admin/users/${userId}/workouts/${encodeURIComponent(w.id)}`}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            {getWorkoutDisplayName(w) || '—'}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {getWorkoutDisplayDescription(w) || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-amber-600">
                          {w.deletedAt ? new Date(w.deletedAt).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="px-4 py-3">
            <h3 className="text-xs font-medium uppercase text-gray-500 mb-2">
              Deleted workout collections ({(profile.deletedWorkoutCollections ?? []).length})
            </h3>
            {(profile.deletedWorkoutCollections ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">No deleted workout collections.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Deleted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {(profile.deletedWorkoutCollections ?? []).map((coll) => (
                      <tr key={coll.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium">
                          <Link
                            href={`/admin/users/${userId}/collections/${encodeURIComponent(coll.id)}`}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            {coll.workoutCollectionName}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm text-amber-600">
                          {coll.deletedAt ? new Date(coll.deletedAt).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="px-4 py-3">
            <h3 className="text-xs font-medium uppercase text-gray-500 mb-2">
              Deleted workout plans ({(profile.deletedWorkoutPlans ?? []).length})
            </h3>
            {(profile.deletedWorkoutPlans ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">No deleted workout plans.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Deleted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {(profile.deletedWorkoutPlans ?? []).map((plan) => (
                      <tr key={plan.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium">
                          <Link
                            href={`/admin/users/${userId}/plans/${encodeURIComponent(plan.id)}`}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            {plan.workoutPlanName}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm text-amber-600">
                          {plan.deletedAt ? new Date(plan.deletedAt).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {modal === 'collection' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" aria-hidden onClick={closeModal} />
          <div className="relative w-full max-w-md rounded-lg bg-white shadow-xl p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">New workout collection</h3>
            <form onSubmit={handleCreateCollection} className="space-y-4">
              <div>
                <label htmlFor="coll-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Name
                </label>
                <input
                  id="coll-name"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  placeholder="Collection name"
                />
              </div>
              <div>
                <label htmlFor="coll-desc" className="block text-sm font-medium text-gray-700 mb-1">
                  Description (optional)
                </label>
                <textarea
                  id="coll-desc"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={3}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  placeholder="Description"
                />
              </div>
              {submitError && (
                <p className="text-sm text-red-600">{submitError}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {submitting ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modal === 'plan' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" aria-hidden onClick={closeModal} />
          <div className="relative w-full max-w-md rounded-lg bg-white shadow-xl p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">New workout plan</h3>
            <form onSubmit={handleCreatePlan} className="space-y-4">
              <div>
                <label htmlFor="plan-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Name
                </label>
                <input
                  id="plan-name"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  placeholder="Plan name"
                />
              </div>
              <div>
                <label htmlFor="plan-desc" className="block text-sm font-medium text-gray-700 mb-1">
                  Description (optional)
                </label>
                <textarea
                  id="plan-desc"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={3}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  placeholder="Description"
                />
              </div>
              {submitError && (
                <p className="text-sm text-red-600">{submitError}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {submitting ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
