'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import type { HubTreeNode } from '@/types/hub-tree'
import { formatSharedOnLine } from '@/lib/format-shared-at'

export type LibraryShareKind = 'workout' | 'collection'

type GroupShareRow = {
  groupId: string
  groupName: string
  sharedAt: string | null
  groupFeedItemId: string | null
}

type UserShareRow = {
  peerUserId: string
  displayName: string
  handle: string | null
  sharedAt: string | null
  recipientFeedItemId: string | null
  sharerFeedItemId: string | null
}

type SharesPayload = {
  groupShares: GroupShareRow[]
  userShares: UserShareRow[]
  destinationCount: number
  maxDestinations: number
}

type ConnectionRow = {
  peerUserId: string
  displayName: string
  handle: string | null
}

type StopShareConfirmState =
  | { type: 'group'; row: GroupShareRow }
  | { type: 'user'; row: UserShareRow }

function flattenHubs(nodes: HubTreeNode[]): { id: string; name: string; search: string }[] {
  const out: { id: string; name: string; search: string }[] = []
  function walk(list: HubTreeNode[], depth: number) {
    for (const n of list) {
      const prefix = depth > 0 ? `${'· '.repeat(depth)}` : ''
      const name = `${prefix}${n.name}`
      const search = `${n.name} ${n.subtitle ?? ''} ${n.id}`.toLowerCase()
      out.push({ id: n.id, name, search })
      if (n.children?.length) walk(n.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return out
}

function sharesBasePath(kind: LibraryShareKind, resourceId: string): string {
  const id = encodeURIComponent(resourceId)
  return kind === 'workout' ? `/api/app/workouts/${id}/shares` : `/api/app/collections/${id}/shares`
}

export function ContentShareDialogs({
  user,
  open,
  onClose,
  kind,
  resourceId,
  resourceTitle,
}: {
  user: User
  open: boolean
  onClose: () => void
  kind: LibraryShareKind
  resourceId: string
  resourceTitle: string
}) {
  const [phase, setPhase] = useState<'manage' | 'shareWith'>('manage')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<SharesPayload | null>(null)

  const [shareTarget, setShareTarget] = useState<'group' | 'user'>('user')
  const [pickerQuery, setPickerQuery] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [shareBusy, setShareBusy] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)

  const [hubs, setHubs] = useState<HubTreeNode[]>([])
  const [connections, setConnections] = useState<ConnectionRow[]>([])

  const [stopShareConfirm, setStopShareConfirm] = useState<StopShareConfirmState | null>(null)
  const [stopShareBusy, setStopShareBusy] = useState(false)
  const [stopShareError, setStopShareError] = useState<string | null>(null)

  const authedFetch = useCallback(
    async (input: string, init?: RequestInit) => {
      const token = await user.getIdToken()
      const headers: HeadersInit = {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
      }
      return fetch(input, { ...init, headers })
    },
    [user]
  )

  const reloadShares = useCallback(async () => {
    setLoading(true)
    setError(null)
    const base = sharesBasePath(kind, resourceId)
    try {
      const [shRes, hubRes, connRes] = await Promise.all([
        authedFetch(base),
        authedFetch('/api/app/owned-groups'),
        authedFetch('/api/app/connections'),
      ])
      if (!shRes.ok) {
        const j = await shRes.json().catch(() => ({}))
        throw new Error(j.error || `Failed to load shares (${shRes.status})`)
      }
      const sh = (await shRes.json()) as SharesPayload
      setData({
        groupShares: Array.isArray(sh.groupShares) ? sh.groupShares : [],
        userShares: Array.isArray(sh.userShares) ? sh.userShares : [],
        destinationCount: typeof sh.destinationCount === 'number' ? sh.destinationCount : 0,
        maxDestinations: typeof sh.maxDestinations === 'number' ? sh.maxDestinations : 10,
      })

      if (hubRes.ok) {
        const hj = (await hubRes.json()) as { hubs?: HubTreeNode[] }
        setHubs(Array.isArray(hj.hubs) ? hj.hubs : [])
      } else {
        setHubs([])
      }

      if (connRes.ok) {
        const cj = (await connRes.json()) as { connections?: ConnectionRow[] }
        setConnections(Array.isArray(cj.connections) ? cj.connections : [])
      } else {
        setConnections([])
      }
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [authedFetch, kind, resourceId])

  useEffect(() => {
    if (!open) return
    void reloadShares()
  }, [open, reloadShares])

  useEffect(() => {
    if (!open) {
      setPhase('manage')
      setPickerQuery('')
      setSelectedGroupId(null)
      setSelectedPeerId(null)
      setComment('')
      setShareError(null)
      setShareTarget('user')
      setStopShareConfirm(null)
      setStopShareBusy(false)
      setStopShareError(null)
    }
  }, [open])

  const flatGroups = useMemo(() => flattenHubs(hubs), [hubs])

  const filteredGroups = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    if (!q) return flatGroups.slice(0, 25)
    return flatGroups.filter((g) => g.search.includes(q)).slice(0, 25)
  }, [flatGroups, pickerQuery])

  const filteredConnections = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    const base = connections.map((c) => ({
      id: c.peerUserId,
      name: c.displayName || c.peerUserId,
      search: `${c.displayName} ${c.handle ?? ''} ${c.peerUserId}`.toLowerCase(),
    }))
    if (!q) return base.slice(0, 25)
    return base.filter((c) => c.search.includes(q)).slice(0, 25)
  }, [connections, pickerQuery])

  const hubCount = flatGroups.length
  const connectionCount = connections.length
  const hubPickerIsDropdown = hubCount > 0 && hubCount < 10
  const connectionPickerIsDropdown = connectionCount > 0 && connectionCount < 10

  function openShareWith() {
    setPhase('shareWith')
    setPickerQuery('')
    setSelectedGroupId(null)
    setSelectedPeerId(null)
    setComment('')
    setShareError(null)
    setShareTarget('user')
  }

  async function submitShare() {
    const base = sharesBasePath(kind, resourceId)
    setShareBusy(true)
    setShareError(null)
    try {
      if (shareTarget === 'group') {
        if (!selectedGroupId) {
          setShareError(
            hubCount === 0
              ? "You don't have any hubs to share with."
              : hubPickerIsDropdown
                ? 'Select a hub.'
                : 'Choose a hub from the list.'
          )
          return
        }
        const res = await authedFetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target: 'group',
            groupId: selectedGroupId,
            comment: comment.trim() || undefined,
          }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || `Share failed (${res.status})`)
        }
      } else {
        if (!selectedPeerId) {
          setShareError(
            connectionCount === 0
              ? "You don't have any connections to share with."
              : connectionPickerIsDropdown
                ? 'Select a connection.'
                : 'Choose a connected person from the list.'
          )
          return
        }
        const res = await authedFetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target: 'user',
            peerUserId: selectedPeerId,
            comment: comment.trim() || undefined,
          }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || `Share failed (${res.status})`)
        }
      }
      setPhase('manage')
      await reloadShares()
    } catch (e) {
      setShareError(e instanceof Error ? e.message : 'Share failed')
    } finally {
      setShareBusy(false)
    }
  }

  function openStopShareConfirm(row: GroupShareRow): void
  function openStopShareConfirm(row: UserShareRow): void
  function openStopShareConfirm(row: GroupShareRow | UserShareRow): void {
    setStopShareError(null)
    if ('groupId' in row) {
      setStopShareConfirm({ type: 'group', row })
    } else {
      setStopShareConfirm({ type: 'user', row })
    }
  }

  async function confirmStopShare() {
    if (!stopShareConfirm) return
    const base = sharesBasePath(kind, resourceId)
    setStopShareBusy(true)
    setStopShareError(null)
    try {
      if (stopShareConfirm.type === 'group') {
        const row = stopShareConfirm.row
        const qs = new URLSearchParams({
          target: 'group',
          groupId: row.groupId,
        })
        if (row.groupFeedItemId) qs.set('groupFeedItemId', row.groupFeedItemId)
        const res = await authedFetch(`${base}?${qs.toString()}`, { method: 'DELETE' })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || `Stop sharing failed (${res.status})`)
        }
      } else {
        const row = stopShareConfirm.row
        const qs = new URLSearchParams({
          target: 'user',
          peerUserId: row.peerUserId,
        })
        if (row.recipientFeedItemId) qs.set('recipientFeedItemId', row.recipientFeedItemId)
        const res = await authedFetch(`${base}?${qs.toString()}`, { method: 'DELETE' })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || `Stop sharing failed (${res.status})`)
        }
      }
      setStopShareConfirm(null)
      await reloadShares()
    } catch (e) {
      setStopShareError(e instanceof Error ? e.message : 'Failed to stop sharing')
    } finally {
      setStopShareBusy(false)
    }
  }

  if (!open) return null

  const atCap = data ? data.destinationCount >= data.maxDestinations : false
  const heading = kind === 'workout' ? 'Share workout' : 'Share collection'

  return (
    <>
      {phase === 'manage' && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" aria-hidden onClick={onClose} />
          <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
            <div className="shrink-0 border-b border-gymnext-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">{heading}</h3>
              <p className="mt-1 text-xs text-gray-600 line-clamp-2">{resourceTitle}</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {loading && <p className="text-sm text-gray-500">Loading…</p>}
              {error && <p className="text-sm text-red-600">{error}</p>}
              {!loading && !error && data && (
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Hubs</p>
                    {data.groupShares.length === 0 ? (
                      <p className="mt-1 text-sm text-gray-500">Not shared with any hub yet.</p>
                    ) : (
                      <ul className="mt-1 divide-y divide-gray-100 rounded border border-gray-100">
                        {data.groupShares.map((row) => {
                          const groupShareLine = formatSharedOnLine(row.sharedAt)
                          return (
                          <li key={row.groupId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                            <div className="min-w-0">
                              <p className="truncate font-medium text-gray-900">{row.groupName}</p>
                              {groupShareLine ? (
                                <p className="text-xs text-gray-500">{groupShareLine}</p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => openStopShareConfirm(row)}
                              className="shrink-0 rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
                            >
                              Stop Sharing
                            </button>
                          </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">People</p>
                    {data.userShares.length === 0 ? (
                      <p className="mt-1 text-sm text-gray-500">Not shared directly with anyone yet.</p>
                    ) : (
                      <ul className="mt-1 divide-y divide-gray-100 rounded border border-gray-100">
                        {data.userShares.map((row) => {
                          const userShareLine = formatSharedOnLine(row.sharedAt)
                          return (
                          <li key={row.peerUserId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                            <div className="min-w-0">
                              <p className="truncate font-medium text-gray-900">{row.displayName}</p>
                              {row.handle && <p className="truncate text-xs text-gray-500">{row.handle}</p>}
                              {userShareLine ? (
                                <p className="text-xs text-gray-500">{userShareLine}</p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => openStopShareConfirm(row)}
                              className="shrink-0 rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
                            >
                              Stop Sharing
                            </button>
                          </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-gymnext-muted/30 px-4 py-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={openShareWith}
                disabled={loading || !!error || atCap}
                title={
                  atCap ? `You already have ${data?.maxDestinations ?? 10} share destinations for this item.` : undefined
                }
                className="rounded px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#6B21A8' }}
              >
                Share with…
              </button>
            </div>
          </div>
        </div>
      )}

      {stopShareConfirm && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => {
              if (!stopShareBusy) {
                setStopShareConfirm(null)
                setStopShareError(null)
              }
            }}
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="content-share-stop-title"
            aria-describedby="content-share-stop-desc"
            className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white p-4 shadow-lg"
          >
            <h3 id="content-share-stop-title" className="text-sm font-semibold text-gray-900">
              Stop sharing?
            </h3>
            <p id="content-share-stop-desc" className="mt-2 text-sm text-gray-600">
              {stopShareConfirm.type === 'group' ? (
                <>
                  Stop sharing with &ldquo;{stopShareConfirm.row.groupName}&rdquo;? Members will lose access from this
                  share.
                </>
              ) : (
                <>
                  Stop sharing with &ldquo;{stopShareConfirm.row.displayName}&rdquo;? They will lose access from this
                  share.
                </>
              )}
            </p>
            {stopShareError ? <p className="mt-2 text-sm text-red-600">{stopShareError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={stopShareBusy}
                onClick={() => {
                  setStopShareConfirm(null)
                  setStopShareError(null)
                }}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={stopShareBusy}
                onClick={() => void confirmStopShare()}
                className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {stopShareBusy ? 'Stopping…' : 'Stop Sharing'}
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'shareWith' && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !shareBusy && setPhase('manage')}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
            <div className="border-b border-gymnext-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">Share with…</h3>
              <p className="mt-1 text-xs text-gray-600 line-clamp-2">{resourceTitle}</p>
            </div>
            <div className="max-h-[min(70vh,32rem)] min-h-0 overflow-y-auto">
              {loading && (
                <div className="p-4">
                  <p className="text-sm text-gray-500">Loading…</p>
                </div>
              )}
              {!loading && (
                <div className="space-y-3 p-4">
                  <div className="flex gap-4 text-sm">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="contentShareTarget"
                        checked={shareTarget === 'user'}
                        onChange={() => {
                          setShareTarget('user')
                          setPickerQuery('')
                          setSelectedGroupId(null)
                          setSelectedPeerId(null)
                        }}
                      />
                      Connection
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="contentShareTarget"
                        checked={shareTarget === 'group'}
                        onChange={() => {
                          setShareTarget('group')
                          setPickerQuery('')
                          setSelectedGroupId(null)
                          setSelectedPeerId(null)
                        }}
                      />
                      Hub
                    </label>
                  </div>
                  <div>
                    {shareTarget === 'group' ? (
                      hubCount === 0 ? (
                        <p className="text-sm text-gray-500">You don&apos;t have any hubs to share with.</p>
                      ) : hubPickerIsDropdown ? (
                        <>
                          <label htmlFor="content-share-select-hub" className="mb-1 block text-xs font-medium text-gray-700">
                            Select hub
                          </label>
                          <select
                            id="content-share-select-hub"
                            value={selectedGroupId ?? ''}
                            onChange={(e) => {
                              const v = e.target.value || null
                              setSelectedGroupId(v)
                              setSelectedPeerId(null)
                              setPickerQuery('')
                            }}
                            className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                          >
                            <option value="">Select a hub…</option>
                            {flatGroups.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.name}
                              </option>
                            ))}
                          </select>
                        </>
                      ) : (
                        <>
                          <label htmlFor="content-share-hub-search" className="mb-1 block text-xs font-medium text-gray-700">
                            Search hubs
                          </label>
                          <input
                            id="content-share-hub-search"
                            type="text"
                            value={pickerQuery}
                            onChange={(e) => {
                              setPickerQuery(e.target.value)
                              setSelectedGroupId(null)
                              setSelectedPeerId(null)
                            }}
                            className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                            placeholder="Type a hub name…"
                            autoComplete="off"
                          />
                          <ul className="mt-1 max-h-36 overflow-y-auto rounded border border-gray-100 bg-white text-sm shadow-sm">
                            {filteredGroups.map((g) => (
                              <li key={g.id}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedGroupId(g.id)
                                    setSelectedPeerId(null)
                                    setPickerQuery(g.name)
                                  }}
                                  className={`flex w-full px-3 py-2 text-left hover:bg-gray-50 ${
                                    selectedGroupId === g.id ? 'bg-purple-50' : ''
                                  }`}
                                >
                                  {g.name}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </>
                      )
                    ) : connectionCount === 0 ? (
                      <p className="text-sm text-gray-500">You don&apos;t have any connections to share with.</p>
                    ) : connectionPickerIsDropdown ? (
                      <>
                        <label htmlFor="content-share-select-connection" className="mb-1 block text-xs font-medium text-gray-700">
                          Select connection
                        </label>
                        <select
                          id="content-share-select-connection"
                          value={selectedPeerId ?? ''}
                          onChange={(e) => {
                            const v = e.target.value || null
                            setSelectedPeerId(v)
                            setSelectedGroupId(null)
                            setPickerQuery('')
                          }}
                          className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                        >
                          <option value="">Select a connection…</option>
                          {connections.map((c) => (
                            <option key={c.peerUserId} value={c.peerUserId}>
                              {c.displayName || c.peerUserId}
                              {c.handle ? ` — ${c.handle}` : ''}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <>
                        <label htmlFor="content-share-connection-search" className="mb-1 block text-xs font-medium text-gray-700">
                          Search connections
                        </label>
                        <input
                          id="content-share-connection-search"
                          type="text"
                          value={pickerQuery}
                          onChange={(e) => {
                            setPickerQuery(e.target.value)
                            setSelectedGroupId(null)
                            setSelectedPeerId(null)
                          }}
                          className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                          placeholder="Type a name or handle…"
                          autoComplete="off"
                        />
                        <ul className="mt-1 max-h-36 overflow-y-auto rounded border border-gray-100 bg-white text-sm shadow-sm">
                          {filteredConnections.map((c) => (
                            <li key={c.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedPeerId(c.id)
                                  setSelectedGroupId(null)
                                  setPickerQuery(c.name)
                                }}
                                className={`flex w-full px-3 py-2 text-left hover:bg-gray-50 ${
                                  selectedPeerId === c.id ? 'bg-purple-50' : ''
                                }`}
                              >
                                <span className="font-medium text-gray-900">{c.name}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                  <div>
                    <label htmlFor="content-share-comment" className="mb-1 block text-xs font-medium text-gray-700">
                      Comment (optional)
                    </label>
                    <textarea
                      id="content-share-comment"
                      rows={3}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                      placeholder="Shown with the share in the feed"
                    />
                  </div>
                  {shareError && <p className="text-xs text-red-600">{shareError}</p>}
                </div>
              )}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-gymnext-muted/30 px-4 py-3">
              <button
                type="button"
                disabled={shareBusy}
                onClick={() => setPhase('manage')}
                className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                disabled={
                  shareBusy ||
                  atCap ||
                  loading ||
                  (shareTarget === 'group' ? !selectedGroupId : !selectedPeerId)
                }
                title={atCap ? `You already have ${data?.maxDestinations ?? 10} share destinations.` : undefined}
                onClick={() => void submitShare()}
                className="rounded px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#6B21A8' }}
              >
                {shareBusy ? 'Sharing…' : 'Share'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
