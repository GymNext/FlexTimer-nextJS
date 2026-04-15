'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import toast from 'react-hot-toast'
import { PublicUserProfileDialog } from '@/components/PublicUserProfileDialog'
import { notifyHubJoinRequestsNavChanged } from '@/hooks/useHubJoinRequestNavBadges'
import type { AppGroupJoinPolicy } from '@/types/group'

const PAGE = 25

type MemberRow = { userId: string; displayName: string; handle: string | null }
type InviteRow = { invitedUserId: string; displayName: string; handle: string | null }
type JoinRequestRow = { userId: string; displayName: string; handle: string | null }

export function HubMembersInvitesPanel({
  groupId,
  user,
  refreshKey,
  joinPolicy,
  onOwnerDataChanged,
}: {
  groupId: string
  user: User
  refreshKey: number
  joinPolicy: AppGroupJoinPolicy | null
  onOwnerDataChanged?: () => void
}) {
  const [members, setMembers] = useState<MemberRow[]>([])
  const [membersNext, setMembersNext] = useState<string | null>(null)
  const [membersTotal, setMembersTotal] = useState<number | null>(null)
  const [membersLoading, setMembersLoading] = useState(true)
  const [membersError, setMembersError] = useState<string | null>(null)
  const [loadingMoreMembers, setLoadingMoreMembers] = useState(false)

  const [invites, setInvites] = useState<InviteRow[]>([])
  const [invitesNext, setInvitesNext] = useState<string | null>(null)
  const [invitesTotal, setInvitesTotal] = useState<number | null>(null)
  const [invitesLoading, setInvitesLoading] = useState(true)
  const [invitesError, setInvitesError] = useState<string | null>(null)
  const [loadingMoreInvites, setLoadingMoreInvites] = useState(false)
  const [requests, setRequests] = useState<JoinRequestRow[]>([])
  const [requestsNext, setRequestsNext] = useState<string | null>(null)
  const [requestsTotal, setRequestsTotal] = useState<number | null>(null)
  const [requestsLoading, setRequestsLoading] = useState(false)
  const [requestsError, setRequestsError] = useState<string | null>(null)
  const [loadingMoreRequests, setLoadingMoreRequests] = useState(false)
  const [requestActingId, setRequestActingId] = useState<string | null>(null)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null)
  const [bootMemberConfirm, setBootMemberConfirm] = useState<{
    memberUserId: string
    displayName: string
  } | null>(null)
  const [bootSubmitting, setBootSubmitting] = useState(false)
  const [bootModalError, setBootModalError] = useState<string | null>(null)
  const [profileUserId, setProfileUserId] = useState<string | null>(null)

  const fetchMembersPage = useCallback(
    async (cursor: string | null, append: boolean) => {
      const token = await user.getIdToken()
      const params = new URLSearchParams({ limit: String(PAGE) })
      if (cursor) params.set('cursor', cursor)
      const res = await fetch(`/api/app/groups/${encodeURIComponent(groupId)}/members?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        members?: MemberRow[]
        nextCursor?: string | null
        totalCount?: number | null
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const list = Array.isArray(data.members) ? data.members : []
      if (append) {
        setMembers((prev) => [...prev, ...list])
      } else {
        setMembers(list)
        if (typeof data.totalCount === 'number') setMembersTotal(data.totalCount)
      }
      setMembersNext(typeof data.nextCursor === 'string' ? data.nextCursor : null)
    },
    [groupId, user],
  )

  const fetchInvitesPage = useCallback(
    async (cursor: string | null, append: boolean) => {
      const token = await user.getIdToken()
      const params = new URLSearchParams({ limit: String(PAGE) })
      if (cursor) params.set('cursor', cursor)
      const res = await fetch(`/api/app/groups/${encodeURIComponent(groupId)}/invites?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        invites?: InviteRow[]
        nextCursor?: string | null
        totalCount?: number | null
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const list = Array.isArray(data.invites) ? data.invites : []
      if (append) {
        setInvites((prev) => [...prev, ...list])
      } else {
        setInvites(list)
        if (typeof data.totalCount === 'number') setInvitesTotal(data.totalCount)
      }
      setInvitesNext(typeof data.nextCursor === 'string' ? data.nextCursor : null)
    },
    [groupId, user],
  )

  const showJoinRequests = joinPolicy === 'restricted'

  const fetchRequestsPage = useCallback(
    async (cursor: string | null, append: boolean) => {
      const token = await user.getIdToken()
      const params = new URLSearchParams({ limit: String(PAGE) })
      if (cursor) params.set('cursor', cursor)
      const res = await fetch(`/api/app/groups/${encodeURIComponent(groupId)}/join-requests?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        requests?: JoinRequestRow[]
        nextCursor?: string | null
        totalCount?: number | null
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const list = Array.isArray(data.requests) ? data.requests : []
      if (append) {
        setRequests((prev) => [...prev, ...list])
      } else {
        setRequests(list)
        if (typeof data.totalCount === 'number') setRequestsTotal(data.totalCount)
      }
      setRequestsNext(typeof data.nextCursor === 'string' ? data.nextCursor : null)
    },
    [groupId, user],
  )

  useEffect(() => {
    let cancelled = false
    setMembers([])
    setMembersNext(null)
    setMembersTotal(null)
    setMembersError(null)
    setInvites([])
    setInvitesNext(null)
    setInvitesTotal(null)
    setInvitesError(null)
    setRequests([])
    setRequestsNext(null)
    setRequestsTotal(null)
    setRequestsError(null)
    setProfileUserId(null)
    setBootMemberConfirm(null)
    setBootModalError(null)
    setMembersLoading(true)
    setInvitesLoading(true)
    setRequestsLoading(showJoinRequests)

    ;(async () => {
      try {
        await fetchMembersPage(null, false)
      } catch (e) {
        if (!cancelled) setMembersError(e instanceof Error ? e.message : 'Failed to load members')
      } finally {
        if (!cancelled) setMembersLoading(false)
      }
    })()

    ;(async () => {
      try {
        await fetchInvitesPage(null, false)
      } catch (e) {
        if (!cancelled) setInvitesError(e instanceof Error ? e.message : 'Failed to load invites')
      } finally {
        if (!cancelled) setInvitesLoading(false)
      }
    })()

    if (showJoinRequests) {
      ;(async () => {
        try {
          await fetchRequestsPage(null, false)
        } catch (e) {
          if (!cancelled) setRequestsError(e instanceof Error ? e.message : 'Failed to load requests')
        } finally {
          if (!cancelled) setRequestsLoading(false)
        }
      })()
    } else {
      setRequestsLoading(false)
    }

    return () => {
      cancelled = true
    }
  }, [groupId, refreshKey, showJoinRequests, fetchMembersPage, fetchInvitesPage, fetchRequestsPage])

  const loadMoreMembers = useCallback(async () => {
    if (!membersNext || loadingMoreMembers) return
    setLoadingMoreMembers(true)
    setMembersError(null)
    try {
      await fetchMembersPage(membersNext, true)
    } catch (e) {
      setMembersError(e instanceof Error ? e.message : 'Failed to load more')
    } finally {
      setLoadingMoreMembers(false)
    }
  }, [membersNext, loadingMoreMembers, fetchMembersPage])

  const loadMoreInvites = useCallback(async () => {
    if (!invitesNext || loadingMoreInvites) return
    setLoadingMoreInvites(true)
    setInvitesError(null)
    try {
      await fetchInvitesPage(invitesNext, true)
    } catch (e) {
      setInvitesError(e instanceof Error ? e.message : 'Failed to load more')
    } finally {
      setLoadingMoreInvites(false)
    }
  }, [invitesNext, loadingMoreInvites, fetchInvitesPage])

  const loadMoreRequests = useCallback(async () => {
    if (!requestsNext || loadingMoreRequests) return
    setLoadingMoreRequests(true)
    setRequestsError(null)
    try {
      await fetchRequestsPage(requestsNext, true)
    } catch (e) {
      setRequestsError(e instanceof Error ? e.message : 'Failed to load more')
    } finally {
      setLoadingMoreRequests(false)
    }
  }, [requestsNext, loadingMoreRequests, fetchRequestsPage])

  const approveRequest = useCallback(
    async (requestUserId: string, displayName: string) => {
      setRequestActingId(requestUserId)
      setRequestsError(null)
      try {
        const token = await user.getIdToken()
        const res = await fetch(
          `/api/app/groups/${encodeURIComponent(groupId)}/join-requests/${encodeURIComponent(requestUserId)}/approve`,
          { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
        )
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        toast.success(`${displayName} is now a member.`)
        setRequests([])
        setRequestsNext(null)
        setRequestsTotal(null)
        setRequestsLoading(true)
        setMembers([])
        setMembersNext(null)
        setMembersTotal(null)
        setMembersLoading(true)
        try {
          await Promise.all([fetchRequestsPage(null, false), fetchMembersPage(null, false)])
        } catch (e) {
          setRequestsError(e instanceof Error ? e.message : 'Failed to refresh requests')
          setMembersError(e instanceof Error ? e.message : 'Failed to refresh members')
        } finally {
          setRequestsLoading(false)
          setMembersLoading(false)
        }
        onOwnerDataChanged?.()
        notifyHubJoinRequestsNavChanged()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not approve request')
      } finally {
        setRequestActingId(null)
      }
    },
    [groupId, user, fetchRequestsPage, fetchMembersPage, onOwnerDataChanged],
  )

  const declineRequest = useCallback(
    async (requestUserId: string) => {
      setRequestActingId(requestUserId)
      setRequestsError(null)
      try {
        const token = await user.getIdToken()
        const res = await fetch(
          `/api/app/groups/${encodeURIComponent(groupId)}/join-requests/${encodeURIComponent(requestUserId)}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
        )
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        toast.success('Request declined.')
        setRequests([])
        setRequestsNext(null)
        setRequestsTotal(null)
        setRequestsLoading(true)
        try {
          await fetchRequestsPage(null, false)
        } catch (e) {
          setRequestsError(e instanceof Error ? e.message : 'Failed to refresh requests')
        } finally {
          setRequestsLoading(false)
        }
        onOwnerDataChanged?.()
        notifyHubJoinRequestsNavChanged()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not decline request')
      } finally {
        setRequestActingId(null)
      }
    },
    [groupId, user, fetchRequestsPage, onOwnerDataChanged],
  )

  const cancelInvite = useCallback(
    async (invitedUserId: string) => {
      setCancelId(invitedUserId)
      setInvitesError(null)
      try {
        const token = await user.getIdToken()
        const res = await fetch(
          `/api/app/groups/${encodeURIComponent(groupId)}/invites/${encodeURIComponent(invitedUserId)}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
        )
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        setInvites([])
        setInvitesNext(null)
        setInvitesTotal(null)
        setInvitesLoading(true)
        try {
          await fetchInvitesPage(null, false)
        } catch (e) {
          setInvitesError(e instanceof Error ? e.message : 'Failed to refresh invites')
        } finally {
          setInvitesLoading(false)
        }
      } catch (e) {
        setInvitesError(e instanceof Error ? e.message : 'Cancel failed')
      } finally {
        setCancelId(null)
      }
    },
    [groupId, user, fetchInvitesPage],
  )

  async function submitBootMember() {
    const target = bootMemberConfirm
    if (!target) return
    setBootSubmitting(true)
    setBootModalError(null)
    setRemoveMemberId(target.memberUserId)
    setMembersError(null)
    try {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/app/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(target.memberUserId)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      )
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setBootMemberConfirm(null)
      setMembers([])
      setMembersNext(null)
      setMembersTotal(null)
      setMembersLoading(true)
      try {
        await fetchMembersPage(null, false)
      } catch (e) {
        setMembersError(e instanceof Error ? e.message : 'Failed to refresh members')
      } finally {
        setMembersLoading(false)
      }
    } catch (e) {
      setBootModalError(e instanceof Error ? e.message : 'Failed to remove member')
    } finally {
      setBootSubmitting(false)
      setRemoveMemberId(null)
    }
  }

  const membersSummary =
    membersTotal != null
      ? !membersNext || members.length >= membersTotal
        ? `${membersTotal} member${membersTotal === 1 ? '' : 's'}`
        : `Showing ${members.length} of ${membersTotal}`
      : null

  const invitesSummary =
    invitesTotal != null
      ? !invitesNext || invites.length >= invitesTotal
        ? `${invitesTotal} pending invite${invitesTotal === 1 ? '' : 's'}`
        : `Showing ${invites.length} of ${invitesTotal}`
      : null

  const requestsSummary =
    requestsTotal != null
      ? !requestsNext || requests.length >= requestsTotal
        ? `${requestsTotal} pending request${requestsTotal === 1 ? '' : 's'}`
        : `Showing ${requests.length} of ${requestsTotal}`
      : null

  return (
    <>
      <PublicUserProfileDialog
        open={profileUserId != null}
        userId={profileUserId}
        onClose={() => setProfileUserId(null)}
        viewer={user}
      />
      {bootMemberConfirm && (
        <div className="fixed inset-0 z-[56] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => {
              if (!bootSubmitting) {
                setBootModalError(null)
                setBootMemberConfirm(null)
              }
            }}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <h4 className="text-sm font-semibold text-gray-900">Boot member from hub?</h4>
            <p className="text-sm text-gray-600 mt-2">
              <span className="font-medium text-gray-800">{bootMemberConfirm.displayName}</span> will lose access
              to this hub until they are invited again.
            </p>
            {bootModalError && <p className="text-sm text-red-600 mt-2">{bootModalError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={bootSubmitting}
                onClick={() => {
                  if (!bootSubmitting) {
                    setBootModalError(null)
                    setBootMemberConfirm(null)
                  }
                }}
                className="rounded border border-gymnext-muted/40 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                Go back
              </button>
              <button
                type="button"
                disabled={bootSubmitting}
                onClick={() => void submitBootMember()}
                className="rounded px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#b91c1c' }}
              >
                {bootSubmitting ? 'Booting…' : 'Boot member'}
              </button>
            </div>
          </div>
        </div>
      )}
    <div className="px-4 py-3 space-y-6 border-t border-gray-100">
      <section aria-labelledby="hub-members-heading">
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <h4 id="hub-members-heading" className="text-xs font-semibold text-gray-800 uppercase tracking-wide">
              Members
            </h4>
            {membersSummary && (
              <span className="text-[11px] text-gray-500 tabular-nums">{membersSummary}</span>
            )}
          </div>
          {membersLoading && <p className="text-sm text-gray-500">Loading members…</p>}
          {membersError && <p className="text-sm text-red-600">{membersError}</p>}
          {!membersLoading && !membersError && members.length === 0 && (
            <div className="rounded-md border border-gray-100 bg-white px-3 py-2.5">
              <p className="text-sm text-gray-500">No members yet.</p>
            </div>
          )}
          {members.length > 0 && (
            <ul className="space-y-1.5">
              {members.map((m) => (
                <li
                  key={m.userId}
                  className="flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="max-w-full truncate text-left text-sm font-medium text-violet-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
                      onClick={() => setProfileUserId(m.userId)}
                      title="View public profile"
                    >
                      {m.displayName}
                    </button>
                    {m.handle && <p className="text-xs text-gray-600 truncate">{m.handle}</p>}
                  </div>
                  <button
                    type="button"
                    disabled={removeMemberId === m.userId}
                    onClick={() => {
                      setBootModalError(null)
                      setBootMemberConfirm({ memberUserId: m.userId, displayName: m.displayName })
                    }}
                    className="shrink-0 rounded px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                    style={{ backgroundColor: '#b91c1c' }}
                    title="Boot this member from the hub"
                  >
                    {removeMemberId === m.userId ? '…' : 'Boot'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!membersLoading && membersNext && (
            <button
              type="button"
              onClick={() => void loadMoreMembers()}
              disabled={loadingMoreMembers}
              className="mt-2 text-xs font-medium text-violet-800 hover:underline disabled:opacity-50"
            >
              {loadingMoreMembers ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </section>

      {showJoinRequests && (
        <section aria-labelledby="hub-requests-heading">
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <h4 id="hub-requests-heading" className="text-xs font-semibold text-gray-800 uppercase tracking-wide">
                Requests
              </h4>
              {requestsSummary && (
                <span className="text-[11px] text-gray-500 tabular-nums">{requestsSummary}</span>
              )}
            </div>
            {requestsLoading && <p className="text-sm text-gray-500">Loading requests…</p>}
            {requestsError && <p className="text-sm text-red-600">{requestsError}</p>}
            {!requestsLoading && !requestsError && requests.length === 0 && (
              <div className="rounded-md border border-gray-100 bg-white px-3 py-2.5">
                <p className="text-sm text-gray-500">No pending join requests.</p>
              </div>
            )}
            {requests.length > 0 && (
              <ul className="space-y-1.5">
                {requests.map((r) => {
                  const busy = requestActingId === r.userId
                  return (
                    <li
                      key={r.userId}
                      className="flex flex-col gap-2 rounded-md border border-gray-100 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <button
                          type="button"
                          className="max-w-full truncate text-left text-sm font-medium text-violet-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
                          onClick={() => setProfileUserId(r.userId)}
                          title="View public profile"
                        >
                          {r.displayName}
                        </button>
                        {r.handle && <p className="text-xs text-gray-600 truncate">{r.handle}</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void declineRequest(r.userId)}
                          className="inline-flex h-8 items-center justify-center rounded px-3 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                        >
                          {busy ? '…' : 'Decline'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void approveRequest(r.userId, r.displayName)}
                          className="inline-flex h-8 items-center justify-center rounded px-3 text-xs font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
                        >
                          {busy ? '…' : 'Approve'}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {!requestsLoading && requestsNext && (
              <button
                type="button"
                onClick={() => void loadMoreRequests()}
                disabled={loadingMoreRequests}
                className="mt-2 text-xs font-medium text-violet-800 hover:underline disabled:opacity-50"
              >
                {loadingMoreRequests ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="hub-invites-heading">
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <h4 id="hub-invites-heading" className="text-xs font-semibold text-gray-800 uppercase tracking-wide">
              Invites
            </h4>
            {invitesSummary && (
              <span className="text-[11px] text-gray-500 tabular-nums">{invitesSummary}</span>
            )}
          </div>
          {invitesLoading && <p className="text-sm text-gray-500">Loading invites…</p>}
          {invitesError && <p className="text-sm text-red-600">{invitesError}</p>}
          {!invitesLoading && !invitesError && invites.length === 0 && (
            <div className="rounded-md border border-gray-100 bg-white px-3 py-2.5">
              <p className="text-sm text-gray-500">No pending invites.</p>
            </div>
          )}
          {invites.length > 0 && (
            <ul className="space-y-1.5">
              {invites.map((inv) => (
                <li
                  key={inv.invitedUserId}
                  className="flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{inv.displayName}</p>
                    {inv.handle && <p className="text-xs text-gray-600 truncate">{inv.handle}</p>}
                  </div>
                  <button
                    type="button"
                    disabled={cancelId === inv.invitedUserId}
                    onClick={() => void cancelInvite(inv.invitedUserId)}
                    className="shrink-0 rounded px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                  >
                    {cancelId === inv.invitedUserId ? '…' : 'Cancel'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!invitesLoading && invitesNext && (
            <button
              type="button"
              onClick={() => void loadMoreInvites()}
              disabled={loadingMoreInvites}
              className="mt-2 text-xs font-medium text-violet-800 hover:underline disabled:opacity-50"
            >
              {loadingMoreInvites ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </section>
    </div>
    </>
  )
}
