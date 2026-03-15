'use client'

import React, { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase'
import type { AdminUserProfile } from '@/types/user'
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
  const [changingToClassic, setChangingToClassic] = useState(false)
  const [classicChangeError, setClassicChangeError] = useState<string | null>(null)
  const [changingToBasic, setChangingToBasic] = useState(false)
  const [basicChangeError, setBasicChangeError] = useState<string | null>(null)
  const [deletingUser, setDeletingUser] = useState(false)
  const [deleteUserError, setDeleteUserError] = useState<string | null>(null)

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
  const favoritesCollection = useMemo(
    () => sortedCollections.find((c) => c.id === 'favorite'),
    [sortedCollections]
  )
  const favoriteWorkouts = useMemo(() => {
    if (!profile?.workouts || !favoritesCollection) return []
    const byId = new Map(profile.workouts.map((w) => [w.id, w]))
    return favoritesCollection.workoutIds.map((id) => byId.get(id)).filter(Boolean) as typeof profile.workouts
  }, [profile?.workouts, favoritesCollection])
  const collectionsExcludingFavorites = useMemo(
    () => sortedCollections.filter((c) => c.id !== 'favorite'),
    [sortedCollections]
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

  const handleChangeToClassic = async () => {
    const user = auth.currentUser
    if (!user || !userId) return
    setClassicChangeError(null)
    setChangingToClassic(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/classic`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? res.statusText)

      const t = await user.getIdToken()
      const profileRes = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${t}` },
      })
      if (profileRes.ok) setProfile(await profileRes.json())
    } catch (e) {
      setClassicChangeError(e instanceof Error ? e.message : 'Failed to change to Classic')
    } finally {
      setChangingToClassic(false)
    }
  }

  const handleChangeToBasic = async () => {
    const user = auth.currentUser
    if (!user || !userId) return
    setBasicChangeError(null)
    setChangingToBasic(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/basic`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? res.statusText)

      const t = await user.getIdToken()
      const profileRes = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${t}` },
      })
      if (profileRes.ok) setProfile(await profileRes.json())
    } catch (e) {
      setBasicChangeError(e instanceof Error ? e.message : 'Failed to change to Basic')
    } finally {
      setChangingToBasic(false)
    }
  }

  const handleDeleteUser = async () => {
    if (
      !window.confirm(
        `Are you sure you want to delete this user? They will no longer be able to sign in. This cannot be undone.`
      )
    ) {
      return
    }
    const user = auth.currentUser
    if (!user || !userId) return
    setDeleteUserError(null)
    setDeletingUser(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? res.statusText)
      router.push('/admin')
    } catch (e) {
      setDeleteUserError(e instanceof Error ? e.message : 'Failed to delete user')
    } finally {
      setDeletingUser(false)
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
          <div className="flex-shrink-0 flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-3">
              {/* Pill 1: Connected / Standalone */}
              <span className="inline-flex items-center rounded-full px-5 py-2.5 text-lg font-medium bg-slate-100 text-slate-700">
                {profile.connectedUserDisplay ?? '—'}
              </span>

              {/* Pill 2: No Display / Single Display / Multi Display (only when Connected User) */}
              {profile.connectedUserDisplay === 'Connected User' && (
                <span
                  className={[
                    'inline-flex items-center rounded-full px-5 py-2.5 text-lg font-medium',
                    profile.userTypeDisplay === 'noDisplay' && 'bg-gray-100 text-gray-700',
                    profile.userTypeDisplay === 'singleDisplay' && 'bg-blue-100 text-blue-800',
                    profile.userTypeDisplay === 'multiDisplay' && 'bg-blue-100 text-blue-800 font-bold',
                    (!profile.userTypeDisplay ||
                      !['noDisplay', 'singleDisplay', 'multiDisplay'].includes(profile.userTypeDisplay)) &&
                      'bg-gray-100 text-gray-700',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {profile.userTypeDisplay === 'noDisplay' && 'No Display'}
                  {profile.userTypeDisplay === 'singleDisplay' && 'Single Display'}
                  {profile.userTypeDisplay === 'multiDisplay' && 'Multi Display'}
                  {(!profile.userTypeDisplay ||
                    !['noDisplay', 'singleDisplay', 'multiDisplay'].includes(profile.userTypeDisplay)) &&
                    (profile.userTypeDisplay ?? '—')}
                </span>
              )}

              {/* Pill 3: Subscription tier */}
              <span className="inline-flex items-center rounded-full px-5 py-2.5 text-lg font-semibold bg-indigo-100 text-indigo-800">
                {profile.subscriptionDisplayLabel ?? '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {profile.subscriptionDisplayLabel === 'Basic' && (
        <div className="flex justify-end">
          <div className="flex flex-col items-end gap-2">
            {classicChangeError && (
              <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
                {classicChangeError}
              </div>
            )}
            <button
              type="button"
              onClick={handleChangeToClassic}
              disabled={changingToClassic}
              className="inline-flex items-center rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {changingToClassic ? 'Changing…' : 'Change to Classic'}
            </button>
          </div>
        </div>
      )}

      {profile.subscriptionDisplayLabel === 'Classic' && (
        <div className="flex justify-end">
          <div className="flex flex-col items-end gap-2">
            {basicChangeError && (
              <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
                {basicChangeError}
              </div>
            )}
            <button
              type="button"
              onClick={handleChangeToBasic}
              disabled={changingToBasic}
              className="inline-flex items-center rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {changingToBasic ? 'Changing…' : 'Change to Basic'}
            </button>
          </div>
        </div>
      )}

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
          {(profile.mergedUserIds?.length ?? 0) > 0 && (
            <div className="px-4 py-2.5 sm:grid sm:grid-cols-3 sm:gap-4">
              <dt className="text-sm font-medium text-gray-500">Merged user IDs</dt>
              <dd className="mt-0.5 text-sm text-gray-900 sm:col-span-2">
                <ul className="list-disc list-inside space-y-1 font-mono">
                  {profile.mergedUserIds!.map((mergedId) => (
                    <li key={mergedId}>
                      <Link
                        href={`/admin/users/${encodeURIComponent(mergedId)}`}
                        className="text-indigo-600 hover:text-indigo-800"
                      >
                        {mergedId}
                      </Link>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
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

      {/* Favorites: workouts from the collection with id "favorite" */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-sm font-medium text-gray-700">
            Favorites{favoritesCollection != null ? ` (${favoriteWorkouts.length})` : ''}
          </h2>
        </div>
        {favoritesCollection == null ? (
          <p className="px-4 py-6 text-sm text-gray-500">No favorites collection.</p>
        ) : favoriteWorkouts.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">No workouts in favorites.</p>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {favoriteWorkouts.map((workout) => (
                  <tr key={workout.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium">
                      <Link
                        href={`/admin/users/${userId}/workouts/${encodeURIComponent(workout.id)}`}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        {getWorkoutDisplayName(workout)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {getWorkoutDisplayDescription(workout) ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {favoritesCollection != null && (
          <div className="px-4 py-3 border-t border-gray-200">
            <Link
              href={`/admin/users/${userId}/collections/${encodeURIComponent(favoritesCollection.id)}`}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              Open favorites collection →
            </Link>
          </div>
        )}
      </div>

      {/* Workout collections (excluding favorites, which is shown above) */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-sm font-medium text-gray-700">
            Workout collections ({collectionsExcludingFavorites.length})
          </h2>
        </div>
        {collectionsExcludingFavorites.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">No other workout collections.</p>
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
                {collectionsExcludingFavorites.map((coll) => (
                  <tr key={coll.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium">
                      <Link
                        href={`/admin/users/${userId}/collections/${encodeURIComponent(coll.id)}`}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        {coll.workoutCollectionName?.trim() || '<empty>'}
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
                            {coll.workoutCollectionName?.trim() || '<empty>'}
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

      {/* Delete user */}
      <div className="rounded-lg border border-red-200 bg-red-50/30 overflow-hidden">
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-red-800">Danger zone</h2>
            <p className="text-sm text-red-700 mt-0.5">
              Permanently delete this user. They will no longer be able to sign in.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {deleteUserError && (
              <div className="rounded bg-red-100 px-3 py-2 text-sm text-red-700">{deleteUserError}</div>
            )}
            <button
              type="button"
              onClick={handleDeleteUser}
              disabled={deletingUser}
              className="inline-flex items-center rounded-md border border-red-600 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deletingUser ? 'Deleting…' : 'Delete user'}
            </button>
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
