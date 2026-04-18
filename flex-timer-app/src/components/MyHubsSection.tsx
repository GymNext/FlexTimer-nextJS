'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { Link2, Search } from 'lucide-react'
import { findHubInTree, type HubTreeNode } from '@/types/hub-tree'
import type { AppGroupType } from '@/types/group'
import { hubTypeCard } from '@/lib/hub-type-cards'
import { canHaveChildGroups } from '@/lib/subgroup-types'
import { normalizeGroupHandleKey } from '@/lib/group-handle'
import { CreateHubWizard } from '@/components/CreateHubWizard'
import { HubMembersInvitesPanel } from '@/components/HubMembersInvitesPanel'
import { InviteUsersDialog } from '@/components/InviteUsersDialog'
import { SendHubInviteLinkDialog } from '@/components/SendHubInviteLinkDialog'
import { NavCountBadge } from '@/components/NavCountBadge'
import {
  HUB_JOIN_REQUESTS_NAV_CHANGED_EVENT,
  notifyHubJoinRequestsNavChanged,
} from '@/hooks/useHubJoinRequestNavBadges'

function HubTreeItem({
  node,
  depth,
  showTopBorder,
  expandedIds,
  toggleExpanded,
  selectedHubId,
  onSelectHub,
}: {
  node: HubTreeNode
  depth: number
  showTopBorder: boolean
  expandedIds: Set<string>
  toggleExpanded: (id: string) => void
  selectedHubId: string | null
  onSelectHub: (id: string) => void
}) {
  const hasChildren = Boolean(node.children?.length)
  const isExpanded = expandedIds.has(node.id)
  const isSelected = selectedHubId === node.id
  const { emoji, barColor } = hubTypeCard(node.groupType)

  return (
    <li className="list-none">
      <div
        className={`flex items-center gap-0 pr-4 py-3 cursor-pointer bg-white ${
          showTopBorder ? 'border-t border-gray-200' : ''
        } ${isSelected ? '' : 'hover:bg-gray-100'}`}
        style={{ paddingLeft: Math.max(12, 4 + depth * 12) }}
        onClick={() => onSelectHub(node.id)}
      >
        <span
          className="w-1 shrink-0 rounded-full self-stretch min-h-[3rem]"
          style={{ backgroundColor: barColor }}
          aria-hidden
        />
        <div className="flex min-w-0 flex-1 items-center">
          <div className="flex shrink-0 items-center gap-1">
            {hasChildren ? (
              <button
                type="button"
                className="w-6 h-7 shrink-0 flex items-center justify-center rounded text-gray-500 hover:bg-gray-200/80"
                aria-expanded={isExpanded}
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleExpanded(node.id)
                }}
              >
                <span className="text-[10px] leading-none select-none" aria-hidden>
                  {isExpanded ? '▼' : '▶'}
                </span>
              </button>
            ) : (
              <span className="w-6 shrink-0" aria-hidden />
            )}
            {isSelected && (
              <span className="shrink-0 text-[#6B21A8]" aria-label="Active hub">
                ✓
              </span>
            )}
            <span className="text-2xl shrink-0 leading-none" aria-hidden>
              {emoji}
            </span>
          </div>
          <div className="min-w-0 flex-1 pl-3">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{node.name}</p>
              <NavCountBadge count={node.pendingJoinRequestCount ?? 0} />
            </div>
            <p className="mt-1 truncate text-xs text-gray-600">{node.subtitle}</p>
          </div>
        </div>
      </div>
      {hasChildren && isExpanded && (
        <ul className="ml-2 border-l border-gymnext-muted/25">
          {node.children!.map((child, index) => (
            <HubTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              showTopBorder={index > 0}
              expandedIds={expandedIds}
              toggleExpanded={toggleExpanded}
              selectedHubId={selectedHubId}
              onSelectHub={onSelectHub}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function MyHubsSection({ user }: { user: User }) {
  const [tree, setTree] = useState<HubTreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [selectedHubId, setSelectedHubId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createParentContext, setCreateParentContext] = useState<{
    id: string
    groupType: AppGroupType
  } | null>(null)
  const [editWizardOpen, setEditWizardOpen] = useState(false)
  const [editTargetId, setEditTargetId] = useState<string | null>(null)
  const [hubMenuOpen, setHubMenuOpen] = useState(false)
  const hubMenuRef = useRef<HTMLDivElement | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [changeHandleTarget, setChangeHandleTarget] = useState<{ id: string; name: string } | null>(null)
  const [changeHandleValue, setChangeHandleValue] = useState('')
  const [changeHandleFetchLoading, setChangeHandleFetchLoading] = useState(false)
  const [changeHandleFetchError, setChangeHandleFetchError] = useState<string | null>(null)
  const [changeHandleSaveError, setChangeHandleSaveError] = useState<string | null>(null)
  const [changeHandleSaving, setChangeHandleSaving] = useState(false)
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [inviteLinkDialogOpen, setInviteLinkDialogOpen] = useState(false)
  const [inviteMenuOpen, setInviteMenuOpen] = useState(false)
  const inviteMenuRef = useRef<HTMLDivElement | null>(null)
  const [hubPanelRefresh, setHubPanelRefresh] = useState(0)

  const loadOwnedHubTreeFromApi = useCallback(async (): Promise<HubTreeNode[]> => {
    const token = await user.getIdToken()
    const res = await fetch('/api/app/owned-groups', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = (await res.json().catch(() => ({}))) as {
      error?: string
      hubs?: HubTreeNode[]
      pendingJoinRequestTotal?: number
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return Array.isArray(data.hubs) ? data.hubs : []
  }, [user])

  /** When `syncNavBadges` is true (default), notifies so the Connect → Hubs nav count refetches. */
  const fetchOwnedHubTree = useCallback(
    async (options?: { syncNavBadges?: boolean }): Promise<HubTreeNode[]> => {
      const hubs = await loadOwnedHubTreeFromApi()
      if (options?.syncNavBadges !== false) {
        notifyHubJoinRequestsNavChanged()
      }
      return hubs
    },
    [loadOwnedHubTreeFromApi],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchOwnedHubTree({ syncNavBadges: false })
      .then((hubs) => {
        if (!cancelled) {
          setTree(hubs)
          setSelectedHubId((cur) => (cur && findHubInTree(hubs, cur) ? cur : null))
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load hubs')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchOwnedHubTree])

  useEffect(() => {
    const onJoinRequestContextChanged = () => {
      void loadOwnedHubTreeFromApi()
        .then((hubs) => {
          setTree(hubs)
          setSelectedHubId((cur) => (cur && findHubInTree(hubs, cur) ? cur : null))
        })
        .catch(() => {
          /* keep existing tree */
        })
    }
    window.addEventListener(HUB_JOIN_REQUESTS_NAV_CHANGED_EVENT, onJoinRequestContextChanged)
    return () => window.removeEventListener(HUB_JOIN_REQUESTS_NAV_CHANGED_EVENT, onJoinRequestContextChanged)
  }, [loadOwnedHubTreeFromApi])

  useEffect(() => {
    if (!hubMenuOpen) return
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const el = hubMenuRef.current
      if (!el) return
      const t = e.target
      if (t instanceof Node && !el.contains(t)) setHubMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [hubMenuOpen])

  useEffect(() => {
    setHubMenuOpen(false)
    setChangeHandleTarget(null)
    setInviteDialogOpen(false)
    setInviteLinkDialogOpen(false)
    setInviteMenuOpen(false)
  }, [selectedHubId])

  useEffect(() => {
    if (!inviteMenuOpen) return
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const el = inviteMenuRef.current
      const t = e.target
      if (el && t instanceof Node && !el.contains(t)) setInviteMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [inviteMenuOpen])

  useEffect(() => {
    const id = changeHandleTarget?.id
    if (!id) {
      setChangeHandleValue('')
      setChangeHandleFetchLoading(false)
      setChangeHandleFetchError(null)
      setChangeHandleSaveError(null)
      return
    }
    let cancelled = false
    setChangeHandleFetchLoading(true)
    setChangeHandleFetchError(null)
    ;(async () => {
      try {
        const token = await user.getIdToken()
        const res = await fetch(`/api/app/groups/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string; handle?: string }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        if (!cancelled) setChangeHandleValue(typeof data.handle === 'string' ? data.handle : '')
      } catch (e) {
        if (!cancelled) {
          setChangeHandleFetchError(e instanceof Error ? e.message : 'Failed to load hub')
        }
      } finally {
        if (!cancelled) setChangeHandleFetchLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [changeHandleTarget?.id, user])

  const selectedHub = useMemo(
    () => (selectedHubId ? findHubInTree(tree, selectedHubId) : null),
    [selectedHubId, tree]
  )

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const onSelectHub = (id: string) => {
    setSelectedHubId((cur) => (cur === id ? null : id))
  }

  async function retry() {
    setLoading(true)
    setError(null)
    try {
      const hubs = await fetchOwnedHubTree()
      setTree(hubs)
      setSelectedHubId((cur) => (cur && findHubInTree(hubs, cur) ? cur : null))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load hubs')
    } finally {
      setLoading(false)
    }
  }

  const handleHubCreated = useCallback(
    async (groupId: string) => {
      const parentToExpand = createParentContext?.id ?? null
      try {
        const hubs = await fetchOwnedHubTree({ syncNavBadges: false })
        setTree(hubs)
        setSelectedHubId(groupId)
        setExpandedIds((prev) => {
          const n = new Set(prev)
          if (parentToExpand) n.add(parentToExpand)
          return n
        })
      } catch {
        setSelectedHubId(groupId)
      }
    },
    [createParentContext, fetchOwnedHubTree],
  )

  const handleHubUpdated = useCallback(
    async (groupId: string) => {
      try {
        const hubs = await fetchOwnedHubTree({ syncNavBadges: false })
        setTree(hubs)
        setSelectedHubId((cur) => (cur && findHubInTree(hubs, cur) ? cur : groupId))
      } catch {
        /* keep existing tree */
      }
    },
    [fetchOwnedHubTree],
  )

  const closeWizard = useCallback(() => {
    setCreateOpen(false)
    setCreateParentContext(null)
    setEditWizardOpen(false)
    setEditTargetId(null)
  }, [])

  async function confirmDeleteHub() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const token = await user.getIdToken()
      const res = await fetch(`/api/app/groups/${encodeURIComponent(deleteTarget.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const hubs = await fetchOwnedHubTree()
      setTree(hubs)
      setSelectedHubId((cur) => (cur === deleteTarget.id ? null : cur && findHubInTree(hubs, cur) ? cur : null))
      setDeleteTarget(null)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete hub')
    } finally {
      setDeleting(false)
    }
  }

  async function saveChangedHandle() {
    if (!changeHandleTarget) return
    const trimmed = changeHandleValue.trim()
    if (!normalizeGroupHandleKey(trimmed)) {
      setChangeHandleSaveError('Use 1–64 characters: letters, numbers, . _ -')
      return
    }
    setChangeHandleSaving(true)
    setChangeHandleSaveError(null)
    try {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/app/groups/${encodeURIComponent(changeHandleTarget.id)}/handle`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ handle: trimmed }),
        },
      )
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const hubs = await fetchOwnedHubTree({ syncNavBadges: false })
      setTree(hubs)
      setChangeHandleTarget(null)
    } catch (e) {
      setChangeHandleSaveError(e instanceof Error ? e.message : 'Failed to update handle')
    } finally {
      setChangeHandleSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col">
      {deleteTarget && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !deleting && setDeleteTarget(null)}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <h4 className="text-sm font-semibold text-gray-900">Delete hub?</h4>
            <p className="text-sm text-gray-600 mt-2">
              This will remove <span className="font-medium text-gray-800">{deleteTarget.name}</span> from
              your hubs. This cannot be undone from here.
            </p>
            {deleteError && <p className="text-sm text-red-600 mt-2">{deleteError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  if (!deleting) {
                    setDeleteError(null)
                    setDeleteTarget(null)
                  }
                }}
                className="rounded border border-gymnext-muted/40 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDeleteHub()}
                className="rounded px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#b91c1c' }}
              >
                {deleting ? 'Deleting…' : 'Delete hub'}
              </button>
            </div>
          </div>
        </div>
      )}

      {changeHandleTarget && (
        <div className="fixed inset-0 z-[56] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !changeHandleSaving && setChangeHandleTarget(null)}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <h4 className="text-sm font-semibold text-gray-900">Change handle</h4>
            <p className="text-xs text-gray-600 mt-1">
              Hub: <span className="font-medium text-gray-800">{changeHandleTarget.name}</span>
            </p>
            {changeHandleFetchLoading && (
              <p className="text-sm text-gray-500 mt-4">Loading current handle…</p>
            )}
            {changeHandleFetchError && (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-red-600">{changeHandleFetchError}</p>
                <button
                  type="button"
                  onClick={() => setChangeHandleTarget(null)}
                  className="rounded bg-gymnext-background px-3 py-1.5 text-sm font-medium text-gymnext-dark hover:bg-gymnext-muted/30"
                >
                  Close
                </button>
              </div>
            )}
            {!changeHandleFetchLoading && !changeHandleFetchError && (
              <>
                <label htmlFor="change-hub-handle" className="block text-xs font-medium text-gray-700 mt-4 mb-1">
                  Handle
                </label>
                <input
                  id="change-hub-handle"
                  value={changeHandleValue}
                  onChange={(e) => setChangeHandleValue(e.target.value)}
                  placeholder="e.g. northside"
                  autoComplete="off"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gymnext focus:outline-none focus:ring-1 focus:ring-gymnext"
                />
                {changeHandleValue.trim() && !normalizeGroupHandleKey(changeHandleValue.trim()) && (
                  <p className="text-xs text-red-600 mt-1">Use 1–64 characters: letters, numbers, . _ -</p>
                )}
                {changeHandleSaveError && (
                  <p className="text-sm text-red-600 mt-2">{changeHandleSaveError}</p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={changeHandleSaving}
                    onClick={() => {
                      if (!changeHandleSaving) setChangeHandleTarget(null)
                    }}
                    className="rounded border border-gymnext-muted/40 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      changeHandleSaving ||
                      !normalizeGroupHandleKey(changeHandleValue.trim())
                    }
                    onClick={() => void saveChangedHandle()}
                    className="rounded px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                    style={{ backgroundColor: '#6B21A8' }}
                  >
                    {changeHandleSaving ? 'Saving…' : 'Save handle'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <InviteUsersDialog
        open={inviteDialogOpen}
        onClose={() => setInviteDialogOpen(false)}
        user={user}
        targetGroupId={inviteDialogOpen && selectedHub ? selectedHub.id : null}
        onInviteSent={() => setHubPanelRefresh((n) => n + 1)}
      />

      <SendHubInviteLinkDialog
        open={inviteLinkDialogOpen}
        onClose={() => setInviteLinkDialogOpen(false)}
        user={user}
        groupId={inviteLinkDialogOpen && selectedHub ? selectedHub.id : null}
        fallbackName={selectedHub?.name ?? null}
      />

      <CreateHubWizard
        open={createOpen || editWizardOpen}
        onClose={closeWizard}
        user={user}
        parentHub={createParentContext}
        editGroupId={editWizardOpen && editTargetId ? editTargetId : null}
        onCreated={handleHubCreated}
        onUpdated={handleHubUpdated}
      />

      <div className="grid min-h-0 w-full flex-1 gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.8fr)] lg:grid-rows-[minmax(0,1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gymnext-muted/30 bg-gymnext-background px-4 py-3">
            <h3 className="text-sm font-medium text-gray-800">Hubs</h3>
            <button
              type="button"
              onClick={() => {
                setEditWizardOpen(false)
                setEditTargetId(null)
                setCreateParentContext(null)
                setCreateOpen(true)
              }}
              className="shrink-0 rounded px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              style={{ backgroundColor: '#6B21A8' }}
            >
              Create Hub
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && <p className="px-4 py-6 text-sm text-gray-500">Loading your hubs…</p>}
            {!loading && error && (
              <div className="space-y-2 px-4 py-4">
                <p className="text-sm text-red-700">{error}</p>
                <button
                  type="button"
                  onClick={() => void retry()}
                  className="rounded px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  Retry
                </button>
              </div>
            )}
            {!loading && !error && tree.length === 0 && (
              <div className="space-y-2 px-4 py-6 text-sm text-gray-500">
                <p>You have no hubs</p>
              </div>
            )}
            {!loading && !error && tree.length > 0 && (
              <ul className="bg-white">
                {tree.map((node, index) => (
                  <HubTreeItem
                    key={node.id}
                    node={node}
                    depth={0}
                    showTopBorder={index > 0}
                    expandedIds={expandedIds}
                    toggleExpanded={toggleExpanded}
                    selectedHubId={selectedHubId}
                    onSelectHub={onSelectHub}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex h-full min-h-[12rem] min-w-0 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white lg:min-h-0">
          {loading ? (
            <p className="flex flex-1 items-center justify-center px-4 py-8 text-center text-sm text-gray-500">
              Loading…
            </p>
          ) : !selectedHub ? (
            <p className="flex flex-1 items-center justify-center px-4 py-8 text-center text-sm text-gray-500">
              Select a hub from the list to view its details.
            </p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{selectedHub.name}</p>
                  <p className="text-xs text-gray-600 mt-1">{selectedHub.subtitle}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 self-start">
                  <div className="relative" ref={inviteMenuRef}>
                    <button
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={inviteMenuOpen}
                      onClick={() => setInviteMenuOpen((o) => !o)}
                      className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                      style={{ backgroundColor: '#6B21A8' }}
                    >
                      Invite Users
                      <svg
                        viewBox="0 0 12 12"
                        aria-hidden
                        className={`h-3 w-3 transition-transform ${inviteMenuOpen ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 4.5 6 7.5l3-3" />
                      </svg>
                    </button>
                    {inviteMenuOpen && (
                      <div
                        role="menu"
                        className="absolute right-0 top-full mt-1 z-20 min-w-[12rem] rounded-md border border-gymnext-muted/30 bg-white py-1 shadow-lg"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-gray-100 flex items-center gap-2"
                          onClick={() => {
                            setInviteMenuOpen(false)
                            setInviteDialogOpen(true)
                          }}
                        >
                          <Search className="h-4 w-4 text-gray-500" aria-hidden />
                          Search Users
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-gray-100 flex items-center gap-2"
                          onClick={() => {
                            setInviteMenuOpen(false)
                            setInviteLinkDialogOpen(true)
                          }}
                        >
                          <Link2 className="h-4 w-4 text-gray-500" aria-hidden />
                          Invite via Link
                        </button>
                      </div>
                    )}
                  </div>
                  {selectedHub.groupType != null && canHaveChildGroups(selectedHub.groupType) && (
                    <button
                      type="button"
                      onClick={() => {
                        const gt = selectedHub.groupType
                        if (gt == null || !canHaveChildGroups(gt)) return
                        setEditWizardOpen(false)
                        setEditTargetId(null)
                        setCreateParentContext({ id: selectedHub.id, groupType: gt })
                        setCreateOpen(true)
                      }}
                      className="rounded px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                      style={{ backgroundColor: '#6B21A8' }}
                    >
                      Create Sub Hub
                    </button>
                  )}
                  <div className="relative" ref={hubMenuRef}>
                    <button
                      type="button"
                      aria-label="Hub actions"
                      aria-expanded={hubMenuOpen}
                      aria-haspopup="menu"
                      onClick={() => setHubMenuOpen((o) => !o)}
                      className="flex h-8 w-9 items-center justify-center rounded border border-gymnext-muted/40 bg-white text-lg leading-none text-gray-700 hover:bg-gray-50"
                    >
                      ⋯
                    </button>
                    {hubMenuOpen && (
                      <div
                        role="menu"
                        className="absolute right-0 top-full z-20 mt-1 min-w-[10rem] rounded-md border border-gymnext-muted/30 bg-white py-1 shadow-lg"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                          onClick={() => {
                            setHubMenuOpen(false)
                            setCreateOpen(false)
                            setCreateParentContext(null)
                            setEditTargetId(selectedHub.id)
                            setEditWizardOpen(true)
                          }}
                        >
                          Edit hub
                        </button>
                        {!selectedHub.parentGroupId && (
                          <button
                            type="button"
                            role="menuitem"
                            className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                            onClick={() => {
                              setHubMenuOpen(false)
                              setChangeHandleSaveError(null)
                              setChangeHandleFetchError(null)
                              setChangeHandleTarget({ id: selectedHub.id, name: selectedHub.name })
                            }}
                          >
                            Change handle
                          </button>
                        )}
                        <div
                          role="separator"
                          className="my-1 border-t border-gymnext-muted/30"
                          aria-orientation="horizontal"
                        />
                        <button
                          type="button"
                          role="menuitem"
                          className="w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
                          onClick={() => {
                            setHubMenuOpen(false)
                            setDeleteError(null)
                            setDeleteTarget({ id: selectedHub.id, name: selectedHub.name })
                          }}
                        >
                          Delete hub
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <HubMembersInvitesPanel
                  groupId={selectedHub.id}
                  user={user}
                  refreshKey={hubPanelRefresh}
                  joinPolicy={selectedHub.joinPolicy}
                  onOwnerDataChanged={() => setHubPanelRefresh((k) => k + 1)}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
