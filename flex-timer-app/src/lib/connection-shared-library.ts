/**
 * Shared workouts / collections / plans between two connected users, read only from recipient-side
 * mirrors (`users/{uid}/shared*`) — not from canonical `users/{owner}/workouts` etc.
 */
import { canonicalSharedItemLive } from '@/lib/canonical-shared-item-live'
import { workoutHasDirectUserShareWithViewer } from '@/lib/shared-content-direct-workout-share'
import { normalizePlanTrainingIntentFromFirestore } from '@/lib/plan-training-intent'
import { adminDb } from '@/lib/firebase-admin'
import type { HubSharedLibraryItem } from '@/lib/group-feed'
import {
  getCollectionDisplayDescription,
  getWorkoutBarColor,
  getWorkoutDetailDescription,
  getWorkoutDisplayName,
  type WorkoutEntryLike,
} from '@/lib/json-workout-format'
import { GROUP_SHARE_MIRROR_SEP, SHARED_COLLECTIONS_SUB, SHARED_PLANS_SUB, SHARED_WORKOUTS_SUB } from '@/lib/user-connection-mirrors'

const SCAN_LIMIT = 400

function mirrorPayload(data: Record<string, unknown>): Record<string, unknown> | null {
  const p = data.payload
  if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>
  return null
}

function ownerFromMirrorDoc(data: Record<string, unknown>): string {
  const o = data.mirrorOwnerUserId
  return typeof o === 'string' ? o.trim() : ''
}

function objectIdFromMirrorDocId(docId: string, ownerUserId: string): string {
  const prefix = `${ownerUserId}${GROUP_SHARE_MIRROR_SEP}`
  if (!docId.startsWith(prefix)) return docId.trim()
  return docId.slice(prefix.length).trim() || docId.trim()
}

function labelFromCollectionPayload(p: Record<string, unknown>, fallbackId: string): string {
  const n = typeof p.workoutCollectionName === 'string' ? p.workoutCollectionName.trim() : ''
  if (n) return n
  const cid = typeof p.workoutCollectionId === 'string' ? p.workoutCollectionId.trim() : ''
  return cid || fallbackId || 'Collection'
}

function labelFromPlanPayload(p: Record<string, unknown>, fallbackId: string): string {
  const n = typeof p.workoutPlanName === 'string' ? p.workoutPlanName.trim() : ''
  if (n) return n
  const pid = typeof p.workoutPlanId === 'string' ? p.workoutPlanId.trim() : ''
  return pid || fallbackId || 'Plan'
}

function planSubtitleFromPayload(p: Record<string, unknown>): string {
  const desc = typeof p.workoutPlanDescription === 'string' ? p.workoutPlanDescription.trim() : ''
  if (desc) return desc
  const isPersonal = p.isPersonal === true
  const ti = normalizePlanTrainingIntentFromFirestore(p.trainingIntent) === 1 ? 1 : 0
  if (isPersonal) return 'A personal plan.'
  return ti === 1 ? 'A group training plan.' : 'A private training plan.'
}

function workoutEntryLikeFromPayload(p: Record<string, unknown>): WorkoutEntryLike {
  return {
    workoutName: typeof p.workoutName === 'string' ? p.workoutName : undefined,
    workoutDescription: typeof p.workoutDescription === 'string' ? p.workoutDescription : undefined,
    type: typeof p.type === 'string' ? p.type : undefined,
    timerMode: typeof p.timerMode === 'number' ? p.timerMode : undefined,
    timerModes: Array.isArray(p.timerModes) ? (p.timerModes as number[]) : undefined,
    workoutSchedule: typeof p.workoutSchedule === 'string' ? p.workoutSchedule : undefined,
    segments: Array.isArray(p.segments)
      ? (p.segments as WorkoutEntryLike['segments'])
      : undefined,
    direction: typeof p.direction === 'boolean' ? p.direction : undefined,
  }
}

async function collectFromHostShared(
  hostUserId: string,
  filterMirrorOwnerUserId: string,
  sub: string,
  kind: HubSharedLibraryItem['kind']
): Promise<HubSharedLibraryItem[]> {
  if (!adminDb) return []
  const host = hostUserId.trim()
  const filterOwner = filterMirrorOwnerUserId.trim()
  if (!host || !filterOwner) return []

  let snap
  try {
    snap = await adminDb.collection('users').doc(host).collection(sub).limit(SCAN_LIMIT).get()
  } catch {
    return []
  }

  const out: HubSharedLibraryItem[] = []
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>
    const owner = ownerFromMirrorDoc(d)
    if (owner !== filterOwner) continue
    const payload = mirrorPayload(d)
    if (!payload) continue
    const resourceId = objectIdFromMirrorDocId(doc.id, filterOwner)
    if (!resourceId) continue
    let label: string
    let extra: Partial<Omit<HubSharedLibraryItem, 'kind' | 'ownerUserId' | 'resourceId' | 'label'>> = {}
    if (kind === 'workout') {
      const entry = workoutEntryLikeFromPayload(payload)
      const wid = typeof payload.workoutId === 'string' ? payload.workoutId.trim() : ''
      label =
        getWorkoutDisplayName(entry).trim() || wid || resourceId.trim() || 'Workout'
      extra = {
        subtitle: getWorkoutDetailDescription(entry),
        workoutBarColor: getWorkoutBarColor(entry),
      }
    } else if (kind === 'collection') {
      label = labelFromCollectionPayload(payload, resourceId)
      const rawIds = Array.isArray(payload.workoutIds) ? payload.workoutIds : []
      const ids = rawIds.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      const n = ids.length
      const collDesc =
        typeof payload.workoutCollectionDescription === 'string'
          ? payload.workoutCollectionDescription
          : undefined
      extra = {
        collectionWorkoutCount: n,
        subtitle: getCollectionDisplayDescription({
          workoutCollectionDescription: collDesc,
          workoutIds: ids,
        }),
      }
    } else {
      label = labelFromPlanPayload(payload, resourceId)
      extra = {
        subtitle: planSubtitleFromPayload(payload),
        planIsPersonal: payload.isPersonal === true,
        planTrainingIntent: normalizePlanTrainingIntentFromFirestore(payload.trainingIntent) === 1 ? 1 : 0,
      }
    }
    out.push({ kind, ownerUserId: filterOwner, resourceId, label, ...extra })
  }
  return out
}

function dedupeItems(items: HubSharedLibraryItem[]): HubSharedLibraryItem[] {
  const seen = new Set<string>()
  const result: HubSharedLibraryItem[] = []
  for (const item of items) {
    const key = `${item.kind}\u001e${item.ownerUserId}\u001e${item.resourceId}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

/**
 * Content the **peer** shared **with** the viewer (incoming only):
 * mirrors on the viewer (`users/{viewer}/shared*`) where `mirrorOwnerUserId === peer`.
 *
 * Outgoing shares (viewer → peer, stored on the peer’s user doc) are omitted so “Shared Content”
 * lists only what others shared with you.
 */
export async function loadConnectionSharedLibrary(
  viewerUserId: string,
  peerUserId: string
): Promise<{
  workouts: HubSharedLibraryItem[]
  collections: HubSharedLibraryItem[]
  plans: HubSharedLibraryItem[]
}> {
  const empty = {
    workouts: [] as HubSharedLibraryItem[],
    collections: [] as HubSharedLibraryItem[],
    plans: [] as HubSharedLibraryItem[],
  }
  const v = viewerUserId.trim()
  const p = peerUserId.trim()
  if (!v || !p || v === p) return empty

  const [w1, c1, p1] = await Promise.all([
    collectFromHostShared(v, p, SHARED_WORKOUTS_SUB, 'workout'),
    collectFromHostShared(v, p, SHARED_COLLECTIONS_SUB, 'collection'),
    collectFromHostShared(v, p, SHARED_PLANS_SUB, 'plan'),
  ])

  const merged = {
    workouts: dedupeItems([...w1]),
    collections: dedupeItems([...c1]),
    plans: dedupeItems([...p1]),
  }

  async function omitDeleted(items: HubSharedLibraryItem[]): Promise<HubSharedLibraryItem[]> {
    const out: HubSharedLibraryItem[] = []
    for (const it of items) {
      if (await canonicalSharedItemLive(it.kind, it.ownerUserId, it.resourceId)) out.push(it)
    }
    return out
  }

  const [workoutsLive, collections, plans] = await Promise.all([
    omitDeleted(merged.workouts),
    omitDeleted(merged.collections),
    omitDeleted(merged.plans),
  ])

  const workoutsWithFlags = await Promise.all(
    workoutsLive.map(async (w) => ({
      w,
      direct: await workoutHasDirectUserShareWithViewer(w.ownerUserId, v, w.resourceId),
    }))
  )
  const workouts = workoutsWithFlags.filter((x) => x.direct).map((x) => x.w)

  return { workouts, collections, plans }
}
