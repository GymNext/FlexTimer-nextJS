'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { auth } from '@/lib/firebase'
import type { AdminUserProfile } from '@/types/user'

export default function AdminUserProfilePage() {
  const params = useParams()
  const userId = params.userId as string
  const [profile, setProfile] = useState<AdminUserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Workout collections</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">
              {profile.dataCounts.workoutCollections}
            </dd>
          </div>
          <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-gray-500">Workout plans</dt>
            <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">
              {profile.dataCounts.workoutPlans}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
