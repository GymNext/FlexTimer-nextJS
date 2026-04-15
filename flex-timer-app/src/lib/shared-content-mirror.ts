import { adminDb } from '@/lib/firebase-admin'
import {
  groupShareMirrorDocumentId,
  SHARED_COLLECTIONS_SUB,
  SHARED_PLANS_SUB,
  SHARED_WORKOUTS_SUB,
} from '@/lib/user-connection-mirrors'

function subForKind(kind: 'workout' | 'collection' | 'plan'): string {
  if (kind === 'workout') return SHARED_WORKOUTS_SUB
  if (kind === 'collection') return SHARED_COLLECTIONS_SUB
  return SHARED_PLANS_SUB
}

function payloadFromMirrorData(data: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!data) return null
  const payload = data.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  return payload as Record<string, unknown>
}

/**
 * Returns the stored `payload` map for another user's shared workout / collection / plan as mirrored
 * to the hub (`groups/{groupId}/shared*`) or to the viewer (`users/{viewer}/shared*`).
 * Does not read the owner's library. Returns null when the viewer is the owner (caller reads owner docs),
 * when there is no mirror, or when the viewer may not read that group mirror.
 */
export async function getSharedMirrorPayloadForViewer(params: {
  viewerUid: string
  ownerUid: string
  kind: 'workout' | 'collection' | 'plan'
  resourceId: string
  groupId: string | null
}): Promise<Record<string, unknown> | null> {
  if (!adminDb) return null
  const v = params.viewerUid.trim()
  const o = params.ownerUid.trim()
  const rid = params.resourceId.trim()
  if (!v || !o || !rid || v === o) return null

  const docId = groupShareMirrorDocumentId(o, rid)
  const sub = subForKind(params.kind)
  const gid = params.groupId?.trim() ?? ''

  if (gid) {
    const gSnap = await adminDb.collection('groups').doc(gid).get()
    if (!gSnap.exists) return null
    const gd = gSnap.data() as Record<string, unknown>
    if (gd.deletedAt != null) return null
    const gOwner = typeof gd.ownerUserId === 'string' ? gd.ownerUserId.trim() : ''
    if (gOwner !== v) {
      const mSnap = await adminDb.collection('groups').doc(gid).collection('members').doc(v).get()
      if (!mSnap.exists) return null
      const st = (mSnap.data() as Record<string, unknown>).status
      if (typeof st !== 'string' || st !== 'active') return null
    }
    const mirrorSnap = await adminDb.collection('groups').doc(gid).collection(sub).doc(docId).get()
    if (!mirrorSnap.exists) return null
    const mo = mirrorSnap.data()?.mirrorOwnerUserId
    if (typeof mo !== 'string' || mo.trim() !== o) return null
    return payloadFromMirrorData(mirrorSnap.data() as Record<string, unknown>)
  }

  const mirrorSnap = await adminDb.collection('users').doc(v).collection(sub).doc(docId).get()
  if (!mirrorSnap.exists) return null
  const mo = mirrorSnap.data()?.mirrorOwnerUserId
  if (typeof mo !== 'string' || mo.trim() !== o) return null
  return payloadFromMirrorData(mirrorSnap.data() as Record<string, unknown>)
}
