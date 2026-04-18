'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { Link2, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { PublicUserProfileDialog } from '@/components/PublicUserProfileDialog'
import { SendInviteLinkDialog } from '@/components/SendInviteLinkDialog'
import { UserSearchDialog } from '@/components/UserSearchDialog'
import { CONNECTIONS_LIST_REFRESH_EVENT, notifyConnectionsListRefresh } from '@/lib/connections-list-events'
import { notifyPendingInvitesNavChanged } from '@/hooks/usePendingInvitationsNavBadges'
import type { PublicUserProfileHubRow } from '@/types/public-profile'

type ListItem = {
  peerUserId: string
  displayName: string
  handle: string | null
  connectedAt: string | null
  sharedContentItemCount: number
}

type Detail = ListItem & {
  bio: string | null
  profilePhotoUrl: string | null
  city: string | null
  region: string | null
  country: string | null
  hubLookups: PublicUserProfileHubRow[]
}

function formatLocation(d: Pick<Detail, 'city' | 'region' | 'country'>): string | null {
  const parts = [d.city, d.region, d.country].filter((s) => s && s.trim())
  if (parts.length === 0) return null
  return parts.join(', ')
}

function formatConnectionSince(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  try {
    const dateStr = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(t))
    return `Connection since ${dateStr}`
  } catch {
    return null
  }
}

type IncomingInviteRow = {
  fromUserId: string
  displayName: string
  handle: string | null
  requestedAt: string | null
}

type SentInviteRow = {
  toUserId: string
  displayName: string
  handle: string | null
  requestedAt: string | null
}

function formatInviteDate(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(t))
  } catch {
    return null
  }
}

export function ConnectionsSection({ user }: { user: User }) {
  const [list, setList] = useState<ListItem[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [userSearchOpen, setUserSearchOpen] = useState(false)
  const [sendInviteLinkOpen, setSendInviteLinkOpen] = useState(false)
  const [inviteMenuOpen, setInviteMenuOpen] = useState(false)
  const [connectionMenuOpen, setConnectionMenuOpen] = useState(false)
  const [endConfirmOpen, setEndConfirmOpen] = useState(false)
  const [ending, setEnding] = useState(false)
  const [endError, setEndError] = useState<string | null>(null)
  const connectionMenuRef = useRef<HTMLDivElement | null>(null)
  const inviteMenuRef = useRef<HTMLDivElement | null>(null)

  const [incomingInvites, setIncomingInvites] = useState<IncomingInviteRow[]>([])
  const [incomingLoading, setIncomingLoading] = useState(true)
  const [incomingError, setIncomingError] = useState<string | null>(null)
  const [incomingActingId, setIncomingActingId] = useState<string | null>(null)

  const [sentInvites, setSentInvites] = useState<SentInviteRow[]>([])
  const [sentLoading, setSentLoading] = useState(true)
  const [sentError, setSentError] = useState<string | null>(null)
  const [sentCancelingId, setSentCancelingId] = useState<string | null>(null)
  const [sentInviteCancelConfirm, setSentInviteCancelConfirm] = useState<{
    toUserId: string
    displayName: string
  } | null>(null)
  const [sentCancelSubmitting, setSentCancelSubmitting] = useState(false)
  const [sentCancelModalError, setSentCancelModalError] = useState<string | null>(null)

  const [incomingInviteConfirm, setIncomingInviteConfirm] = useState<{
    action: 'accept' | 'decline'
    fromUserId: string
    displayName: string
  } | null>(null)
  const [incomingConfirmSubmitting, setIncomingConfirmSubmitting] = useState(false)
  const [incomingConfirmModalError, setIncomingConfirmModalError] = useState<string | null>(null)

  const [profileUserId, setProfileUserId] = useState<string | null>(null)

  const leftPanelLoading = incomingLoading || sentLoading || listLoading

  const loadIncomingInvites = useCallback(async () => {
    setIncomingLoading(true)
    setIncomingError(null)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/connections/requests', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; requests?: IncomingInviteRow[] }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setIncomingInvites(Array.isArray(data.requests) ? data.requests : [])
    } catch (e) {
      setIncomingError(e instanceof Error ? e.message : 'Failed to load invitations')
      setIncomingInvites([])
    } finally {
      setIncomingLoading(false)
    }
  }, [user])

  const loadSentInvites = useCallback(async () => {
    setSentLoading(true)
    setSentError(null)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/connections/requests/sent', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; requests?: SentInviteRow[] }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setSentInvites(Array.isArray(data.requests) ? data.requests : [])
    } catch (e) {
      setSentError(e instanceof Error ? e.message : 'Failed to load sent invitations')
      setSentInvites([])
    } finally {
      setSentLoading(false)
    }
  }, [user])

  const loadList = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/connections', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        connections?: ListItem[]
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const connections = Array.isArray(data.connections) ? data.connections : []
      setList(connections)
      setSelectedId((cur) => (cur && connections.some((m) => m.peerUserId === cur) ? cur : null))
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Failed to load connections')
      setList([])
    } finally {
      setListLoading(false)
    }
  }, [user])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    void loadIncomingInvites()
  }, [loadIncomingInvites])

  useEffect(() => {
    void loadSentInvites()
  }, [loadSentInvites])

  useEffect(() => {
    const onRefresh = () => {
      void loadList()
      void loadIncomingInvites()
      void loadSentInvites()
    }
    window.addEventListener(CONNECTIONS_LIST_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(CONNECTIONS_LIST_REFRESH_EVENT, onRefresh)
  }, [loadList, loadIncomingInvites, loadSentInvites])

  async function submitIncomingInviteConfirm() {
    const target = incomingInviteConfirm
    if (!target) return
    setIncomingConfirmSubmitting(true)
    setIncomingConfirmModalError(null)
    setIncomingActingId(target.fromUserId)
    try {
      const token = await user.getIdToken()
      if (target.action === 'accept') {
        const res = await fetch(
          `/api/app/connections/requests/${encodeURIComponent(target.fromUserId)}/accept`,
          { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
        )
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        toast.success(`You are now connected with ${target.displayName}.`)
        setIncomingInviteConfirm(null)
        notifyConnectionsListRefresh()
        notifyPendingInvitesNavChanged()
      } else {
        const res = await fetch(
          `/api/app/connections/requests/${encodeURIComponent(target.fromUserId)}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
        )
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        toast.success('Invitation declined.')
        setIncomingInviteConfirm(null)
        await loadIncomingInvites()
        notifyPendingInvitesNavChanged()
      }
    } catch (e) {
      setIncomingConfirmModalError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setIncomingConfirmSubmitting(false)
      setIncomingActingId(null)
    }
  }

  async function submitCancelSentInvite() {
    const target = sentInviteCancelConfirm
    if (!target) return
    setSentCancelSubmitting(true)
    setSentCancelModalError(null)
    setSentCancelingId(target.toUserId)
    try {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/app/connections/requests/sent/${encodeURIComponent(target.toUserId)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      )
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      toast.success('Invitation canceled.')
      setSentInviteCancelConfirm(null)
      notifyConnectionsListRefresh()
      await loadSentInvites()
    } catch (e) {
      setSentCancelModalError(e instanceof Error ? e.message : 'Could not cancel invitation')
    } finally {
      setSentCancelSubmitting(false)
      setSentCancelingId(null)
    }
  }

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      setDetailError(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    ;(async () => {
      try {
        const token = await user.getIdToken()
        const res = await fetch(`/api/app/connections/${encodeURIComponent(selectedId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = (await res.json().catch(() => ({}))) as Detail & { error?: string }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        if (!cancelled) setDetail(data as Detail)
      } catch (e) {
        if (!cancelled) {
          setDetail(null)
          setDetailError(e instanceof Error ? e.message : 'Failed to load connection')
        }
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId, user])

  useEffect(() => {
    setConnectionMenuOpen(false)
    setEndConfirmOpen(false)
    setEndError(null)
  }, [selectedId])

  useEffect(() => {
    if (!connectionMenuOpen) return
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const el = connectionMenuRef.current
      const t = e.target
      if (el && t instanceof Node && !el.contains(t)) setConnectionMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [connectionMenuOpen])

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

  async function confirmEndConnection() {
    if (!selectedId || !detail) return
    setEnding(true)
    setEndError(null)
    try {
      const token = await user.getIdToken()
      const res = await fetch(`/api/app/connections/${encodeURIComponent(selectedId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      toast.success(`You disconnected from ${detail.displayName}.`)
      setEndConfirmOpen(false)
      setSelectedId(null)
      setDetail(null)
      await loadList()
    } catch (e) {
      setEndError(e instanceof Error ? e.message : 'Failed to disconnect')
    } finally {
      setEnding(false)
    }
  }

  return (
    <div className="grid min-h-[28rem] w-full flex-1 gap-6 max-lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:min-h-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.8fr)] lg:grid-rows-[minmax(0,1fr)]">
      <PublicUserProfileDialog
        open={profileUserId != null}
        userId={profileUserId}
        onClose={() => setProfileUserId(null)}
        viewer={user}
      />
      <UserSearchDialog open={userSearchOpen} onClose={() => setUserSearchOpen(false)} user={user} />
      <SendInviteLinkDialog
        open={sendInviteLinkOpen}
        onClose={() => setSendInviteLinkOpen(false)}
        user={user}
      />
      {endConfirmOpen && detail && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !ending && setEndConfirmOpen(false)}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <h4 className="text-sm font-semibold text-gray-900">Disconnect from user?</h4>
            <p className="text-sm text-gray-600 mt-2">
              You will no longer be connected to{' '}
              <span className="font-medium text-gray-800">{detail.displayName}</span>.
            </p>
            {endError && <p className="text-sm text-red-600 mt-2">{endError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={ending}
                onClick={() => {
                  if (!ending) {
                    setEndError(null)
                    setEndConfirmOpen(false)
                  }
                }}
                className="rounded border border-gymnext-muted/40 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={ending}
                onClick={() => void confirmEndConnection()}
                className="rounded px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#b91c1c' }}
              >
                {ending ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
      {incomingInviteConfirm && (
        <div className="fixed inset-0 z-[57] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => {
              if (!incomingConfirmSubmitting) {
                setIncomingConfirmModalError(null)
                setIncomingInviteConfirm(null)
              }
            }}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <h4 className="text-sm font-semibold text-gray-900">
              {incomingInviteConfirm.action === 'accept'
                ? 'Accept invitation to connect?'
                : 'Decline invitation?'}
            </h4>
            <p className="text-sm text-gray-600 mt-2">
              {incomingInviteConfirm.action === 'accept' ? (
                <>
                  You will become connected with{' '}
                  <span className="font-medium text-gray-800">{incomingInviteConfirm.displayName}</span>.
                </>
              ) : (
                <>
                  This will dismiss the connection request from{' '}
                  <span className="font-medium text-gray-800">{incomingInviteConfirm.displayName}</span>.
                </>
              )}
            </p>
            {incomingConfirmModalError && (
              <p className="text-sm text-red-600 mt-2">{incomingConfirmModalError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={incomingConfirmSubmitting}
                onClick={() => {
                  if (!incomingConfirmSubmitting) {
                    setIncomingConfirmModalError(null)
                    setIncomingInviteConfirm(null)
                  }
                }}
                className="rounded border border-gymnext-muted/40 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={incomingConfirmSubmitting}
                onClick={() => void submitIncomingInviteConfirm()}
                className={`rounded px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 ${
                  incomingInviteConfirm.action === 'accept' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {incomingConfirmSubmitting
                  ? incomingInviteConfirm.action === 'accept'
                    ? 'Accepting…'
                    : 'Declining…'
                  : incomingInviteConfirm.action === 'accept'
                    ? 'Accept'
                    : 'Decline'}
              </button>
            </div>
          </div>
        </div>
      )}
      {sentInviteCancelConfirm && (
        <div className="fixed inset-0 z-[56] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => {
              if (!sentCancelSubmitting) {
                setSentCancelModalError(null)
                setSentInviteCancelConfirm(null)
              }
            }}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <h4 className="text-sm font-semibold text-gray-900">Cancel invitation to connect?</h4>
            <p className="text-sm text-gray-600 mt-2">
              This will withdraw your request to connect with{' '}
              <span className="font-medium text-gray-800">{sentInviteCancelConfirm.displayName}</span>.
            </p>
            {sentCancelModalError && <p className="text-sm text-red-600 mt-2">{sentCancelModalError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={sentCancelSubmitting}
                onClick={() => {
                  if (!sentCancelSubmitting) {
                    setSentCancelModalError(null)
                    setSentInviteCancelConfirm(null)
                  }
                }}
                className="rounded border border-gymnext-muted/40 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                Keep invitation
              </button>
              <button
                type="button"
                disabled={sentCancelSubmitting}
                onClick={() => void submitCancelSentInvite()}
                className="rounded px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#dc2626' }}
              >
                {sentCancelSubmitting ? 'Canceling…' : 'Cancel invitation'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex h-full min-h-[12rem] min-w-0 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white lg:min-h-0">
        <div className="shrink-0 border-b border-gymnext-muted/30 bg-gymnext-background px-4 py-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-gray-800">Connections</h3>
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
                    setUserSearchOpen(true)
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
                    setSendInviteLinkOpen(true)
                  }}
                >
                  <Link2 className="h-4 w-4 text-gray-500" aria-hidden />
                  Send Invite Link
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="h-2" aria-hidden />
            {leftPanelLoading && (
              <p className="px-4 py-3 text-sm text-gray-500">Loading connections…</p>
            )}
            {!leftPanelLoading && incomingError && (
              <div className="px-4 pb-3 space-y-2">
                <p className="text-sm text-red-700">{incomingError}</p>
                <button
                  type="button"
                  onClick={() => void loadIncomingInvites()}
                  className="w-fit rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  Retry
                </button>
              </div>
            )}
            {!leftPanelLoading && listError && (
              <div className="px-4 py-4 space-y-2">
                <p className="text-sm text-red-700">{listError}</p>
                <button
                  type="button"
                  onClick={() => void loadList()}
                  className="w-fit rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90"
                  style={{ backgroundColor: '#6B21A8' }}
                >
                  Retry
                </button>
              </div>
            )}
            {!leftPanelLoading && !listError && list.length === 0 && (
              <p className="px-4 py-3 text-sm text-gray-500">You have no connections yet.</p>
            )}
            {!leftPanelLoading && !listError && list.length > 0 && (
              <ul>
                {list.map((m, index) => {
                  const isSelected = selectedId === m.peerUserId
                  return (
                    <li key={m.peerUserId}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(m.peerUserId)}
                        className={`w-full text-left pl-3 pr-4 py-3 flex items-center gap-3 ${
                          index > 0 ? 'border-t border-gray-200' : ''
                        } ${isSelected ? 'bg-purple-50/80' : 'hover:bg-gray-100'}`}
                      >
                        <span
                          className="w-1 shrink-0 rounded-full self-stretch min-h-[2.5rem]"
                          style={{ backgroundColor: '#2563eb' }}
                          aria-hidden
                        />
                        {isSelected && (
                          <span className="shrink-0 text-[#2563eb]" aria-label="Selected connection">
                            ✓
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-gray-900 truncate">{m.displayName}</span>
                          <span className="block text-xs text-gray-500 truncate">
                            {m.handle?.trim() ? m.handle : 'Member'}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {!leftPanelLoading && sentError && (
              <p className="px-4 pt-3 text-xs text-red-600">{sentError}</p>
            )}
            {!leftPanelLoading && !incomingError && incomingInvites.length > 0 && (
              <>
                <div className="px-4 pt-5 pb-2 border-t border-gray-100">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                    Invitations to Connect
                  </h2>
                </div>
                <ul>
                  {incomingInvites.map((r, index) => {
                      const busy = incomingActingId === r.fromUserId
                      const handleLine = r.handle?.trim()
                        ? r.handle.startsWith('@')
                          ? r.handle
                          : `@${r.handle}`
                        : null
                      const when = formatInviteDate(r.requestedAt)
                      return (
                        <li
                          key={r.fromUserId}
                          className={`border-t border-gray-200 ${index === 0 ? 'border-t-0' : ''}`}
                        >
                          <div className="flex w-full items-center gap-3 pl-3 pr-4 py-3">
                            <span
                              className="w-1 shrink-0 self-stretch rounded-full min-h-[2.5rem]"
                              style={{ backgroundColor: '#6B21A8' }}
                              aria-hidden
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm leading-snug text-gray-900">
                                <button
                                  type="button"
                                  onClick={() => setProfileUserId(r.fromUserId)}
                                  className="max-w-full truncate text-left font-medium text-violet-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded align-baseline"
                                >
                                  {r.displayName || 'Member'}
                                </button>
                                {' invited you to connect'}
                              </p>
                              {handleLine && (
                                <p className="mt-0.5 truncate text-xs text-gray-600">{handleLine}</p>
                              )}
                              {when && (
                                <p className="mt-0.5 text-[11px] text-gray-500">Sent to you on {when}</p>
                              )}
                            </div>
                            <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row sm:items-center">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setIncomingConfirmModalError(null)
                                  setIncomingInviteConfirm({
                                    action: 'decline',
                                    fromUserId: r.fromUserId,
                                    displayName: r.displayName || 'this person',
                                  })
                                }}
                                className="inline-flex h-8 items-center justify-center rounded px-3 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                              >
                                {busy ? '…' : 'Decline'}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setIncomingConfirmModalError(null)
                                  setIncomingInviteConfirm({
                                    action: 'accept',
                                    fromUserId: r.fromUserId,
                                    displayName: r.displayName || 'Member',
                                  })
                                }}
                                className="inline-flex h-8 items-center justify-center rounded px-3 text-xs font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                              >
                                {busy ? '…' : 'Accept'}
                              </button>
                            </div>
                          </div>
                        </li>
                      )
                  })}
                </ul>
              </>
            )}
            {!leftPanelLoading && sentInvites.length > 0 && (
              <>
                <div className="px-4 pt-5 pb-2 border-t border-gray-100">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                    Pending Connections
                  </h2>
                </div>
                <ul>
                  {sentInvites.map((r, index) => {
                    const busy = sentCancelingId === r.toUserId
                    const handleLine = r.handle?.trim()
                      ? r.handle.startsWith('@')
                        ? r.handle
                        : `@${r.handle}`
                      : null
                    const when = formatInviteDate(r.requestedAt)
                    return (
                      <li
                        key={r.toUserId}
                        className={`flex items-stretch gap-3 border-gray-200 pl-3 pr-4 py-2 ${
                          index > 0 ? 'border-t' : ''
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3 py-1">
                          <span
                            className="w-1 shrink-0 self-stretch rounded-full min-h-[2.5rem]"
                            style={{ backgroundColor: '#a78bfa' }}
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm leading-snug text-gray-900">
                              You invited{' '}
                              <button
                                type="button"
                                onClick={() => setProfileUserId(r.toUserId)}
                                className="max-w-full truncate text-left font-medium text-violet-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded align-baseline"
                              >
                                {r.displayName || 'Member'}
                              </button>
                              {' to connect'}
                            </p>
                            {handleLine && (
                              <p className="mt-0.5 truncate text-xs text-gray-600">{handleLine}</p>
                            )}
                            {when && (
                              <p className="mt-0.5 text-[11px] text-gray-500">Sent by you on {when}</p>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSentCancelModalError(null)
                            setSentInviteCancelConfirm({
                              toUserId: r.toUserId,
                              displayName: r.displayName || 'this person',
                            })
                          }}
                          className="inline-flex h-8 shrink-0 self-center items-center justify-center rounded px-3 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                        >
                          {busy ? '…' : 'Cancel'}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex h-full min-h-[12rem] min-w-0 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white lg:min-h-0">
        {!selectedId && (
          <p className="flex flex-1 items-center justify-center px-4 py-8 text-sm text-gray-500 text-center">
            Select a connection to view their profile.
          </p>
        )}
        {selectedId && detailLoading && (
          <p className="flex flex-1 items-center justify-center px-4 py-8 text-sm text-gray-500 text-center">Loading…</p>
        )}
        {selectedId && !detailLoading && detailError && (
          <p className="flex flex-1 items-center px-4 py-6 text-sm text-red-700">{detailError}</p>
        )}
        {selectedId && !detailLoading && detail && !detailError && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-gray-100 px-4 py-3 flex items-start justify-between gap-3">
              <div className="flex items-start gap-4 min-w-0 flex-1">
                {detail.profilePhotoUrl ? (
                  <img
                    src={detail.profilePhotoUrl}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-full object-cover border border-gymnext-muted/30 bg-gray-100"
                    width={64}
                    height={64}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="h-16 w-16 shrink-0 rounded-full border border-gymnext-muted/30 bg-gymnext-muted/20 flex items-center justify-center text-lg font-semibold text-gray-600">
                    {(detail.displayName || '?').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-sm font-semibold text-gray-900">{detail.displayName}</p>
                  <p className="text-xs text-gray-600 mt-1">
                    {[detail.handle?.trim() ? detail.handle : null, formatConnectionSince(detail.connectedAt)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {formatLocation(detail) && (
                    <p className="text-xs text-gray-500 mt-1">{formatLocation(detail)}</p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 self-start justify-end" ref={connectionMenuRef}>
                <div className="relative">
                  <button
                    type="button"
                    aria-label="Connection options"
                    aria-expanded={connectionMenuOpen}
                    aria-haspopup="menu"
                    onClick={() => setConnectionMenuOpen((o) => !o)}
                    className="rounded border border-gymnext-muted/40 bg-white text-gray-700 text-lg leading-none w-9 h-8 flex items-center justify-center hover:bg-gray-50"
                  >
                    ⋯
                  </button>
                  {connectionMenuOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 top-full mt-1 z-20 min-w-[11rem] rounded-md border border-gymnext-muted/30 bg-white py-1 shadow-lg"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="w-full text-left px-3 py-2 text-sm text-red-700 hover:bg-red-50"
                        onClick={() => {
                          setConnectionMenuOpen(false)
                          setEndError(null)
                          setEndConfirmOpen(true)
                        }}
                      >
                        Disconnect
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {detail.bio?.trim() && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Bio</h4>
                  <div className="rounded-md border border-gray-200/80 bg-gray-50 px-3 py-2.5">
                    <p className="min-w-0 text-sm text-gray-700 whitespace-pre-wrap break-words">
                      {detail.bio.trim()}
                    </p>
                  </div>
                </div>
              )}
              {detail.hubLookups.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Hub profile</h4>
                  <ul className="space-y-1.5">
                    {detail.hubLookups.map((row) => (
                      <li key={row.label} className="text-sm text-gray-700">
                        <span className="font-medium text-gray-800">{row.label}:</span> {row.value}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
