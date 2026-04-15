import { getSharedMirrorPayloadForViewer } from '@/lib/shared-content-mirror'
import { getOwnedGroupsForUser } from '@/lib/firestore'
import { listActiveMembershipGroupIds } from '@/lib/group-memberships'

/**
 * Whether `viewerUid` may read `ownerUid`'s workout / collection / plan via shared mirrors only.
 * - Same user always allowed (caller reads own `users/{uid}/...` library).
 * - Otherwise: a mirror payload must exist under `users/{viewer}/shared*` or `groups/{groupId}/shared*`
 *   for that owner + resource (membership checked for the group path). The owner's library is not consulted here.
 */
export async function viewerCanAccessSharedLibraryItem(
  viewerUid: string,
  ownerUid: string,
  kind: 'workout' | 'collection' | 'plan',
  resourceId: string,
  contextGroupId: string | null,
): Promise<boolean> {
  const v = viewerUid.trim()
  const o = ownerUid.trim()
  const rid = resourceId.trim()
  if (!v || !o || !rid) return false
  if (v === o) return true

  const payload = await getSharedMirrorPayloadForViewer({
    viewerUid: v,
    ownerUid: o,
    kind,
    resourceId: rid,
    groupId: contextGroupId,
  })
  return payload !== null
}

/** Hub ids where the viewer may read `groups/{id}/shared*` mirrors (owned hubs + active memberships). */
export async function listViewerHubGroupIdsForSharedMirrorReads(viewerUid: string): Promise<string[]> {
  const v = viewerUid.trim()
  if (!v) return []
  const [owned, memberIds] = await Promise.all([getOwnedGroupsForUser(v), listActiveMembershipGroupIds(v)])
  const ids = new Set<string>()
  for (const g of owned) {
    const id = g.groupId.trim()
    if (id) ids.add(id)
  }
  for (const m of memberIds) {
    const t = m.trim()
    if (t) ids.add(t)
  }
  return [...ids].sort()
}

/**
 * Which mirror path to use for subsequent `getSharedMirrorPayloadForViewer` calls.
 * `readViaGroupId: null` means `users/{viewer}/shared*`.
 */
export type SharedMirrorReadContext = { readViaGroupId: string | null }

/**
 * Resolves a readable mirror for the viewer: tries connection mirrors first, then optional `preferredGroupId`,
 * then every eligible hub. Returns null when the viewer is the owner (use owner library reads) or has no mirror.
 */
export async function resolveSharedMirrorReadContextForViewer(
  viewerUid: string,
  ownerUid: string,
  kind: 'workout' | 'collection' | 'plan',
  resourceId: string,
  preferredGroupId: string | null,
  opts?: { hubGroupIds?: string[] },
): Promise<SharedMirrorReadContext | null> {
  const v = viewerUid.trim()
  const o = ownerUid.trim()
  const rid = resourceId.trim()
  if (!v || !o || !rid) return null
  if (v === o) return null

  const tryRead = async (readViaGroupId: string | null): Promise<boolean> => {
    const p = await getSharedMirrorPayloadForViewer({
      viewerUid: v,
      ownerUid: o,
      kind,
      resourceId: rid,
      groupId: readViaGroupId,
    })
    return p !== null
  }

  if (await tryRead(null)) return { readViaGroupId: null }

  const pref = preferredGroupId?.trim() || ''
  if (pref && (await tryRead(pref))) return { readViaGroupId: pref }

  const hubIds = opts?.hubGroupIds ?? (await listViewerHubGroupIdsForSharedMirrorReads(v))
  for (const gid of hubIds) {
    if (gid === pref) continue
    if (await tryRead(gid)) return { readViaGroupId: gid }
  }
  return null
}

/** True when any connection or eligible hub mirror exists for this owner + resource. */
export async function viewerCanAccessSharedLibraryItemViaAnyMirror(
  viewerUid: string,
  ownerUid: string,
  kind: 'workout' | 'collection' | 'plan',
  resourceId: string,
  preferredGroupId: string | null,
  opts?: { hubGroupIds?: string[] },
): Promise<boolean> {
  const ctx = await resolveSharedMirrorReadContextForViewer(
    viewerUid,
    ownerUid,
    kind,
    resourceId,
    preferredGroupId,
    opts,
  )
  return ctx !== null
}
