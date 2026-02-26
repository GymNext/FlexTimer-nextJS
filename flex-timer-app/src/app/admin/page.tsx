'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { auth } from '@/lib/firebase'
import type { AdminUserRecord } from '@/types/user'

const PROVIDER_ICON_SIZE = 18

function ProviderIcon({ provider }: { provider: string }) {
  const title = provider
  const common = { width: PROVIDER_ICON_SIZE, height: PROVIDER_ICON_SIZE, className: 'shrink-0' }
  switch (provider) {
    case 'Google':
      return (
        <span title={title} aria-hidden className="inline-flex items-center justify-center">
          <img src="/icons/google.png" alt="" width={PROVIDER_ICON_SIZE} height={PROVIDER_ICON_SIZE} className="shrink-0 object-contain" />
        </span>
      )
    case 'Apple':
      return (
        <span title={title} aria-hidden className="inline-flex items-center justify-center">
          <img src="/icons/apple.png" alt="" width={PROVIDER_ICON_SIZE} height={PROVIDER_ICON_SIZE} className="shrink-0 object-contain" />
        </span>
      )
    case 'Facebook':
      return (
        <span title={title} aria-hidden className="inline-flex items-center justify-center">
          <img src="/icons/facebook.png" alt="" width={PROVIDER_ICON_SIZE} height={PROVIDER_ICON_SIZE} className="shrink-0 object-contain" />
        </span>
      )
    case 'Email':
      return (
        <span title={title} aria-hidden className="inline-flex items-center justify-center text-gray-500">
          <svg {...common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
        </span>
      )
    case 'Phone':
      return (
        <span title={title} aria-hidden className="inline-flex items-center justify-center text-gray-500">
          <svg {...common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
        </span>
      )
    case 'Guest':
      return (
        <span title={title} aria-hidden className="inline-flex items-center justify-center">
          <img src="/icons/guest.png" alt="" width={PROVIDER_ICON_SIZE} height={PROVIDER_ICON_SIZE} className="shrink-0 object-contain" />
        </span>
      )
    default:
      return (
        <span title={title} aria-hidden className="inline-flex items-center justify-center rounded bg-gray-100 text-gray-500">
          <svg {...common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </span>
      )
  }
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserRecord[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchUsers = useCallback(async (searchTerm: string) => {
    const user = auth.currentUser
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const token = await user.getIdToken()
      const url = new URL('/api/admin/users', window.location.origin)
      if (searchTerm) url.searchParams.set('search', searchTerm)
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setUsers(data.users ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users')
      setUsers([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsers(search)
  }, [search, fetchUsers])

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">Users</h1>

      <div className="flex gap-4 items-center">
        <label htmlFor="search" className="text-sm font-medium text-gray-700">
          Search
        </label>
        <input
          id="search"
          type="text"
          placeholder="User ID, email, or display name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-md rounded border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {error && (
        <div className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading users…</p>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Provider
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Display name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  User ID
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Created
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.uid} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600">
                      <span className="inline-flex items-center gap-2">
                        {u.providers?.length ? (
                          <>
                            <ProviderIcon provider={u.providers[0]} />
                            <span>{u.providers.join(', ')}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {u.displayName ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {u.email ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-900">
                      {u.uid}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {u.metadata.creationTime
                        ? new Date(u.metadata.creationTime).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-sm">
                      <Link
                        href={`/admin/users/${u.uid}`}
                        className="text-blue-600 hover:text-blue-800 font-medium"
                      >
                        View profile
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
