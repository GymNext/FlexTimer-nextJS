'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import toast from 'react-hot-toast'
import { HubSearchDialog } from '@/components/HubSearchDialog'
import { MembershipInvitationsSection } from '@/components/MembershipInvitationsSection'
import { PublicUserProfileDialog } from '@/components/PublicUserProfileDialog'
import type { AppGroupType } from '@/types/group'
import type { PublicUserProfileView } from '@/types/public-profile'
import { formatMembershipLocation } from '@/lib/format-membership-location'
import { hubTypeCard } from '@/lib/hub-type-cards'

type ListItem = {
  groupId: string
  name: string
  groupType: AppGroupType | null
  handle: string | null
  joinPolicy?: string
  membersMayShareContent?: boolean
}

type HubMemberRow = {
  userId: string
  displayName: string
  handle: string | null
  role: string | null
}

type Detail = ListItem & {
  handle: string | null
  joinPolicy: string
  bio: string | null
  country: string | null
  region: string | null
  city: string | null
  photoUrl: string | null
  memberRole: string | null
  members: HubMemberRow[]
  /** Group `ownerUserId` (always present from API for membership detail). */
  ownerUserId?: string | null
  /** ISO timestamp from the viewer's `groups/{id}/members/{uid}` doc (`joinedAt` or `createdAt`). */
  memberJoinedAt?: string | null
  /** From hub settings: whether members (not only the owner) may share library content to the hub. */
  membersMayShareContent?: boolean
}

function hubOwnerUserIdFromDetail(detail: Detail | null): string | null {
  if (!detail) return null
  const fromGroup = detail.ownerUserId
  if (fromGroup != null && String(fromGroup).trim() !== '') {
    return String(fromGroup).trim()
  }
  const fromMembers = detail.members.find((m) => (m.role?.trim().toLowerCase() ?? '') === 'owner')?.userId
  if (typeof fromMembers === 'string' && fromMembers.trim() !== '') return fromMembers.trim()
  return null
}

function formatMemberSince(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  try {
    const dateStr = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(t))
    return `Member since ${dateStr}`
  } catch {
    return null
  }
}

function formatHandleDisplay(handle: string | null | undefined): string | null {
  const h = handle?.trim()
  if (!h) return null
  return h.startsWith('@') ? h : `@${h}`
}

function formatMemberRoleLabel(role: string | null): string | null {
  if (!role?.trim()) return null
  const r = role.trim().toLowerCase()
  if (r === 'owner') return 'Owner'
  if (r === 'member') return 'Member'
  return role.trim().charAt(0).toUpperCase() + role.trim().slice(1)
}

function MembershipHubTypeHeaderIcon({ groupType }: { groupType: AppGroupType | null }) {
  const c = hubTypeCard(groupType)
  return (
    <div
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-gymnext-muted/30 bg-gray-50 text-2xl leading-none select-none"
      role="img"
      aria-label={c.title}
    >
      <span aria-hidden>{c.emoji}</span>
    </div>
  )
}

function parseHubMembers(raw: unknown): HubMemberRow[] {
  if (!Array.isArray(raw)) return []
  const out: HubMemberRow[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const m = item as Record<string, unknown>
    const userId = typeof m.userId === 'string' ? m.userId.trim() : ''
    if (!userId) continue
    out.push({
      userId,
      displayName: typeof m.displayName === 'string' && m.displayName.trim() ? m.displayName.trim() : 'Member',
      handle: typeof m.handle === 'string' && m.handle.trim() ? m.handle.trim() : null,
      role: typeof m.role === 'string' && m.role.trim() ? m.role.trim() : null,
    })
  }
  return out
}

export function MembershipsSection({ user }: { user: User }) {
  const [list, setList] = useState<ListItem[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [hubMenuOpen, setHubMenuOpen] = useState(false)
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [leaveError, setLeaveError] = useState<string | null>(null)
  const [hubSearchOpen, setHubSearchOpen] = useState(false)
  const [memberProfileUserId, setMemberProfileUserId] = useState<string | null>(null)
  const [hubOwnerProfile, setHubOwnerProfile] = useState<PublicUserProfileView | null>(null)
  const [hubOwnerProfileLoading, setHubOwnerProfileLoading] = useState(false)
  const [hubOwnerProfileError, setHubOwnerProfileError] = useState<string | null>(null)
  const hubMenuRef = useRef<HTMLDivElement | null>(null)

  const loadList = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/memberships', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        memberships?: ListItem[]
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const memberships = Array.isArray(data.memberships) ? data.memberships : []
      setList(memberships)
      setSelectedId((cur) => (cur && memberships.some((m) => m.groupId === cur) ? cur : null))
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Failed to load memberships')
      setList([])
    } finally {
      setListLoading(false)
    }
  }, [user])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      setDetailError(null)
      return
    }
    let cancelled = false
    setDetail(null)
    setDetailLoading(true)
    setDetailError(null)
    ;(async () => {
      try {
        const token = await user.getIdToken()
        const res = await fetch(`/api/app/memberships/${encodeURIComponent(selectedId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        if (!cancelled) {
          setDetail({
            ...(data as unknown as Detail),
            members: parseHubMembers(data.members),
          })
        }
      } catch (e) {
        if (!cancelled) {
          setDetail(null)
          setDetailError(e instanceof Error ? e.message : 'Failed to load hub')
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
    setHubMenuOpen(false)
    setLeaveConfirmOpen(false)
    setLeaveError(null)
    setMemberProfileUserId(null)
    setHubOwnerProfile(null)
    setHubOwnerProfileError(null)
  }, [selectedId])

  const hubOwnerUserId = hubOwnerUserIdFromDetail(detail)

  const membershipDetailLocationLine = detail
    ? formatMembershipLocation(detail.country, detail.region, detail.city)
    : null

  useEffect(() => {
    if (!hubOwnerUserId) {
      setHubOwnerProfile(null)
      setHubOwnerProfileLoading(false)
      setHubOwnerProfileError(null)
      return
    }
    let cancelled = false
    setHubOwnerProfile(null)
    setHubOwnerProfileError(null)
    setHubOwnerProfileLoading(true)
    ;(async () => {
      try {
        const token = await user.getIdToken()
        const res = await fetch(`/api/app/users/${encodeURIComponent(hubOwnerUserId)}/public-profile`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string } & Partial<PublicUserProfileView>
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        if (!cancelled) {
          setHubOwnerProfile(data as PublicUserProfileView)
          setHubOwnerProfileError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setHubOwnerProfile(null)
          setHubOwnerProfileError(e instanceof Error ? e.message : 'Failed to load profile')
        }
      } finally {
        if (!cancelled) setHubOwnerProfileLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hubOwnerUserId, user])

  useEffect(() => {
    if (!hubMenuOpen) return
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const el = hubMenuRef.current
      const t = e.target
      if (el && t instanceof Node && !el.contains(t)) setHubMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [hubMenuOpen])

  async function confirmLeaveHub() {
    if (!selectedId || !detail) return
    setLeaving(true)
    setLeaveError(null)
    try {
      const token = await user.getIdToken()
      const res = await fetch(`/api/app/memberships/${encodeURIComponent(selectedId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      toast.success(`You left ${detail.name}.`)
      setLeaveConfirmOpen(false)
      setSelectedId(null)
      setDetail(null)
      await loadList()
    } catch (e) {
      setLeaveError(e instanceof Error ? e.message : 'Failed to leave hub')
    } finally {
      setLeaving(false)
    }
  }

  return (
    <div className="grid min-h-[28rem] w-full flex-1 gap-6 max-lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:min-h-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.8fr)] lg:grid-rows-[minmax(0,1fr)]">
      <HubSearchDialog open={hubSearchOpen} onClose={() => setHubSearchOpen(false)} user={user} />
      {leaveConfirmOpen && detail && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden
            onClick={() => !leaving && setLeaveConfirmOpen(false)}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-gymnext-muted/30 bg-white shadow-lg p-4">
            <h4 className="text-sm font-semibold text-gray-900">Leave hub?</h4>
            <p className="text-sm text-gray-600 mt-2">
              Leave <span className="font-medium text-gray-800">{detail.name}</span>?
            </p>
            {leaveError && <p className="text-sm text-red-600 mt-2">{leaveError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={leaving}
                onClick={() => {
                  if (!leaving) {
                    setLeaveError(null)
                    setLeaveConfirmOpen(false)
                  }
                }}
                className="rounded border border-gymnext-muted/40 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={leaving}
                onClick={() => void confirmLeaveHub()}
                className="rounded px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#b91c1c' }}
              >
                {leaving ? 'Leaving…' : 'Leave hub'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex h-full min-h-[12rem] min-w-0 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white lg:min-h-0">
        <div className="shrink-0 border-b border-gymnext-muted/30 bg-gymnext-background px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-gray-800">Memberships</h3>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setHubSearchOpen(true)}
              className="rounded px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              style={{ backgroundColor: '#6B21A8' }}
            >
              Search Hubs
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="h-2 shrink-0" aria-hidden />
            {listLoading && (
              <p className="flex-1 px-4 py-6 text-sm text-gray-500">Loading memberships…</p>
            )}
            {!listLoading && listError && (
              <div className="flex flex-1 flex-col justify-center px-4 py-4 space-y-2">
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
            {!listLoading && !listError && list.length === 0 && (
              <p className="flex-1 px-4 py-6 text-sm text-gray-500">You have no memberships.</p>
            )}
            {!listLoading && !listError && list.length > 0 && (
              <ul>
                {list.map((m, index) => {
                  const card = hubTypeCard(m.groupType)
                  const isSelected = selectedId === m.groupId
                  return (
                    <li key={m.groupId}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(m.groupId)}
                        className={`w-full text-left pl-3 pr-4 py-3 flex items-center gap-3 ${
                          index > 0 ? 'border-t border-gray-200' : ''
                        } ${isSelected ? 'bg-purple-50/80' : 'hover:bg-gray-100'}`}
                      >
                        <span
                          className="w-1 shrink-0 rounded-full self-stretch min-h-[2.5rem]"
                          style={{ backgroundColor: card.barColor }}
                          aria-hidden
                        />
                        {isSelected && (
                          <span className="shrink-0 text-[#6B21A8]" aria-label="Active membership">
                            ✓
                          </span>
                        )}
                        <span className="text-lg shrink-0" aria-hidden>
                          {card.emoji}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-gray-900 truncate">{m.name}</span>
                          <span className="block text-xs text-gray-500 truncate">
                            {[m.handle ? `@${m.handle.replace(/^@/, '')}` : null, card.title]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <MembershipInvitationsSection
              user={user}
              variant="leftPanel"
              onInvitesChanged={() => void loadList()}
            />
          </div>
        </div>
      </div>

      <div className="flex h-full min-h-[12rem] min-w-0 flex-col overflow-hidden rounded-lg border border-gymnext-muted/30 bg-white lg:min-h-0">
        {!selectedId && (
          <p className="flex flex-1 items-center justify-center px-4 py-8 text-sm text-gray-500 text-center">
            Select a membership from the list to view its details.
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
            <PublicUserProfileDialog
              open={memberProfileUserId != null}
              userId={memberProfileUserId}
              onClose={() => setMemberProfileUserId(null)}
              viewer={user}
            />
            <div className="shrink-0 border-b border-gray-100 px-4 py-3 flex items-start justify-between gap-3">
              <div className="flex items-start gap-4 min-w-0 flex-1">
                <MembershipHubTypeHeaderIcon groupType={detail.groupType} />
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-sm font-semibold text-gray-900">{detail.name}</p>
                  <p className="text-xs text-gray-600 mt-1">
                    {[formatHandleDisplay(detail.handle), formatMemberSince(detail.memberJoinedAt)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {membershipDetailLocationLine ? (
                    <p className="text-xs text-gray-500 mt-1">{membershipDetailLocationLine}</p>
                  ) : null}
                </div>
              </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0 self-start justify-end" ref={hubMenuRef}>
                  <div className="relative">
                    <button
                      type="button"
                      aria-label="Hub options"
                      aria-expanded={hubMenuOpen}
                      aria-haspopup="menu"
                      onClick={() => setHubMenuOpen((o) => !o)}
                      className="rounded border border-gymnext-muted/40 bg-white text-gray-700 text-lg leading-none w-9 h-8 flex items-center justify-center hover:bg-gray-50"
                    >
                      ⋯
                    </button>
                    {hubMenuOpen && (
                      <div
                        role="menu"
                        className="absolute right-0 top-full mt-1 z-20 min-w-[10rem] rounded-md border border-gymnext-muted/30 bg-white py-1 shadow-lg"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="w-full text-left px-3 py-2 text-sm text-red-700 hover:bg-red-50"
                          onClick={() => {
                            setHubMenuOpen(false)
                            setLeaveError(null)
                            setLeaveConfirmOpen(true)
                          }}
                        >
                          Leave hub
                        </button>
                      </div>
                    )}
                  </div>
                </div>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
              {hubOwnerUserId && (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Hub owner</h4>
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    {hubOwnerProfileLoading && (
                      <p className="text-sm text-gray-500">Loading profile…</p>
                    )}
                    {!hubOwnerProfileLoading && hubOwnerProfileError && (
                      <div className="space-y-2">
                        <p className="text-sm text-red-700">{hubOwnerProfileError}</p>
                        <p className="text-xs font-medium text-gray-500">Owner user ID</p>
                        <p className="text-sm font-mono text-gray-900 break-all">{hubOwnerUserId}</p>
                        <button
                          type="button"
                          onClick={() => {
                            setHubOwnerProfileError(null)
                            setHubOwnerProfileLoading(true)
                            void (async () => {
                              try {
                                const token = await user.getIdToken()
                                const res = await fetch(
                                  `/api/app/users/${encodeURIComponent(hubOwnerUserId)}/public-profile`,
                                  { headers: { Authorization: `Bearer ${token}` } }
                                )
                                const data = (await res.json().catch(() => ({}))) as {
                                  error?: string
                                } & Partial<PublicUserProfileView>
                                if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
                                setHubOwnerProfile(data as PublicUserProfileView)
                                setHubOwnerProfileError(null)
                              } catch (e) {
                                setHubOwnerProfile(null)
                                setHubOwnerProfileError(
                                  e instanceof Error ? e.message : 'Failed to load profile'
                                )
                              } finally {
                                setHubOwnerProfileLoading(false)
                              }
                            })()
                          }}
                          className="rounded px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                          style={{ backgroundColor: '#6B21A8' }}
                        >
                          Retry
                        </button>
                      </div>
                    )}
                    {!hubOwnerProfileLoading && !hubOwnerProfileError && !hubOwnerProfile && hubOwnerUserId && (
                      <div className="space-y-2">
                        <p className="text-xs text-gray-600">Public profile is not available.</p>
                        <p className="text-xs font-medium text-gray-500">Owner user ID</p>
                        <p className="text-sm font-mono text-gray-900 break-all">{hubOwnerUserId}</p>
                        <button
                          type="button"
                          onClick={() => setMemberProfileUserId(hubOwnerUserId)}
                          className="text-sm font-medium text-violet-800 hover:underline"
                        >
                          Try opening profile
                        </button>
                      </div>
                    )}
                    {!hubOwnerProfileLoading && !hubOwnerProfileError && hubOwnerProfile && (
                      <div className="space-y-3">
                        <button
                          type="button"
                          onClick={() => setMemberProfileUserId(hubOwnerUserId)}
                          className="w-full space-y-3 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                        >
                          <div className="flex items-start gap-4">
                            {hubOwnerProfile.profilePhotoUrl ? (
                              <img
                                src={hubOwnerProfile.profilePhotoUrl}
                                alt=""
                                className="h-16 w-16 shrink-0 rounded-full border border-gymnext-muted/30 bg-white object-cover"
                                width={64}
                                height={64}
                                loading="lazy"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div
                                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-gymnext-muted/30 bg-white text-xl font-semibold text-gray-600"
                                aria-hidden
                              >
                                {(hubOwnerProfile.displayName || '?').slice(0, 1).toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-base font-semibold leading-snug text-gray-900">
                                {hubOwnerProfile.displayName}
                              </p>
                              {hubOwnerProfile.handle ? (
                                <p className="mt-0.5 text-sm text-gray-600">{hubOwnerProfile.handle}</p>
                              ) : null}
                              {[hubOwnerProfile.city, hubOwnerProfile.region, hubOwnerProfile.country]
                                .filter(Boolean)
                                .join(', ') ? (
                                <p className="mt-2 text-xs text-gray-500">
                                  {[hubOwnerProfile.city, hubOwnerProfile.region, hubOwnerProfile.country]
                                    .filter(Boolean)
                                    .join(', ')}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Member content sharing
                </h4>
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  {detail.joinPolicy === 'public' ? (
                    <p className="text-sm text-gray-700">
                      Not available on public hubs. Only the hub owner can share content to this hub
                    </p>
                  ) : detail.membersMayShareContent === true ? (
                    <p className="text-sm text-gray-700">
                      Members can share workouts, collections, and plans to this hub
                    </p>
                  ) : (
                    <p className="text-sm text-gray-700">Only the hub owner can share content to this hub</p>
                  )}
                </div>
              </div>
              {detail.joinPolicy !== 'public' && (
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <h4 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Members
                  </h4>
                  {detail.members.filter((m) => (m.role?.trim().toLowerCase() ?? '') !== 'owner').length ===
                  0 ? (
                    <p className="text-sm text-gray-500">No other members in this hub yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {detail.members
                        .filter((m) => (m.role?.trim().toLowerCase() ?? '') !== 'owner')
                        .map((m) => {
                          const roleLabel = formatMemberRoleLabel(m.role)
                          const handleLine =
                            m.handle != null && m.handle.trim() !== ''
                              ? m.handle.startsWith('@')
                                ? m.handle
                                : `@${m.handle}`
                              : null
                          return (
                            <li key={m.userId}>
                              <button
                                type="button"
                                onClick={() => setMemberProfileUserId(m.userId)}
                                className="flex w-full items-center gap-3 rounded-md border border-gray-100 bg-white px-3 py-2.5 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                              >
                                <span
                                  className="w-1 shrink-0 self-stretch min-h-[2.25rem] rounded-full"
                                  style={{ backgroundColor: hubTypeCard(detail.groupType).barColor }}
                                  aria-hidden
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium text-gray-900">
                                    {m.displayName}
                                  </span>
                                  <span className="block truncate text-xs text-gray-500">
                                    {[handleLine, roleLabel].filter(Boolean).join(' · ') || 'Member'}
                                  </span>
                                </span>
                              </button>
                            </li>
                          )
                        })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
