import { adminDb } from '@/lib/firebase-admin'
import { loadPublicUserProfileView } from '@/lib/public-profile-view'
import type { PublicUserProfileView } from '@/types/public-profile'

/**
 * Stable id for `userConnections/{id}` — lexicographic pair with underscore (Firebase Auth uids are alphanumeric).
 * Must match iOS `userConnectionDocumentId(userId1:userId2:)`.
 */
export function userConnectionDocumentId(userId1: string, userId2: string): string {
  const a = userId1.trim()
  const b = userId2.trim()
  if (!a || !b) return ''
  return a < b ? `${a}_${b}` : `${b}_${a}`
}

export async function assertUsersAreConnected(viewerUid: string, peerUid: string): Promise<boolean> {
  if (!adminDb) return false
  const v = viewerUid.trim()
  const p = peerUid.trim()
  if (!v || !p || v === p) return false
  const id = userConnectionDocumentId(v, p)
  if (!id) return false
  const snap = await adminDb.collection('userConnections').doc(id).get()
  if (!snap.exists) return false
  const parts = snap.data()?.participants
  if (!Array.isArray(parts) || parts.length !== 2) return false
  const set = new Set(parts.map((x) => String(x).trim()))
  return set.has(v) && set.has(p)
}

export type ConnectionListRow = {
  peerUserId: string
  displayName: string
  handle: string | null
  connectedAt: string | null
  sharedContentItemCount: number
}

function parseConnectedAt(data: Record<string, unknown>): string | null {
  const raw = data.connectedAt
  if (raw == null) return null
  if (typeof raw === 'object' && raw !== null && 'toDate' in raw && typeof (raw as { toDate: () => Date }).toDate === 'function') {
    return (raw as { toDate: () => Date }).toDate().toISOString()
  }
  return null
}

function parseSharedCount(data: Record<string, unknown>): number {
  const raw = data.sharedContentItemCount
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.floor(raw))
  return 0
}

/**
 * Mutual connections for the signed-in user (`userConnections` where `participants` array-contains uid).
 */
export async function loadUserConnectionsList(viewerUid: string): Promise<ConnectionListRow[]> {
  if (!adminDb) return []
  const uid = viewerUid.trim()
  if (!uid) return []

  let snap
  try {
    snap = await adminDb.collection('userConnections').where('participants', 'array-contains', uid).get()
  } catch {
    return []
  }

  type Row = {
    peerUserId: string
    connectedAt: string | null
    sharedContentItemCount: number
  }
  const rows: Row[] = []
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>
    const parts = d.participants
    if (!Array.isArray(parts)) continue
    const peer = parts.map((x) => String(x).trim()).find((x) => x && x !== uid)
    if (!peer) continue
    rows.push({
      peerUserId: peer,
      connectedAt: parseConnectedAt(d),
      sharedContentItemCount: parseSharedCount(d),
    })
  }

  rows.sort((a, b) => {
    const ta = a.connectedAt ? new Date(a.connectedAt).getTime() : 0
    const tb = b.connectedAt ? new Date(b.connectedAt).getTime() : 0
    if (tb !== ta) return tb - ta
    return a.peerUserId.localeCompare(b.peerUserId)
  })

  const profiles = await Promise.all(rows.map((r) => loadPublicUserProfileView(r.peerUserId)))

  return rows.map((r, i) => {
    const prof = profiles[i]
    return {
      peerUserId: r.peerUserId,
      displayName: prof.displayName,
      handle: prof.handle,
      connectedAt: r.connectedAt,
      sharedContentItemCount: r.sharedContentItemCount,
    }
  })
}

export type ConnectionPeerDetail = PublicUserProfileView & {
  peerUserId: string
  connectedAt: string | null
  sharedContentItemCount: number
}

export async function loadConnectionPeerDetail(
  viewerUid: string,
  peerUserId: string
): Promise<ConnectionPeerDetail | null> {
  const ok = await assertUsersAreConnected(viewerUid, peerUserId)
  if (!ok) return null
  const id = userConnectionDocumentId(viewerUid.trim(), peerUserId.trim())
  if (!adminDb || !id) return null
  const snap = await adminDb.collection('userConnections').doc(id).get()
  const d = snap.exists ? (snap.data() as Record<string, unknown>) : {}
  const profile = await loadPublicUserProfileView(peerUserId.trim())
  return {
    ...profile,
    peerUserId: peerUserId.trim(),
    connectedAt: parseConnectedAt(d),
    sharedContentItemCount: parseSharedCount(d),
  }
}

export class EndUserConnectionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'EndUserConnectionError'
  }
}

/**
 * Deletes `userConnections/{userId1_userId2}` so the two users are no longer connected.
 */
export async function endUserConnection(viewerUid: string, peerUserId: string): Promise<void> {
  if (!adminDb) throw new EndUserConnectionError('Database not configured', 503)
  const v = viewerUid.trim()
  const p = peerUserId.trim()
  if (!v || !p || v === p) throw new EndUserConnectionError('Invalid request', 400)
  const ok = await assertUsersAreConnected(v, p)
  if (!ok) throw new EndUserConnectionError('You are not connected to this user', 403)
  const id = userConnectionDocumentId(v, p)
  if (!id) throw new EndUserConnectionError('Invalid request', 400)
  await adminDb.collection('userConnections').doc(id).delete()
}
