'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import type { AppGroupJoinPolicy, AppGroupType } from '@/types/group'
import toast from 'react-hot-toast'
import { hubTypeCard } from '@/lib/hub-type-cards'

type HubHit = {
  groupId: string
  handleKey: string
  handleDisplay: string
  name: string
  groupType: AppGroupType | null
  joinPolicy: AppGroupJoinPolicy
  viewerOwnsHub: boolean
  isMember: boolean
}

const POLICY_LABEL: Record<AppGroupJoinPolicy, string> = {
  private: 'private',
  restricted: 'restricted',
  public: 'public',
}

export function HubSearchDialog({
  open,
  onClose,
  user,
}: {
  open: boolean
  onClose: () => void
  user: User
}) {
  const [query, setQuery] = useState('')
  const [hubs, setHubs] = useState<HubHit[]>([])
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [actingId, setActingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setHubs([])
      setSearchError(null)
      setHasSearched(false)
      setActingId(null)
    }
  }, [open])

  const runSearch = useCallback(async () => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setSearchError('Enter a search term.')
      setHubs([])
      setHasSearched(false)
      return
    }
    setSearchError(null)
    setHasSearched(true)
    setLoading(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/app/groups/handle-search?query=${encodeURIComponent(q)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const data = (await res.json().catch(() => ({}))) as { error?: string; hubs?: HubHit[] }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setHubs(Array.isArray(data.hubs) ? data.hubs : [])
    } catch (e) {
      setHubs([])
      setSearchError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [open, query, user])

  const onJoin = useCallback(
    async (groupId: string) => {
      setActingId(groupId)
      try {
        const token = await user.getIdToken()
        const res = await fetch(`/api/app/groups/${encodeURIComponent(groupId)}/join`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string; kind?: string }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        const kind = data.kind
        if (kind === 'joined') toast.success('You joined this hub.')
        else if (kind === 'alreadyMember') toast.success('You are already a member.')
        else if (kind === 'requested') toast.success('Join request sent. An owner can approve it.')
        else if (kind === 'alreadyPending') toast.success('You already have a pending request.')
        setHubs((prev) =>
          prev.map((h) =>
            h.groupId === groupId && (kind === 'joined' || kind === 'alreadyMember')
              ? { ...h, isMember: true }
              : h,
          ),
        )
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not join hub')
      } finally {
        setActingId(null)
      }
    },
    [user],
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden onClick={() => !actingId && onClose()} />
      <div className="relative w-full max-w-md max-h-[min(90vh,36rem)] flex flex-col rounded-lg border border-gymnext-muted/30 bg-white shadow-lg overflow-hidden">
        <div className="border-b border-gymnext-muted/30 px-4 py-3 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            className="text-gray-500 hover:text-gray-800 text-lg leading-none px-1"
            aria-label="Close"
            disabled={Boolean(actingId)}
            onClick={onClose}
          >
            ×
          </button>
          <h3 className="text-sm font-semibold text-gray-800 text-center flex-1 pr-8">Find Hubs</h3>
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
              <label htmlFor="hub-search-q" className="block text-xs font-medium text-gray-700 mb-1">
                Handle or name
              </label>
              <input
                id="hub-search-q"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSearchError(null)
                }}
                placeholder="e.g. @northside or Northside Gym"
                autoComplete="off"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
              />
            </div>
            <button
              type="submit"
              disabled={loading || Boolean(actingId)}
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
              Enter a handle or hub name, then press Search.
            </p>
          )}
          {!loading && !searchError && hasSearched && hubs.length === 0 && (
            <p className="px-2 py-4 text-sm text-gray-500 text-center">No matching hubs.</p>
          )}
          {!loading && hubs.length > 0 && (
            <ul className="space-y-2">
              {hubs.map((h) => {
                const card = hubTypeCard(h.groupType)
                const busy = actingId === h.groupId
                return (
                  <li
                    key={h.groupId}
                    className="rounded-lg border border-gray-200 bg-white p-3 flex gap-3 items-start"
                  >
                    <span
                      className="w-1 shrink-0 rounded-full self-stretch min-h-[2.75rem] mt-0.5"
                      style={{ backgroundColor: card.barColor }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900 truncate">{h.name}</p>
                      <p className="text-xs text-gray-600 mt-0.5 truncate">{h.handleDisplay}</p>
                      <p className="text-[11px] text-gray-500 mt-1">{POLICY_LABEL[h.joinPolicy]}</p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1 max-w-[11rem] text-right">
                      {h.viewerOwnsHub ? (
                        <span className="text-xs font-medium text-violet-800 py-1.5 px-2 rounded bg-violet-50 border border-violet-100">
                          Your hub
                        </span>
                      ) : h.isMember ? (
                        <span className="text-xs font-medium text-gray-500 py-1.5 px-2">Joined</span>
                      ) : h.joinPolicy === 'private' ? (
                        <span className="text-xs font-medium text-gray-600 py-1.5 px-2 rounded bg-gray-50 border border-gray-100">
                          Invite only
                        </span>
                      ) : h.joinPolicy === 'public' ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onJoin(h.groupId)}
                          className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
                          style={{ backgroundColor: '#84cc16' }}
                        >
                          {busy ? '…' : 'Join'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onJoin(h.groupId)}
                          className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
                          style={{ backgroundColor: '#6B21A8' }}
                        >
                          {busy ? '…' : 'Request'}
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
