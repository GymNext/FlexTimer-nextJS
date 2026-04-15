import { getSharedMirrorPayloadForViewer } from '@/lib/shared-content-mirror'

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
