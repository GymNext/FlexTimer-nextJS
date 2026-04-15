'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'

/** Dispatched when join request counts may have changed (approve / decline / new request). */
export const HUB_JOIN_REQUESTS_NAV_CHANGED_EVENT = 'flextimer-hub-join-requests-nav-changed'

export function notifyHubJoinRequestsNavChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(HUB_JOIN_REQUESTS_NAV_CHANGED_EVENT))
  }
}

export function useHubJoinRequestNavBadges(user: User | null) {
  const [pendingHubJoinRequests, setPendingHubJoinRequests] = useState(0)

  const refreshHubJoinRequestBadges = useCallback(async () => {
    if (!user) {
      setPendingHubJoinRequests(0)
      return
    }
    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/app/owned-groups/join-request-badges', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json().catch(() => ({}))) as { total?: number }
      setPendingHubJoinRequests(typeof data.total === 'number' ? data.total : 0)
    } catch {
      setPendingHubJoinRequests(0)
    }
  }, [user])

  useEffect(() => {
    void refreshHubJoinRequestBadges()
  }, [refreshHubJoinRequestBadges])

  useEffect(() => {
    const handler = () => {
      void refreshHubJoinRequestBadges()
    }
    window.addEventListener(HUB_JOIN_REQUESTS_NAV_CHANGED_EVENT, handler)
    return () => window.removeEventListener(HUB_JOIN_REQUESTS_NAV_CHANGED_EVENT, handler)
  }, [refreshHubJoinRequestBadges])

  return { pendingHubJoinRequests, refreshHubJoinRequestBadges }
}
