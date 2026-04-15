import type { AppGroupJoinPolicy, AppGroupType } from '@/types/group'

/** UI tree for Connect → Hubs (owned `groups` / subgroups). */
export type HubTreeNode = {
  id: string
  name: string
  /** Handle + privacy, e.g. `@foo • Private` or `Restricted` if no handle. */
  subtitle: string
  /** Set when this hub is a subgroup (`parentGroupId` on the group doc). */
  parentGroupId: string | null
  /** From Firestore `groupType`; null if missing or invalid on an older document. */
  groupType: AppGroupType | null
  /** Firestore `joinPolicy` for this hub (used for owner-only UI such as join requests). */
  joinPolicy: AppGroupJoinPolicy | null
  /** Owner-only: pending join requests for restricted hubs (`groups/{id}/joinRequests`). */
  pendingJoinRequestCount?: number
  children?: HubTreeNode[]
}

export function findHubInTree(nodes: HubTreeNode[], id: string): HubTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.children?.length) {
      const found = findHubInTree(n.children, id)
      if (found) return found
    }
  }
  return null
}
