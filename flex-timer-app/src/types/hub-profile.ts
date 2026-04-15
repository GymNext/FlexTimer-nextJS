import { getGroupLookupLabel } from '@/lib/group-lookups'
import type { GroupLookupKind } from '@/lib/group-lookups'

/** Stored on `users/<uid>` and mirrored to `publicUserProfiles` for Hubs parity. */
export interface UserHubLookupIds {
  gymBrandId: string | null
  gymTypeId: string | null
  levelId: string | null
  sportId: string | null
  trainingModeId: string | null
  organizationTypeId: string | null
  competitionDisciplineId: string | null
  circleTypeId: string | null
}

export type UserHubLookupIdKey = keyof UserHubLookupIds

export const EMPTY_USER_HUB_LOOKUP_IDS: UserHubLookupIds = {
  gymBrandId: null,
  gymTypeId: null,
  levelId: null,
  sportId: null,
  trainingModeId: null,
  organizationTypeId: null,
  competitionDisciplineId: null,
  circleTypeId: null,
}

/** UI / API row metadata: Firestore field → catalog kind. */
export const HUB_LOOKUP_ROWS: readonly {
  key: UserHubLookupIdKey
  kind: GroupLookupKind
  label: string
}[] = [
  { key: 'gymBrandId', kind: 'gymBrand', label: 'Gym brand' },
  { key: 'gymTypeId', kind: 'gymType', label: 'Gym / facility type' },
  { key: 'levelId', kind: 'level', label: 'Level' },
  { key: 'sportId', kind: 'sport', label: 'Sport' },
  { key: 'trainingModeId', kind: 'trainingMode', label: 'Training mode' },
  { key: 'organizationTypeId', kind: 'organizationType', label: 'Organization type' },
  { key: 'competitionDisciplineId', kind: 'competitionDiscipline', label: 'Competition discipline' },
  { key: 'circleTypeId', kind: 'circleType', label: 'Circle type' },
] as const

export const USER_HUB_LOOKUP_ID_KEYS: UserHubLookupIdKey[] = HUB_LOOKUP_ROWS.map((r) => r.key)

export function userHubLookupIdsFromFirestore(data: Record<string, unknown>): UserHubLookupIds {
  const read = (key: string): string | null => {
    const v = data[key]
    if (typeof v !== 'string' || v.trim() === '') return null
    return v.trim()
  }
  return {
    gymBrandId: read('gymBrandId'),
    gymTypeId: read('gymTypeId'),
    levelId: read('levelId'),
    sportId: read('sportId'),
    trainingModeId: read('trainingModeId'),
    organizationTypeId: read('organizationTypeId'),
    competitionDisciplineId: read('competitionDisciplineId'),
    circleTypeId: read('circleTypeId'),
  }
}

export type UserHubLookupLabels = {
  [K in UserHubLookupIdKey]?: string | null
}

export function resolveHubLookupLabels(ids: UserHubLookupIds): UserHubLookupLabels {
  const out: UserHubLookupLabels = {}
  for (const row of HUB_LOOKUP_ROWS) {
    const id = ids[row.key]
    out[row.key] = id ? getGroupLookupLabel(row.kind, id) ?? id : null
  }
  return out
}
