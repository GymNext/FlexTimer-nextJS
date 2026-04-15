'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'

type InviteContext = {
  groupId: string
  hubName: string
  isSubHub: boolean
  parentGroupId: string | null
  parentMemberCount: number | null
  dialogMode: 'search' | 'browseParent'
  browseParentGroupId: string | null
  searchRestrictToParentGroupId: string | null
}

type MemberRow = { userId: string; displayName: string; handle: string | null }

export function InviteUsersDialog({
  open,
  onClose,
  user,
  targetGroupId,
  onInviteSent,
}: {
  open: boolean
  onClose: () => void
  user: User
  targetGroupId: string | null
  /** Called when a new pending invite is created (refresh parent hub panel). */
  onInviteSent?: () => void
}) {
  const [ctx, setCtx] = useState<InviteContext | null>(null)
  const [ctxError, setCtxError] = useState<string | null>(null)
  const [loadingCtx, setLoadingCtx] = useState(false)
  const [browseMembers, setBrowseMembers] = useState<MemberRow[]>([])
  const [browseError, setBrowseError] = useState<string | null>(null)
  const [loadingBrowse, setLoadingBrowse] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<MemberRow[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchHasRun, setSearchHasRun] = useState(false)
  const [invitingId, setInvitingId] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  const resetLocal = useCallback(() => {
    setCtx(null)
    setCtxError(null)
    setBrowseMembers([])
    setBrowseError(null)
    setSearchQuery('')
    setSearchResults([])
    setSearchHasRun(false)
    setBanner(null)
  }, [])

  useEffect(() => {
    if (!open) {
      resetLocal()
      return
    }
    if (!targetGroupId) return

    let cancelled = false
    setLoadingCtx(true)
    setCtxError(null)
    ;(async () => {
      try {
        const token = await user.getIdToken()
        const res = await fetch(`/api/app/groups/${encodeURIComponent(targetGroupId)}/invite-context`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = (await res.json().catch(() => ({}))) as InviteContext & { error?: string }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        if (!cancelled) setCtx(data)
      } catch (e) {
        if (!cancelled) setCtxError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoadingCtx(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, targetGroupId, user, resetLocal])

  useEffect(() => {
    if (!open || !ctx || ctx.dialogMode !== 'browseParent' || !ctx.browseParentGroupId) return

    let cancelled = false
    setLoadingBrowse(true)
    setBrowseError(null)
    ;(async () => {
      try {
        const token = await user.getIdToken()
        const res = await fetch(
          `/api/app/groups/${encodeURIComponent(ctx.browseParentGroupId!)}/members`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        const data = (await res.json().catch(() => ({}))) as { error?: string; members?: MemberRow[] }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        if (!cancelled) setBrowseMembers(Array.isArray(data.members) ? data.members : [])
      } catch (e) {
        if (!cancelled) setBrowseError(e instanceof Error ? e.message : 'Failed to load members')
      } finally {
        if (!cancelled) setLoadingBrowse(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, ctx])

  const runUserSearch = useCallback(async () => {
    if (!open || !ctx || ctx.dialogMode !== 'search') return
    const q = searchQuery.trim()
    if (!q) {
      setBanner('Enter a search term.')
      setSearchResults([])
      setSearchHasRun(false)
      return
    }
    setBanner(null)
    setSearchHasRun(true)
    setSearchLoading(true)
    try {
      const token = await user.getIdToken()
      const params = new URLSearchParams({ query: q })
      if (ctx.searchRestrictToParentGroupId) {
        params.set('restrictToParentOfGroupId', ctx.searchRestrictToParentGroupId)
      }
      const res = await fetch(`/api/app/users/search?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; users?: MemberRow[] }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setSearchResults(Array.isArray(data.users) ? data.users : [])
    } catch (e) {
      setSearchResults([])
      setBanner(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setSearchLoading(false)
    }
  }, [open, ctx, searchQuery, user])

  const inviteUser = useCallback(
    async (invitedUserId: string) => {
      if (!targetGroupId) return
      setInvitingId(invitedUserId)
      setBanner(null)
      try {
        const token = await user.getIdToken()
        const res = await fetch(`/api/app/groups/${encodeURIComponent(targetGroupId)}/invites`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ invitedUserId }),
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string; result?: string }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        if (data.result === 'alreadyMember') setBanner('That user is already a member.')
        else if (data.result === 'alreadyPending') setBanner('An invite is already pending for that user.')
        else {
          setBanner('Invite sent.')
          onInviteSent?.()
        }
      } catch (e) {
        setBanner(e instanceof Error ? e.message : 'Invite failed')
      } finally {
        setInvitingId(null)
      }
    },
    [targetGroupId, user, onInviteSent],
  )

  const description = useMemo(() => {
    if (!ctx) return ''
    if (ctx.dialogMode === 'browseParent') {
      return 'Members of the parent hub are listed below. Invite someone to join this sub hub.'
    }
    if (ctx.isSubHub && ctx.searchRestrictToParentGroupId) {
      return 'Search by handle or name. Only people who are already members of the parent hub appear in results.'
    }
    return 'Search by handle or name.'
  }, [ctx])

  if (!open || !targetGroupId) return null

  return (
    <div className="fixed inset-0 z-[57] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden onClick={() => !invitingId && onClose()} />
      <div className="relative w-full max-w-md max-h-[min(88vh,32rem)] flex flex-col rounded-lg border border-gymnext-muted/30 bg-white shadow-lg overflow-hidden">
        <div className="border-b border-gymnext-muted/30 px-4 py-3 flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">
              Invite users{ctx?.hubName ? ` — ${ctx.hubName}` : ''}
            </h3>
            {ctx?.isSubHub && (
              <p className="text-[11px] text-violet-800 font-medium mt-0.5">Sub hub (parent members)</p>
            )}
          </div>
          <button
            type="button"
            className="text-gray-500 hover:text-gray-800 text-lg leading-none px-1"
            aria-label="Close"
            disabled={Boolean(invitingId)}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 p-4">
          {loadingCtx && <p className="text-sm text-gray-500">Loading…</p>}
          {ctxError && <p className="text-sm text-red-600">{ctxError}</p>}

          {!loadingCtx && ctx && (
            <>
              <p className="text-xs text-gray-600 mb-3">{description}</p>
              {banner && (
                <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-3">
                  {banner}
                </p>
              )}

              {ctx.dialogMode === 'browseParent' && (
                <>
                  {loadingBrowse && <p className="text-sm text-gray-500">Loading members…</p>}
                  {browseError && <p className="text-sm text-red-600">{browseError}</p>}
                  {!loadingBrowse && !browseError && browseMembers.length === 0 && (
                    <p className="text-sm text-gray-500">No members found on the parent hub.</p>
                  )}
                  <ul className="space-y-2">
                    {browseMembers.map((m) => (
                      <li
                        key={m.userId}
                        className="flex items-center justify-between gap-2 rounded border border-gray-100 bg-gray-50/80 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{m.displayName}</p>
                          {m.handle && (
                            <p className="text-xs text-gray-600 truncate">{m.handle}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={m.userId === user.uid || invitingId === m.userId}
                          onClick={() => void inviteUser(m.userId)}
                          className="shrink-0 rounded border border-gymnext-muted/40 bg-white px-2.5 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                          style={
                            m.userId !== user.uid
                              ? { borderColor: '#6B21A8', color: '#6B21A8' }
                              : undefined
                          }
                        >
                          {invitingId === m.userId ? '…' : 'Invite'}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {ctx.dialogMode === 'search' && (
                <>
                  <form
                    className="flex gap-2 items-end mb-3"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void runUserSearch()
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <label htmlFor="invite-user-search" className="block text-xs font-medium text-gray-700 mb-1">
                        Search by handle or name
                      </label>
                      <input
                        id="invite-user-search"
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value)
                          setBanner(null)
                        }}
                        placeholder="Handle or name"
                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                        autoComplete="off"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={searchLoading || Boolean(invitingId)}
                      className="shrink-0 rounded px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                      style={{ backgroundColor: '#6B21A8' }}
                    >
                      {searchLoading ? '…' : 'Search'}
                    </button>
                  </form>
                  {searchLoading && <p className="text-xs text-gray-500 mb-2">Searching…</p>}
                  {!searchLoading && !searchHasRun && !banner && (
                    <p className="text-xs text-gray-500 mb-2">Enter a term, then press Search.</p>
                  )}
                  <ul className="space-y-2">
                    {searchResults.map((m) => (
                      <li
                        key={m.userId}
                        className="flex items-center justify-between gap-2 rounded border border-gray-100 bg-gray-50/80 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {m.displayName || m.handle || m.userId}
                          </p>
                          {m.handle && m.displayName && (
                            <p className="text-xs text-gray-600 truncate">{m.handle}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={m.userId === user.uid || invitingId === m.userId}
                          onClick={() => void inviteUser(m.userId)}
                          className="shrink-0 rounded border px-2.5 py-1 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
                          style={{ borderColor: '#6B21A8', color: '#6B21A8' }}
                        >
                          {invitingId === m.userId ? '…' : 'Invite'}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {!searchLoading && searchHasRun && searchResults.length === 0 && !banner && (
                    <p className="text-sm text-gray-500 mt-2">No matches.</p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
