'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import toast from 'react-hot-toast'
import { notifyConnectionsListRefresh } from '@/lib/connections-list-events'
import type { PublicUserProfileView, ViewerConnectionState } from '@/types/public-profile'

function ConnectedLinkIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
      />
    </svg>
  )
}

function formatLocation(p: PublicUserProfileView): string | null {
  const parts = [p.city, p.region, p.country].filter((s): s is string => Boolean(s && s.trim()))
  if (parts.length === 0) return null
  return parts.join(', ')
}

export function PublicUserProfileDialog({
  open,
  userId,
  onClose,
  viewer,
}: {
  open: boolean
  userId: string | null
  onClose: () => void
  viewer: User
}) {
  const [profile, setProfile] = useState<PublicUserProfileView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectBusy, setConnectBusy] = useState(false)

  const loadProfile = useCallback(async () => {
    if (!userId) return
    const token = await viewer.getIdToken()
    const res = await fetch(`/api/app/users/${encodeURIComponent(userId)}/public-profile`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = (await res.json().catch(() => ({}))) as PublicUserProfileView & { error?: string }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    setProfile(data as PublicUserProfileView)
  }, [userId, viewer])

  useEffect(() => {
    if (!open || !userId) {
      setProfile(null)
      setError(null)
      setLoading(false)
      setConnectBusy(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setProfile(null)
    ;(async () => {
      try {
        await loadProfile()
        if (!cancelled) setError(null)
      } catch (e) {
        if (!cancelled) {
          setProfile(null)
          setError(e instanceof Error ? e.message : 'Failed to load profile')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, userId, loadProfile])

  if (!open || !userId) return null

  const loc = profile ? formatLocation(profile) : null
  const isSelf = viewer.uid === userId
  const vc: ViewerConnectionState | undefined = profile?.viewerConnection

  async function handleConnect() {
    if (!userId || connectBusy || isSelf) return
    setConnectBusy(true)
    try {
      const token = await viewer.getIdToken()
      const res = await fetch('/api/app/connections/requests', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ toUserId: userId }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; kind?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const kind = data.kind
      if (kind === 'created') {
        toast.success('Connection request sent.')
      } else if (kind === 'alreadyPending') {
        toast.success('Request already pending.')
      } else if (kind === 'alreadyConnected') {
        toast.success('You are already connected.')
      } else if (kind === 'incomingExists') {
        toast('They already sent you a request — accept it under Connections.', { icon: 'ℹ️' })
      }
      notifyConnectionsListRefresh()
      try {
        await loadProfile()
      } catch (refreshErr) {
        toast.error(refreshErr instanceof Error ? refreshErr.message : 'Could not refresh profile')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send request')
    } finally {
      setConnectBusy(false)
    }
  }

  function renderConnectionAction() {
    if (isSelf || loading || error || !profile) return <span className="w-16 shrink-0" aria-hidden />
    if (!vc) return <span className="w-16 shrink-0" aria-hidden />

    if (vc.connected) {
      return (
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-900"
          title="Connected"
          aria-label="You are connected with this member"
        >
          <ConnectedLinkIcon className="h-6 w-6" />
        </span>
      )
    }
    if (vc.outgoingRequestPending) {
      return (
        <span className="text-[11px] font-medium text-gray-500 text-right leading-tight max-w-[5.5rem]">
          Invite sent
        </span>
      )
    }
    if (vc.incomingRequestPending) {
      return (
        <span className="text-[11px] font-medium text-gray-500 text-right leading-tight max-w-[5.5rem]">
          Invited you
        </span>
      )
    }
    return (
      <button
        type="button"
        disabled={connectBusy}
        onClick={() => void handleConnect()}
        className="shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        style={{ backgroundColor: '#6B21A8' }}
      >
        {connectBusy ? '…' : 'Connect'}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[min(90vh,36rem)] flex flex-col rounded-lg border border-gymnext-muted/30 bg-white shadow-lg overflow-hidden">
        <div className="border-b border-gymnext-muted/30 px-3 py-3 flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="text-gray-500 hover:text-gray-800 text-lg leading-none px-1 shrink-0 w-9 flex justify-start"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
          <h3 className="text-sm font-semibold text-gray-800 text-center flex-1 min-w-0 truncate px-1">
            Profile
          </h3>
          <div className="shrink-0 flex min-w-0 items-center justify-end">{renderConnectionAction()}</div>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0 p-4">
          {loading && <p className="text-sm text-gray-500 text-center py-6">Loading…</p>}
          {!loading && error && <p className="text-sm text-red-600 text-center py-6">{error}</p>}
          {!loading && !error && profile && (
            <div className="space-y-4">
              <div className="flex gap-4 items-start">
                {profile.profilePhotoUrl ? (
                  <img
                    src={profile.profilePhotoUrl}
                    alt=""
                    className="h-20 w-20 rounded-full object-cover border border-gymnext-muted/30 bg-gymnext-background shrink-0"
                    width={80}
                    height={80}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div
                    className="h-20 w-20 shrink-0 rounded-full border border-gymnext-muted/30 bg-gymnext-background flex items-center justify-center text-2xl font-semibold text-gray-600"
                    aria-hidden
                  >
                    {(profile.displayName || '?').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold text-gray-900 leading-snug">{profile.displayName}</p>
                  {profile.handle && (
                    <p className="text-sm text-gray-600 mt-1">{profile.handle}</p>
                  )}
                  {loc && <p className="text-xs text-gray-500 mt-2">{loc}</p>}
                </div>
              </div>
              {profile.bio && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Bio</h4>
                  <p className="mt-1 min-w-0 whitespace-pre-wrap break-words text-sm text-gray-800">
                    {profile.bio}
                  </p>
                </div>
              )}
              {profile.hubLookups.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Training</h4>
                  <ul className="mt-2 space-y-1.5">
                    {profile.hubLookups.map((row) => (
                      <li key={row.label} className="text-sm flex gap-2">
                        <span className="text-gray-500 shrink-0">{row.label}:</span>
                        <span className="text-gray-900">{row.value}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
