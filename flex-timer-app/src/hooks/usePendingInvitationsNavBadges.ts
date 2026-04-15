'use client'

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'

/** Dispatched after connection or membership invitations change (accept / decline). */
export const PENDING_INVITES_NAV_CHANGED_EVENT = 'flextimer-pending-invites-nav-changed'

export function notifyPendingInvitesNavChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PENDING_INVITES_NAV_CHANGED_EVENT))
  }
}

export function usePendingInvitationsNavBadges(user: User | null) {
  const [connectionInvites, setConnectionInvites] = useState(0)
  const [membershipInvites, setMembershipInvites] = useState(0)

  const refreshPendingInvitations = useCallback(async () => {
    if (!user) {
      setConnectionInvites(0)
      setMembershipInvites(0)
      return
    }
    try {
      const token = await user.getIdToken()
      const [resConn, resMem] = await Promise.all([
        fetch('/api/app/connections/requests', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/app/memberships/invites', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])
      const conn = (await resConn.json().catch(() => ({}))) as { requests?: unknown[] }
      const mem = (await resMem.json().catch(() => ({}))) as { invites?: unknown[] }
      setConnectionInvites(Array.isArray(conn.requests) ? conn.requests.length : 0)
      setMembershipInvites(Array.isArray(mem.invites) ? mem.invites.length : 0)
    } catch {
      setConnectionInvites(0)
      setMembershipInvites(0)
    }
  }, [user])

  useEffect(() => {
    void refreshPendingInvitations()
  }, [refreshPendingInvitations])

  return { connectionInvites, membershipInvites, refreshPendingInvitations }
}
