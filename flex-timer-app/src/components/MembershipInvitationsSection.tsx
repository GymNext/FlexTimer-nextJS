'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import toast from 'react-hot-toast'
import { GroupPublicProfileDialog } from '@/components/GroupPublicProfileDialog'
import { notifyPendingInvitesNavChanged } from '@/hooks/usePendingInvitationsNavBadges'
import { PublicUserProfileDialog } from '@/components/PublicUserProfileDialog'
import type { AppGroupJoinPolicy, AppGroupType } from '@/types/group'
import { hubTypeCard } from '@/lib/hub-type-cards'

type InviteRow = {
  groupId: string
  groupName: string
  handleDisplay: string | null
  groupType: AppGroupType | null
  joinPolicy: AppGroupJoinPolicy
  invitedAt: string | null
  invitedByUserId: string
  invitedByDisplayName: string
  invitedByHandle: string | null
}

const MAX_VISIBLE_INVITATIONS = 5

function formatHandleLine(handle: string | null | undefined): string | null {
  const h = handle?.trim()
  if (!h) return null
  return h.startsWith('@') ? h : `@${h}`
}

function formatInvitedAt(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(t))
  } catch {
    return null
  }
}

export function MembershipInvitationsSection({
  user,
  variant = 'default',
  onInvitesChanged,
}: {
  user: User
  /** `leftPanel`: inline rows like Connections → “Invitations to Connect”; omit when empty. */
  variant?: 'default' | 'leftPanel'
  /** Called after accept/decline so the parent can refresh (e.g. memberships list). */
  onInvitesChanged?: () => void | Promise<void>
}) {
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [profileGroupId, setProfileGroupId] = useState<string | null>(null)
  const [inviterProfileUserId, setInviterProfileUserId] = useState<string | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)
  const [declineInviteConfirm, setDeclineInviteConfirm] = useState<{
    groupId: string
    groupName: string
  } | null>(null)
  const [declineSubmitting, setDeclineSubmitting] = useState(false)
  const [declineModalError, setDeclineModalError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/memberships/invites', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; invites?: InviteRow[] }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setInvites(Array.isArray(data.invites) ? data.invites : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invitations')
      setInvites([])
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  const accept = useCallback(
    async (groupId: string, groupName: string) => {
      setActingId(groupId)
      try {
        const token = await user.getIdToken()
        const res = await fetch(`/api/app/memberships/invites/${encodeURIComponent(groupId)}/accept`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        toast.success(`You joined ${groupName}.`)
        await load()
        notifyPendingInvitesNavChanged()
        await onInvitesChanged?.()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not accept')
      } finally {
        setActingId(null)
      }
    },
    [user, load, onInvitesChanged],
  )

  async function submitDeclineInvite() {
    const target = declineInviteConfirm
    if (!target) return
    setDeclineSubmitting(true)
    setDeclineModalError(null)
    setActingId(target.groupId)
    try {
      const token = await user.getIdToken()
      const res = await fetch(`/api/app/memberships/invites/${encodeURIComponent(target.groupId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      toast.success('Invitation declined.')
      setDeclineInviteConfirm(null)
      await load()
      notifyPendingInvitesNavChanged()
      await onInvitesChanged?.()
    } catch (e) {
      setDeclineModalError(e instanceof Error ? e.message : 'Could not decline')
    } finally {
      setDeclineSubmitting(false)
      setActingId(null)
    }
  }

  if (variant === 'leftPanel' && loading && invites.length === 0 && !error) {
    return null
  }
  if (variant === 'leftPanel' && !loading && !error && invites.length === 0) {
    return null
  }

  return (
    <>
      <GroupPublicProfileDialog
        open={profileGroupId != null}
        groupId={profileGroupId}
        onClose={() => setProfileGroupId(null)}
        viewer={user}
      />
      <PublicUserProfileDialog
        open={inviterProfileUserId != null}
        userId={inviterProfileUserId}
        onClose={() => setInviterProfileUserId(null)}
        viewer={user}
      />
      {declineInviteConfirm && (
        <div className="fixed inset-0 z-[56] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => {
              if (!declineSubmitting) {
                setDeclineModalError(null)
                setDeclineInviteConfirm(null)
              }
            }}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <h4 className="text-sm font-semibold text-gray-900">Decline membership invitation?</h4>
            <p className="text-sm text-gray-600 mt-2">
              You will decline the invitation to join{' '}
              <span className="font-medium text-gray-800">{declineInviteConfirm.groupName}</span>.
            </p>
            {declineModalError && <p className="text-sm text-red-600 mt-2">{declineModalError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={declineSubmitting}
                onClick={() => {
                  if (!declineSubmitting) {
                    setDeclineModalError(null)
                    setDeclineInviteConfirm(null)
                  }
                }}
                className="rounded border border-gymnext-muted/40 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                Go back
              </button>
              <button
                type="button"
                disabled={declineSubmitting}
                onClick={() => void submitDeclineInvite()}
                className="rounded px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#dc2626' }}
              >
                {declineSubmitting ? 'Declining…' : 'Decline invitation'}
              </button>
            </div>
          </div>
        </div>
      )}
      {variant === 'leftPanel' ? (
        <>
          {error && (
            <div className="px-4 pt-5 pb-3 border-t border-gray-100 space-y-2">
              <p className="text-sm text-red-700">{error}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="w-fit rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90"
                style={{ backgroundColor: '#6B21A8' }}
              >
                Retry
              </button>
            </div>
          )}
          {!error && invites.length > 0 && (
            <div>
              <div className="px-4 pt-5 pb-2 border-t border-gray-100">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                  Invitations to join a hub
                </h2>
              </div>
              <ul>
                {invites.map((inv, index) => {
                  const busy = actingId === inv.groupId
                  const card = hubTypeCard(inv.groupType)
                  const when = formatInvitedAt(inv.invitedAt)
                  const hubHandleLine = formatHandleLine(inv.handleDisplay)
                  return (
                    <li
                      key={inv.groupId}
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
                            {inv.invitedByUserId.trim() ? (
                              <button
                                type="button"
                                onClick={() => setInviterProfileUserId(inv.invitedByUserId)}
                                className="max-w-full truncate text-left font-medium text-violet-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded align-baseline"
                              >
                                {inv.invitedByDisplayName || 'Member'}
                              </button>
                            ) : (
                              <span className="font-medium text-gray-900">
                                {inv.invitedByDisplayName || 'Member'}
                              </span>
                            )}
                            {' invited you to join '}
                            <button
                              type="button"
                              onClick={() => setProfileGroupId(inv.groupId)}
                              className="max-w-full truncate text-left font-medium text-violet-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded align-baseline"
                            >
                              {inv.groupName}
                            </button>
                          </p>
                          {(hubHandleLine || card.title) && (
                            <p className="mt-0.5 truncate text-xs text-gray-600">
                              {[card.title, hubHandleLine].filter(Boolean).join(' · ')}
                            </p>
                          )}
                          {when && (
                            <p className="mt-0.5 text-[11px] text-gray-500">Invited {when}</p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row sm:items-center">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setDeclineModalError(null)
                              setDeclineInviteConfirm({ groupId: inv.groupId, groupName: inv.groupName })
                            }}
                            className="inline-flex h-8 items-center justify-center rounded px-3 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                          >
                            {busy ? '…' : 'Decline'}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void accept(inv.groupId, inv.groupName)}
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
            </div>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-gymnext-muted/30 bg-white shadow-sm min-h-[12rem] overflow-x-hidden overflow-y-visible">
          <div className="border-b border-gymnext-muted/30 bg-gymnext-background px-4 py-3">
            <h3 className="text-sm font-medium text-gray-800">Invitations</h3>
            <p className="text-xs text-gray-500 mt-0.5">Hub invitations sent to you.</p>
          </div>
          {loading && <p className="px-4 py-6 text-sm text-gray-500">Loading invitations…</p>}
          {!loading && error && (
            <div className="px-4 py-4 space-y-2">
              <p className="text-sm text-red-700">{error}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="rounded text-white text-xs font-medium px-3 py-1.5 hover:opacity-90"
                style={{ backgroundColor: '#6B21A8' }}
              >
                Retry
              </button>
            </div>
          )}
          {!loading && !error && invites.length === 0 && (
            <p className="px-4 py-6 text-sm text-gray-500">No hub invitations right now.</p>
          )}
          {!loading && !error && invites.length > 0 && (
            <>
              <ul className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-2">
                {invites.slice(0, MAX_VISIBLE_INVITATIONS).map((inv) => {
                  const busy = actingId === inv.groupId
                  const card = hubTypeCard(inv.groupType)
                  const when = formatInvitedAt(inv.invitedAt)
                  const hubHandleLine = formatHandleLine(inv.handleDisplay)
                  return (
                    <li key={inv.groupId} className="min-w-0">
                      <div className="flex h-full min-h-0 flex-col rounded-lg border border-gray-200 bg-gymnext-background/30 p-3">
                        <div className="flex min-w-0 flex-1 gap-3">
                          <span
                            className="mt-0.5 w-1 shrink-0 self-stretch rounded-full min-h-[2.5rem]"
                            style={{ backgroundColor: card.barColor }}
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => setProfileGroupId(inv.groupId)}
                              className="text-left text-sm font-semibold text-violet-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
                            >
                              {inv.groupName}
                            </button>
                            <p className="mt-0.5 text-xs text-gray-600">
                              {card.title}
                              {hubHandleLine ? ` · ${hubHandleLine}` : ''}
                            </p>
                            <p className="mt-2 text-xs text-gray-700">
                              From{' '}
                              {inv.invitedByUserId.trim() ? (
                                <button
                                  type="button"
                                  onClick={() => setInviterProfileUserId(inv.invitedByUserId)}
                                  className="inline text-left font-medium text-[#6B21A8] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
                                  aria-label={`View profile for ${inv.invitedByDisplayName || 'inviter'}`}
                                >
                                  {inv.invitedByDisplayName || 'Member'}
                                </button>
                              ) : (
                                <span className="font-medium text-gray-800">
                                  {inv.invitedByDisplayName || 'Member'}
                                </span>
                              )}
                            </p>
                            {when && <p className="mt-1 text-[11px] text-gray-500">Invited {when}</p>}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-gray-200/80 pt-3">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setDeclineModalError(null)
                              setDeclineInviteConfirm({ groupId: inv.groupId, groupName: inv.groupName })
                            }}
                            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                          >
                            {busy ? '…' : 'Decline'}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void accept(inv.groupId, inv.groupName)}
                            className="rounded px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                            style={{ backgroundColor: '#84cc16' }}
                          >
                            {busy ? '…' : 'Accept'}
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
              {invites.length > MAX_VISIBLE_INVITATIONS && (
                <p className="border-t border-gray-200 px-4 py-2 text-right text-xs text-gray-500">
                  {invites.length}{' '}
                  {invites.length === 1 ? 'invitation' : 'invitations'} total
                  <span className="mx-1.5 text-gray-400" aria-hidden>
                    ·
                  </span>
                  and {invites.length - MAX_VISIBLE_INVITATIONS} more not shown
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}
