'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import toast from 'react-hot-toast'
import { notifyConnectionsListRefresh } from '@/lib/connections-list-events'
import { PublicUserProfileDialog } from '@/components/PublicUserProfileDialog'

type UserHit = {
  userId: string
  displayName: string
  handle: string | null
}

export function UserSearchDialog({
  open,
  onClose,
  user,
}: {
  open: boolean
  onClose: () => void
  user: User
}) {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<UserHit[]>([])
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [profileUserId, setProfileUserId] = useState<string | null>(null)
  const [connectingId, setConnectingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setUsers([])
      setSearchError(null)
      setHasSearched(false)
      setProfileUserId(null)
      setConnectingId(null)
    }
  }, [open])

  const runSearch = useCallback(async () => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setSearchError('Enter a search term.')
      setUsers([])
      setHasSearched(false)
      return
    }
    setSearchError(null)
    setHasSearched(true)
    setLoading(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(`/api/app/users/search?query=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; users?: UserHit[] }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const list = Array.isArray(data.users) ? data.users : []
      setUsers(list.filter((u) => u.userId !== user.uid))
    } catch (e) {
      setUsers([])
      setSearchError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [open, query, user])

  async function sendConnectionRequest(toUserId: string) {
    setConnectingId(toUserId)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/connections/requests', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ toUserId }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        kind?: 'created' | 'alreadyPending' | 'alreadyConnected' | 'incomingExists'
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const kind = data.kind
      if (kind === 'created') toast.success('Connection request sent.')
      else if (kind === 'alreadyPending') toast.success('You already sent a request to this person.')
      else if (kind === 'alreadyConnected') toast.success('You are already connected.')
      else if (kind === 'incomingExists')
        toast.success('This person already invited you — see the top of your Connections screen.')
      else toast.success('Request updated.')
      notifyConnectionsListRefresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send request')
    } finally {
      setConnectingId(null)
    }
  }

  if (!open) return null

  return (
    <>
      <PublicUserProfileDialog
        open={profileUserId != null}
        userId={profileUserId}
        onClose={() => setProfileUserId(null)}
        viewer={user}
      />
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[min(90vh,36rem)] flex flex-col rounded-lg border border-gymnext-muted/30 bg-white shadow-lg overflow-hidden">
        <div className="border-b border-gymnext-muted/30 px-4 py-3 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            className="text-gray-500 hover:text-gray-800 text-lg leading-none px-1"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
          <h3 className="text-sm font-semibold text-gray-800 text-center flex-1 pr-8">Find Users</h3>
        </div>
        <div className="p-4 border-b border-gymnext-muted/20 shrink-0">
          <form
            className="flex gap-2 items-end"
            onSubmit={(e) => {
              e.preventDefault()
              void runSearch()
            }}
          >
            <div className="flex-1 min-w-0">
              <label htmlFor="user-search-q" className="block text-xs font-medium text-gray-700 mb-1">
                Handle or name
              </label>
              <input
                id="user-search-q"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSearchError(null)
                }}
                placeholder="e.g. jane or @jane"
                autoComplete="off"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="shrink-0 rounded px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#6B21A8' }}
            >
              {loading ? '…' : 'Search'}
            </button>
          </form>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0 p-2">
          {loading && <p className="px-2 py-4 text-sm text-gray-500 text-center">Searching…</p>}
          {!loading && searchError && (
            <p className="px-2 py-4 text-sm text-red-600 text-center">{searchError}</p>
          )}
          {!loading && !searchError && !hasSearched && (
            <p className="px-2 py-4 text-sm text-gray-500 text-center">
              Enter a handle or name, then press Search.
            </p>
          )}
          {!loading && !searchError && hasSearched && users.length === 0 && (
            <p className="px-2 py-4 text-sm text-gray-500 text-center">No matching users.</p>
          )}
          {!loading && users.length > 0 && (
            <ul className="space-y-2">
              {users.map((u) => {
                const initial = (u.displayName || u.handle || '?').trim().slice(0, 1).toUpperCase()
                const handleLine = u.handle?.trim()
                  ? u.handle.startsWith('@')
                    ? u.handle
                    : `@${u.handle}`
                  : null
                const busy = connectingId === u.userId
                return (
                  <li
                    key={u.userId}
                    className="rounded-lg border border-gray-200 bg-white flex gap-1 items-stretch overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => setProfileUserId(u.userId)}
                      className="flex-1 min-w-0 flex gap-3 items-start text-left p-3 hover:bg-gray-50"
                    >
                      <div
                        className="h-10 w-10 shrink-0 rounded-full border border-gymnext-muted/30 bg-gymnext-background flex items-center justify-center text-sm font-semibold text-gray-600"
                        aria-hidden
                      >
                        {initial}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {u.displayName || 'Member'}
                        </p>
                        {handleLine && (
                          <p className="text-xs text-gray-600 mt-0.5 truncate">{handleLine}</p>
                        )}
                      </div>
                    </button>
                    <div className="shrink-0 flex items-center pr-2 py-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation()
                          void sendConnectionRequest(u.userId)
                        }}
                        className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90 whitespace-nowrap disabled:opacity-50"
                        style={{ backgroundColor: '#6B21A8' }}
                      >
                        {busy ? '…' : 'Connect'}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
    </>
  )
}
