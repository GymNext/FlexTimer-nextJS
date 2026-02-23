'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { auth } from '@/lib/firebase'
import type { AdminUserRecord } from '@/types/user'

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
                  User ID
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Display name
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
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.uid} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-mono text-gray-900">
                      {u.uid}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {u.email ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {u.displayName ?? '—'}
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
