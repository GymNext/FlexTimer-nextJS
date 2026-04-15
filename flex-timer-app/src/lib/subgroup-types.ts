import type { AppGroupType } from '@/types/group'

/**
 * Allowed child hub types under each parent (`groupType`), matching iOS subgroup rules.
 */
export const ALLOWED_CHILD_GROUP_TYPES: Record<AppGroupType, readonly AppGroupType[]> = {
  organization: ['gym', 'team', 'series', 'event', 'circle'],
  gym: ['class', 'team', 'event', 'circle'],
  team: ['event', 'circle'],
  series: ['event'],
  class: [],
  event: [],
  circle: [],
} as const

export function allowedChildGroupTypes(parent: AppGroupType): readonly AppGroupType[] {
  return ALLOWED_CHILD_GROUP_TYPES[parent]
}

export function canHaveChildGroups(parent: AppGroupType): boolean {
  return ALLOWED_CHILD_GROUP_TYPES[parent].length > 0
}

export function isAllowedChildGroupType(parent: AppGroupType, child: AppGroupType): boolean {
  return (ALLOWED_CHILD_GROUP_TYPES[parent] as readonly AppGroupType[]).includes(child)
}
