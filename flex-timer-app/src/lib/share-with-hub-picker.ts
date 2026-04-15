import type { HubTreeNode } from '@/types/hub-tree'
import type { AppGroupJoinPolicy, AppGroupType } from '@/types/group'
import { formatHubSubtitle } from '@/lib/hub-subtitle'

/** Rows from GET `/api/app/memberships` (subset used for Share With hub picker). */
export type MembershipRowForSharePicker = {
  groupId: string
  name: string
  groupType: AppGroupType | null
  handle: string | null
  joinPolicy: AppGroupJoinPolicy
  membersMayShareContent: boolean
}

function memberShareHubRoots(rows: MembershipRowForSharePicker[]): HubTreeNode[] {
  return rows
    .filter(
      (m) =>
        (m.joinPolicy === 'private' || m.joinPolicy === 'restricted') && m.membersMayShareContent,
    )
    .map((m) => ({
      id: m.groupId,
      name: m.name,
      subtitle: formatHubSubtitle(m.handle, m.joinPolicy, false),
      parentGroupId: null,
      groupType: m.groupType,
      joinPolicy: m.joinPolicy,
    }))
}

/** Owned hub tree first; then member hubs where sharing is allowed, excluding ids already in the owned tree. */
export function mergeOwnedAndMemberShareHubTrees(
  ownedRoots: HubTreeNode[],
  membershipRows: MembershipRowForSharePicker[],
): HubTreeNode[] {
  const memberRoots = memberShareHubRoots(membershipRows)
  const ownedIds = new Set<string>()
  function walk(nodes: HubTreeNode[]) {
    for (const n of nodes) {
      ownedIds.add(n.id)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(ownedRoots)
  const extra = memberRoots.filter((n) => !ownedIds.has(n.id))
  return [...ownedRoots, ...extra].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
}
