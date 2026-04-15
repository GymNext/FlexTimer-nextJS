import { FieldValue, type DocumentSnapshot } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import { getPublicProfileSnippet } from '@/lib/group-invite'
import { assertUsersAreConnected, userConnectionDocumentId } from '@/lib/user-connections'
import type { ViewerConnectionState } from '@/types/public-profile'

const USERS = 'users'
/** Personal activity under `users/{uid}/feed` (aligned with `group-feed` / iOS). */
const USER_FEED = 'feed'
/** Matches iOS `StorageManager.USER_CONNECTION_INVITES_SUBCOLLECTION`. */
const USER_CONNECTION_INVITES = 'userConnectionInvites'

function str(d: Record<string, unknown>, key: string): string {
  const v = d[key]
  return typeof v === 'string' ? v : ''
}

function parseFirestoreTimestampField(data: Record<string, unknown>, key: string): string | null {
  const raw = data[key]
  if (raw == null) return null
  if (typeof raw === 'object' && raw !== null && 'toDate' in raw && typeof (raw as { toDate: () => Date }).toDate === 'function') {
    return (raw as { toDate: () => Date }).toDate().toISOString()
  }
  return null
}

/** iOS: `invitedAt`. */
function parseConnectionInviteTime(data: Record<string, unknown>): string | null {
  return parseFirestoreTimestampField(data, 'invitedAt')
}

export type IncomingConnectionRequestRow = {
  fromUserId: string
  displayName: string
  handle: string | null
  requestedAt: string | null
}

/** Pending invites the user sent (recipient has not accepted yet). */
export type OutgoingConnectionRequestRow = {
  toUserId: string
  displayName: string
  handle: string | null
  requestedAt: string | null
}

export type SendConnectionRequestResult = 'created' | 'alreadyPending' | 'alreadyConnected' | 'incomingExists'

/**
 * Whether the viewer is connected to the peer, or a connection request is pending either direction.
 */
export async function loadViewerConnectionState(
  viewerUid: string,
  peerUid: string,
): Promise<ViewerConnectionState> {
  if (!adminDb) {
    return { connected: false, outgoingRequestPending: false, incomingRequestPending: false }
  }
  const v = viewerUid.trim()
  const p = peerUid.trim()
  if (!v || !p || v === p) {
    return { connected: false, outgoingRequestPending: false, incomingRequestPending: false }
  }
  if (await assertUsersAreConnected(v, p)) {
    return { connected: true, outgoingRequestPending: false, incomingRequestPending: false }
  }

  const iosOutgoingRef = adminDb.collection(USERS).doc(p).collection(USER_CONNECTION_INVITES).doc(v)
  const iosIncomingRef = adminDb.collection(USERS).doc(v).collection(USER_CONNECTION_INVITES).doc(p)

  const [iosOut, iosIn] = await Promise.all([iosOutgoingRef.get(), iosIncomingRef.get()])

  const outgoingRequestPending = iosOut.exists
  const incomingRequestPending = iosIn.exists

  return {
    connected: false,
    outgoingRequestPending,
    incomingRequestPending,
  }
}

/**
 * Incoming invites: iOS `users/{toUserId}/userConnectionInvites/{fromUserId}`.
 */
export async function listIncomingConnectionRequests(toUserId: string): Promise<IncomingConnectionRequestRow[]> {
  if (!adminDb) return []
  const uid = toUserId.trim()
  if (!uid) return []

  const iosSnap = await adminDb.collection(USERS).doc(uid).collection(USER_CONNECTION_INVITES).get()

  const pending = iosSnap.docs
    .map((doc) => {
      const d = doc.data() as Record<string, unknown>
      const fromUserId = str(d, 'invitedByUserId').trim() || doc.id.trim()
      return { fromUserId, requestedAt: parseConnectionInviteTime(d) }
    })
    .filter((p) => p.fromUserId && p.fromUserId !== uid)
    .sort((a, b) => {
      const ta = a.requestedAt ? new Date(a.requestedAt).getTime() : 0
      const tb = b.requestedAt ? new Date(b.requestedAt).getTime() : 0
      if (tb !== ta) return tb - ta
      return a.fromUserId.localeCompare(b.fromUserId)
    })

  const profiles = await Promise.all(pending.map((p) => getPublicProfileSnippet(p.fromUserId)))
  return pending.map((p, i) => {
    const prof = profiles[i]
    return {
      fromUserId: p.fromUserId,
      displayName: prof.displayName,
      handle: prof.handle,
      requestedAt: p.requestedAt,
    }
  })
}

function userDocIdFromInviteSubdoc(doc: DocumentSnapshot): string | null {
  const col = doc.ref.parent
  const userDoc = col?.parent
  const id = userDoc && typeof userDoc.id === 'string' ? userDoc.id.trim() : ''
  return id || null
}

/**
 * Outgoing invites: documents at `users/{toUserId}/userConnectionInvites/{fromUserId}` with `invitedByUserId === fromUserId`,
 */
export async function listOutgoingConnectionRequests(fromUserId: string): Promise<OutgoingConnectionRequestRow[]> {
  if (!adminDb) return []
  const uid = fromUserId.trim()
  if (!uid) return []

  const merged = new Map<string, { requestedAt: string | null; sortTime: number }>()

  function upsert(toUserId: string, requestedAt: string | null) {
    if (!toUserId || toUserId === uid) return
    const sortTime = requestedAt ? new Date(requestedAt).getTime() : 0
    const prev = merged.get(toUserId)
    if (!prev || sortTime >= prev.sortTime) {
      merged.set(toUserId, { requestedAt, sortTime })
    }
  }

  const iosSnap = await adminDb.collectionGroup(USER_CONNECTION_INVITES).where('invitedByUserId', '==', uid).get()
  const iosDocs = iosSnap.docs

  for (const doc of iosDocs) {
    const toUserId = userDocIdFromInviteSubdoc(doc)
    if (!toUserId) continue
    const fromDocId = doc.id.trim()
    const d = doc.data() as Record<string, unknown>
    const inviter = str(d, 'invitedByUserId').trim() || fromDocId
    if (inviter !== uid || fromDocId !== uid) continue
    upsert(toUserId, parseConnectionInviteTime(d))
  }

  const pending = [...merged.entries()]
    .map(([toUserId, { requestedAt }]) => ({ toUserId, requestedAt }))
    .sort((a, b) => {
      const ta = a.requestedAt ? new Date(a.requestedAt).getTime() : 0
      const tb = b.requestedAt ? new Date(b.requestedAt).getTime() : 0
      if (tb !== ta) return tb - ta
      return a.toUserId.localeCompare(b.toUserId)
    })

  const profiles = await Promise.all(pending.map((p) => getPublicProfileSnippet(p.toUserId)))
  return pending.map((p, i) => {
    const prof = profiles[i]
    return {
      toUserId: p.toUserId,
      displayName: prof.displayName,
      handle: prof.handle,
      requestedAt: p.requestedAt,
    }
  })
}

/** Writes iOS-shaped `userConnectionInvites` at `users/{toUserId}/userConnectionInvites/{fromUserId}`. */
export async function sendConnectionRequest(fromUserId: string, toUserId: string): Promise<SendConnectionRequestResult> {
  if (!adminDb) throw new Error('Database not configured')
  const from = fromUserId.trim()
  const to = toUserId.trim()
  if (!from || !to || from === to) throw new Error('Invalid request')
  if (await assertUsersAreConnected(from, to)) return 'alreadyConnected'

  const iosOutgoingRef = adminDb.collection(USERS).doc(to).collection(USER_CONNECTION_INVITES).doc(from)
  const iosIncomingForSenderRef = adminDb.collection(USERS).doc(from).collection(USER_CONNECTION_INVITES).doc(to)

  const [iosOut, iosIn] = await Promise.all([iosOutgoingRef.get(), iosIncomingForSenderRef.get()])

  if (iosOut.exists) {
    return 'alreadyPending'
  }

  if (iosIn.exists) {
    return 'incomingExists'
  }

  const now = FieldValue.serverTimestamp()
  await iosOutgoingRef.set(
    {
      invitedByUserId: from,
      invitedAt: now,
    },
    { merge: true },
  )
  return 'created'
}

export class RespondConnectionRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'RespondConnectionRequestError'
  }
}

/** Confirm pending request from `fromUserId` to signed-in `recipientUid`: create mutual connection, clear requests. */
export async function acceptConnectionRequest(recipientUid: string, fromUserId: string): Promise<void> {
  if (!adminDb) throw new RespondConnectionRequestError('Database not configured', 503)
  const r = recipientUid.trim()
  const f = fromUserId.trim()
  if (!r || !f || r === f) throw new RespondConnectionRequestError('Invalid request', 400)

  const iosIncomingRef = adminDb.collection(USERS).doc(r).collection(USER_CONNECTION_INVITES).doc(f)
  const iosSnap = await iosIncomingRef.get()

  if (!iosSnap.exists) {
    throw new RespondConnectionRequestError('This invitation is no longer available', 404)
  }

  const d = iosSnap.data() as Record<string, unknown>
  const inviter = str(d, 'invitedByUserId').trim()
  if (inviter && inviter !== f) throw new RespondConnectionRequestError('Invalid invitation', 400)

  if (await assertUsersAreConnected(r, f)) {
    const batch = adminDb.batch()
    batch.delete(iosIncomingRef)
    const reverseIos = adminDb.collection(USERS).doc(f).collection(USER_CONNECTION_INVITES).doc(r)
    const revIos = await reverseIos.get()
    if (revIos.exists) batch.delete(reverseIos)
    await batch.commit()
    return
  }

  const connId = userConnectionDocumentId(r, f)
  if (!connId) throw new RespondConnectionRequestError('Invalid request', 400)
  const participants = r < f ? [r, f] : [f, r]
  const connRef = adminDb.collection('userConnections').doc(connId)
  const reverseIosRef = adminDb.collection(USERS).doc(f).collection(USER_CONNECTION_INVITES).doc(r)
  const revIosSnap = await reverseIosRef.get()

  const batch = adminDb.batch()
  const connectedAt = FieldValue.serverTimestamp()
  batch.set(connRef, {
    participants,
    connectedAt,
    sharedContentItemCount: 0,
    updatedAt: connectedAt,
  })
  batch.delete(iosIncomingRef)
  if (revIosSnap.exists) batch.delete(reverseIosRef)

  /** Matches iOS personal feed rows: `actionType` connect, owner === actor, `objectId` = other user. */
  const recipientFeedRef = adminDb.collection(USERS).doc(r).collection(USER_FEED).doc()
  const inviterFeedRef = adminDb.collection(USERS).doc(f).collection(USER_FEED).doc()
  batch.set(recipientFeedRef, {
    actionType: 'connect',
    userFeedOwnerId: r,
    actorUserId: r,
    objectId: f,
    createdAt: connectedAt,
  })
  batch.set(inviterFeedRef, {
    actionType: 'connect',
    userFeedOwnerId: f,
    actorUserId: f,
    objectId: r,
    createdAt: connectedAt,
  })

  await batch.commit()
}

/** Decline / delete incoming request to `recipientUid` from `fromUserId`. */
export async function rejectConnectionRequest(recipientUid: string, fromUserId: string): Promise<void> {
  if (!adminDb) throw new RespondConnectionRequestError('Database not configured', 503)
  const r = recipientUid.trim()
  const f = fromUserId.trim()
  if (!r || !f || r === f) throw new RespondConnectionRequestError('Invalid request', 400)
  const iosIncomingRef = adminDb.collection(USERS).doc(r).collection(USER_CONNECTION_INVITES).doc(f)
  const iosSnap = await iosIncomingRef.get()
  if (!iosSnap.exists) {
    throw new RespondConnectionRequestError('This invitation is no longer available', 404)
  }
  await iosIncomingRef.delete()
}

/**
 * Withdraw a pending connection invite: signed-in `senderUid` previously sent a request to `toUserId`.
 * Deletes only recipient-side docs (`users/{to}/…/{sender}`), matching `sendConnectionRequest`.
 */
export async function withdrawOutgoingConnectionRequest(senderUid: string, toUserId: string): Promise<void> {
  if (!adminDb) throw new RespondConnectionRequestError('Database not configured', 503)
  const s = senderUid.trim()
  const t = toUserId.trim()
  if (!s || !t || s === t) throw new RespondConnectionRequestError('Invalid request', 400)

  const iosOutgoingRef = adminDb.collection(USERS).doc(t).collection(USER_CONNECTION_INVITES).doc(s)

  const iosOut = await iosOutgoingRef.get()

  if (!iosOut.exists) {
    throw new RespondConnectionRequestError('This invitation is no longer available', 404)
  }

  const d = iosOut.data() as Record<string, unknown>
  const inviter = str(d, 'invitedByUserId').trim()
  if (inviter && inviter !== s) throw new RespondConnectionRequestError('Invalid invitation', 400)

  await iosOutgoingRef.delete()
}
