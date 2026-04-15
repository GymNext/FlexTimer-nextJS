import type { HubTreeNode } from '@/types/hub-tree'
import type { AppGroupJoinPolicy, AppGroupType } from '@/types/group'
import { formatHubSubtitle } from '@/lib/hub-subtitle'

/** Flat owned group row from `groups/*` (see iOS StorageManager owned groups query). */
export type OwnedGroupFlat = {
  groupId: string
  name: string
  parentGroupId: string | null
  groupType: AppGroupType | null
  handle: string | null
  joinPolicy: AppGroupJoinPolicy | null
}

/**
 * Nests owned groups by `parentGroupId` when the parent is also owned.
 * Roots: no parent, or parent id not in this set (still shown at top level).
 */
export function buildOwnedHubTree(groups: OwnedGroupFlat[]): HubTreeNode[] {
  if (groups.length === 0) return []

  const byId = new Map(groups.map((g) => [g.groupId, g]))
  const childrenByParentId = new Map<string, OwnedGroupFlat[]>()

  for (const g of groups) {
    const p = g.parentGroupId?.trim() ?? ''
    if (p && byId.has(p)) {
      const list = childrenByParentId.get(p) ?? []
      list.push(g)
      childrenByParentId.set(p, list)
    }
  }

  const roots = groups.filter((g) => {
    const p = g.parentGroupId?.trim() ?? ''
    return !p || !byId.has(p)
  })

  const sortByName = (a: OwnedGroupFlat, b: OwnedGroupFlat) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

  function toNode(g: OwnedGroupFlat): HubTreeNode {
    const isSubgroup = Boolean(g.parentGroupId?.trim())
    const subtitle = formatHubSubtitle(isSubgroup ? null : g.handle, g.joinPolicy, isSubgroup)
    const kids = (childrenByParentId.get(g.groupId) ?? []).slice().sort(sortByName)
    if (kids.length === 0) {
      return {
        id: g.groupId,
        name: g.name,
        subtitle,
        parentGroupId: g.parentGroupId,
        groupType: g.groupType,
        joinPolicy: g.joinPolicy,
      }
    }
    return {
      id: g.groupId,
      name: g.name,
      subtitle,
      parentGroupId: g.parentGroupId,
      groupType: g.groupType,
      joinPolicy: g.joinPolicy,
      children: kids.map(toNode),
    }
  }

  return roots.sort(sortByName).map(toNode)
}
