'use client'

import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import type { AppGroupJoinPolicy, AppGroupType } from '@/types/group'
import { normalizeBioDisplayText } from '@/lib/format-bio-display'
import { hubTypeCard } from '@/lib/hub-type-cards'

const JOIN_LABEL: Record<AppGroupJoinPolicy, string> = {
  private: 'private',
  restricted: 'restricted',
  public: 'public',
}

type GroupInviteView = {
  groupId: string
  name: string
  handle: string | null
  bio: string | null
  joinPolicy: AppGroupJoinPolicy
  groupType: AppGroupType | null
  photoUrl: string | null
  country: string | null
  region: string | null
  city: string | null
  parentGroupId: string | null
  parentGroupName: string | null
}

function formatLocation(p: Pick<GroupInviteView, 'city' | 'region' | 'country'>): string | null {
  const parts = [p.city, p.region, p.country].filter((s): s is string => Boolean(s && s.trim()))
  if (parts.length === 0) return null
  return parts.join(', ')
}

export function GroupPublicProfileDialog({
  open,
  groupId,
  onClose,
  viewer,
}: {
  open: boolean
  groupId: string | null
  onClose: () => void
  viewer: User
}) {
  const [hub, setHub] = useState<GroupInviteView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !groupId) {
      setHub(null)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setHub(null)
    ;(async () => {
      try {
        const token = await viewer.getIdToken()
        const res = await fetch(`/api/app/groups/${encodeURIComponent(groupId)}/invite-preview`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = (await res.json().catch(() => ({}))) as GroupInviteView & { error?: string }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        if (!cancelled) setHub(data as GroupInviteView)
      } catch (e) {
        if (!cancelled) {
          setHub(null)
          setError(e instanceof Error ? e.message : 'Failed to load hub')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, groupId, viewer])

  if (!open || !groupId) return null

  const loc = hub ? formatLocation(hub) : null
  const typeCard = hub ? hubTypeCard(hub.groupType) : null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[min(90vh,36rem)] flex flex-col rounded-lg border border-gymnext-muted/30 bg-white shadow-lg overflow-hidden">
        <div className="border-b border-gymnext-muted/30 px-4 py-3 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            className="text-gray-500 hover:text-gray-800 text-lg leading-none px-1"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
          <h3 className="text-sm font-semibold text-gray-800 text-center flex-1 pr-8">Hub profile</h3>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0 p-4">
          {loading && <p className="text-sm text-gray-500 text-center py-6">Loading…</p>}
          {!loading && error && <p className="text-sm text-red-600 text-center py-6">{error}</p>}
          {!loading && !error && hub && (
            <div className="space-y-4">
              <div className="flex gap-4 items-start">
                {hub.photoUrl ? (
                  <img
                    src={hub.photoUrl}
                    alt=""
                    className="h-20 w-20 rounded-lg object-cover border border-gymnext-muted/30 bg-gymnext-background shrink-0"
                    width={80}
                    height={80}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div
                    className="h-20 w-20 shrink-0 rounded-lg border border-gymnext-muted/30 bg-gymnext-background flex items-center justify-center text-2xl font-semibold text-gray-600"
                    aria-hidden
                  >
                    {(hub.name || '?').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold text-gray-900 leading-snug">{hub.name}</p>
                  {typeCard && (
                    <p className="text-sm text-gray-600 mt-1 flex items-center gap-2">
                      <span aria-hidden>{typeCard.emoji}</span>
                      <span>{typeCard.title}</span>
                    </p>
                  )}
                  {hub.handle && (
                    <p className="text-sm text-violet-800 mt-1">@{hub.handle}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-2">Join policy: {JOIN_LABEL[hub.joinPolicy]}</p>
                  {loc && <p className="text-xs text-gray-500 mt-1">{loc}</p>}
                </div>
              </div>
              {hub.parentGroupName && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Parent hub</h4>
                  <p className="text-sm text-gray-800 mt-1">{hub.parentGroupName}</p>
                </div>
              )}
              {hub.bio && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">About</h4>
                  <p className="mt-1 min-w-0 whitespace-pre-wrap break-words text-sm text-gray-800">
                    {normalizeBioDisplayText(hub.bio)}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
