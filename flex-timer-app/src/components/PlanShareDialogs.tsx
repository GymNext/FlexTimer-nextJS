'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import type { HubTreeNode } from '@/types/hub-tree'

/** Must match `MAX_PLAN_SHARE_DESTINATIONS` in `@/lib/plan-share` (client-safe literal). */
const PLAN_SHARE_DESTINATION_CAP = 10

type ShareLimitsPayload = {
  destinationCount: number
  maxDestinations: number
}

type ConnectionRow = {
  peerUserId: string
  displayName: string
  handle: string | null
}

function PlanShareSwitchRow({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (next: boolean) => void
}) {
  const hintId = description ? `${id}-description` : undefined
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-gray-100 bg-gray-50/80 px-3 py-2.5">
      <div className="min-w-0 pr-2">
        <p id={`${id}-label`} className="text-sm font-medium text-gray-900">
          {label}
        </p>
        {description ? (
          <p id={hintId} className="mt-1 text-xs text-gray-500">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={hintId}
        disabled={disabled}
        onClick={() => {
          if (!disabled) onCheckedChange(!checked)
        }}
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#6B21A8] disabled:opacity-50 ${
          checked ? 'bg-[#6B21A8]' : 'bg-gray-300'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
          aria-hidden
        />
      </button>
    </div>
  )
}

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

export function PlanShareDialogs({
  user,
  open,
  onClose,
  planId,
  planName,
  allowsHubShare,
}: {
  user: User
  open: boolean
  onClose: () => void
  planId: string
  planName: string
  /** True when the plan is group training (`trainingIntent === 1`): hub sharing allowed; also drives share-option defaults. */
  allowsHubShare: boolean
}) {
  const isGroupTrainingPlan = allowsHubShare
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shareLimits, setShareLimits] = useState<ShareLimitsPayload | null>(null)

  const [shareTarget, setShareTarget] = useState<'group' | 'user'>('user')
  const [pickerQuery, setPickerQuery] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [allowEditing, setAllowEditing] = useState(false)
  const [hideFutureWorkouts, setHideFutureWorkouts] = useState(true)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)

  const [hubs, setHubs] = useState<HubTreeNode[]>([])
  const [connections, setConnections] = useState<ConnectionRow[]>([])

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
    try {
      const [shRes, hubRes, connRes] = await Promise.all([
        authedFetch(`/api/app/plans/${encodeURIComponent(planId)}/shares`),
        authedFetch('/api/app/owned-groups'),
        authedFetch('/api/app/connections'),
      ])
      if (!shRes.ok) {
        const j = await shRes.json().catch(() => ({}))
        throw new Error(j.error || `Failed to load shares (${shRes.status})`)
      }
      const sh = (await shRes.json()) as {
        destinationCount?: number
        maxDestinations?: number
      }
      setShareLimits({
        destinationCount: typeof sh.destinationCount === 'number' ? sh.destinationCount : 0,
        maxDestinations: typeof sh.maxDestinations === 'number' ? sh.maxDestinations : PLAN_SHARE_DESTINATION_CAP,
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
      setShareLimits(null)
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [authedFetch, planId])

  useEffect(() => {
    if (!open) return
    void reloadShares()
  }, [open, reloadShares])

  useEffect(() => {
    if (!open) {
      setPickerQuery('')
      setSelectedGroupId(null)
      setSelectedPeerId(null)
      setComment('')
      setAllowEditing(false)
      setHideFutureWorkouts(isGroupTrainingPlan)
      setShareError(null)
      setShareTarget('user')
      return
    }
    setPickerQuery('')
    setSelectedGroupId(null)
    setSelectedPeerId(null)
    setComment('')
    setAllowEditing(false)
    setHideFutureWorkouts(isGroupTrainingPlan)
    setShareError(null)
    setShareTarget('user')
  }, [open, isGroupTrainingPlan])

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

  async function submitShare() {
    setShareBusy(true)
    setShareError(null)
    try {
      if (shareTarget === 'group') {
        if (!allowsHubShare) {
          setShareError('Private training plans can only be shared with connected people, not hubs.')
          return
        }
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
        const res = await authedFetch(`/api/app/plans/${encodeURIComponent(planId)}/shares`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target: 'group',
            groupId: selectedGroupId,
            comment: comment.trim() || undefined,
            hideFutureWorkouts,
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
                : 'Choose a connection from the list.'
          )
          return
        }
        const res = await authedFetch(`/api/app/plans/${encodeURIComponent(planId)}/shares`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            isGroupTrainingPlan
              ? {
                  target: 'user',
                  peerUserId: selectedPeerId,
                  comment: comment.trim() || undefined,
                  hideFutureWorkouts,
                }
              : {
                  target: 'user',
                  peerUserId: selectedPeerId,
                  comment: comment.trim() || undefined,
                  allowEditing,
                }
          ),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || `Share failed (${res.status})`)
        }
      }
      onClose()
    } catch (e) {
      setShareError(e instanceof Error ? e.message : 'Share failed')
    } finally {
      setShareBusy(false)
    }
  }

  if (!open) return null

  const atCap = shareLimits
    ? shareLimits.destinationCount >= shareLimits.maxDestinations
    : false

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden
        onClick={() => !shareBusy && !loading && onClose()}
      />
      <div className="relative w-full max-w-md rounded-lg border border-gymnext-muted/30 bg-white shadow-lg">
        <div className="border-b border-gymnext-muted/30 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Share with…</h3>
          <p className="mt-1 text-xs text-gray-600 line-clamp-2">{planName}</p>
        </div>
        <div className="max-h-[min(70vh,32rem)] min-h-0 overflow-y-auto">
          {loading && (
            <div className="p-4">
              <p className="text-sm text-gray-500">Loading…</p>
            </div>
          )}
          {error && (
            <div className="space-y-3 p-4">
              <p className="text-sm text-red-600">{error}</p>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
                >
                  Close
                </button>
              </div>
            </div>
          )}
          {!loading && !error && (
            <div className="space-y-3 p-4">
              <div className="flex gap-4 text-sm">
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="shareTarget"
                    checked={shareTarget === 'user'}
                    onChange={() => {
                      setShareTarget('user')
                      setPickerQuery('')
                      setSelectedGroupId(null)
                      setSelectedPeerId(null)
                      setAllowEditing(false)
                      setHideFutureWorkouts(isGroupTrainingPlan)
                    }}
                  />
                  Connection
                </label>
                {allowsHubShare ? (
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="shareTarget"
                      checked={shareTarget === 'group'}
                      onChange={() => {
                        setShareTarget('group')
                        setPickerQuery('')
                        setSelectedGroupId(null)
                        setSelectedPeerId(null)
                        setAllowEditing(false)
                        setHideFutureWorkouts(true)
                      }}
                    />
                    Hub
                  </label>
                ) : null}
              </div>
              <div>
                {shareTarget === 'group' ? (
                  hubCount === 0 ? (
                    <p className="text-sm text-gray-500">You don&apos;t have any hubs to share with.</p>
                  ) : hubPickerIsDropdown ? (
                    <>
                      <label htmlFor="plan-share-select-hub" className="block text-xs font-medium text-gray-700 mb-1">
                        Select hub
                      </label>
                      <select
                        id="plan-share-select-hub"
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
                      <label htmlFor="plan-share-hub-search" className="block text-xs font-medium text-gray-700 mb-1">
                        Search hubs
                      </label>
                      <input
                        id="plan-share-hub-search"
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
                    <label htmlFor="plan-share-select-connection" className="block text-xs font-medium text-gray-700 mb-1">
                      Select connection
                    </label>
                    <select
                      id="plan-share-select-connection"
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
                    <label htmlFor="plan-share-connection-search" className="block text-xs font-medium text-gray-700 mb-1">
                      Search connections
                    </label>
                    <input
                      id="plan-share-connection-search"
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
              <div className="space-y-2">
                {shareTarget === 'user' && !isGroupTrainingPlan ? (
                  <PlanShareSwitchRow
                    id="plan-share-allow-edit"
                    label="Allow editing"
                    description="They can also modify and update the plan with you."
                    checked={allowEditing}
                    onCheckedChange={setAllowEditing}
                  />
                ) : null}
                {(shareTarget === 'group' ||
                  (shareTarget === 'user' && isGroupTrainingPlan)) && (
                  <PlanShareSwitchRow
                    id="plan-share-hide-future"
                    label="Hide future workouts"
                    description="Recipients only see scheduled workouts up to today unless you turn this off."
                    checked={hideFutureWorkouts}
                    onCheckedChange={setHideFutureWorkouts}
                  />
                )}
              </div>
              <div>
                <label htmlFor="plan-share-comment" className="block text-xs font-medium text-gray-700 mb-1">
                  Comment (optional)
                </label>
                <textarea
                  id="plan-share-comment"
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
        {!loading && !error && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-gymnext-muted/30 px-4 py-3">
            <button
              type="button"
              disabled={shareBusy}
              onClick={onClose}
              className="rounded bg-gymnext-background px-3 py-2 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                shareBusy ||
                atCap ||
                (shareTarget === 'group' ? !selectedGroupId : !selectedPeerId)
              }
              title={
                atCap
                  ? `You already have ${shareLimits?.maxDestinations ?? PLAN_SHARE_DESTINATION_CAP} share destinations for this plan.`
                  : undefined
              }
              onClick={() => void submitShare()}
              className="rounded px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#6B21A8' }}
            >
              {shareBusy ? 'Sharing…' : 'Share plan'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
