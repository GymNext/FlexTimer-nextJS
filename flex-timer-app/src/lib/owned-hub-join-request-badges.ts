import type { HubTreeNode } from '@/types/hub-tree'
import { countPendingJoinRequests } from '@/lib/group-join-requests'
import type { OwnedGroupFlat } from '@/lib/build-owned-hub-tree'

/**
 * Pending `groups/{id}/joinRequests` counts for hubs the user owns with `joinPolicy === 'restricted'`.
 */
export async function ownedHubJoinRequestBadgeMapFromFlat(
  flat: OwnedGroupFlat[]
): Promise<{ byGroupId: Record<string, number>; total: number }> {
  const restricted = flat.filter((g) => g.joinPolicy === 'restricted')
  if (restricted.length === 0) return { byGroupId: {}, total: 0 }

  const pairs = await Promise.all(
    restricted.map(async (g) => {
      const n = await countPendingJoinRequests(g.groupId)
      return { id: g.groupId, n }
    })
  )

  const byGroupId: Record<string, number> = {}
  let total = 0
  for (const { id, n } of pairs) {
    if (n > 0) byGroupId[id] = n
    total += n
  }
  return { byGroupId, total }
}

export function attachJoinRequestCountsToHubTree(
  nodes: HubTreeNode[],
  byGroupId: Record<string, number>
): HubTreeNode[] {
  return nodes.map((n) => ({
    ...n,
    pendingJoinRequestCount: byGroupId[n.id] ?? 0,
    children: n.children?.length ? attachJoinRequestCountsToHubTree(n.children, byGroupId) : undefined,
  }))
}
