import circleTypeData from "@/data/group-lookups/circle-type.json";
import competitionDisciplineData from "@/data/group-lookups/competition-discipline.json";
import gymBrandData from "@/data/group-lookups/gym-brand.json";
import gymTypeData from "@/data/group-lookups/gym-type.json";
import levelData from "@/data/group-lookups/level.json";
import organizationTypeData from "@/data/group-lookups/organization-type.json";
import sportData from "@/data/group-lookups/sport.json";
import trainingModeData from "@/data/group-lookups/training-mode.json";

/** Matches iOS `GroupLookupKind` (camelCase keys). */
export const GROUP_LOOKUP_KINDS = [
  "gymType",
  "trainingMode",
  "gymBrand",
  "sport",
  "level",
  "organizationType",
  "competitionDiscipline",
  "circleType",
] as const;

export type GroupLookupKind = (typeof GROUP_LOOKUP_KINDS)[number];

export type GroupLookupItem = {
  id: string;
  name: string;
  order: number;
  isActive: boolean;
};

type LookupFile = { items: GroupLookupItem[] };

const RAW_BY_KIND: Record<GroupLookupKind, LookupFile> = {
  gymType: gymTypeData,
  trainingMode: trainingModeData,
  gymBrand: gymBrandData,
  sport: sportData,
  level: levelData,
  organizationType: organizationTypeData,
  competitionDiscipline: competitionDisciplineData,
  circleType: circleTypeData,
};

export function isGroupLookupKind(value: string): value is GroupLookupKind {
  return (GROUP_LOOKUP_KINDS as readonly string[]).includes(value);
}

function sortByOrder(a: GroupLookupItem, b: GroupLookupItem): number {
  return a.order - b.order;
}

/**
 * Returns lookup items for a catalog kind, sorted by `order`.
 * By default only `isActive` rows are included (matches typical picker behavior).
 */
export function getGroupLookupItems(
  kind: GroupLookupKind,
  options?: { includeInactive?: boolean },
): GroupLookupItem[] {
  const raw = RAW_BY_KIND[kind]?.items ?? [];
  const filtered = options?.includeInactive
    ? [...raw]
    : raw.filter((item) => item.isActive);
  return filtered.sort(sortByOrder);
}

export function getGroupLookupLabel(kind: GroupLookupKind, id: string): string | undefined {
  const items = getGroupLookupItems(kind, { includeInactive: true });
  return items.find((item) => item.id === id)?.name;
}

/** `null` / `undefined` / empty string are valid (clear field). */
export function isValidGroupLookupId(
  kind: GroupLookupKind,
  id: string | null | undefined,
): boolean {
  if (id == null || id.trim() === "") return true;
  const items = getGroupLookupItems(kind, { includeInactive: true });
  return items.some((item) => item.id === id.trim());
}
