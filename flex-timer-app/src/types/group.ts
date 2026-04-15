/** Firestore `groupType` values (iOS `GroupType`). */
export type AppGroupType =
  | 'organization'
  | 'gym'
  | 'class'
  | 'team'
  | 'series'
  | 'event'
  | 'circle'

/** Firestore `joinPolicy` values: `public`, `private`, `restricted`. */
export type AppGroupJoinPolicy = 'private' | 'restricted' | 'public'

export const APP_GROUP_TYPES: readonly AppGroupType[] = [
  'organization',
  'gym',
  'class',
  'team',
  'series',
  'event',
  'circle',
] as const

export const APP_GROUP_JOIN_POLICIES: readonly AppGroupJoinPolicy[] = [
  'private',
  'restricted',
  'public',
] as const

export function isAppGroupType(v: string): v is AppGroupType {
  return (APP_GROUP_TYPES as readonly string[]).includes(v)
}

export function isAppGroupJoinPolicy(v: string): v is AppGroupJoinPolicy {
  return (APP_GROUP_JOIN_POLICIES as readonly string[]).includes(v)
}

/**
 * Read `joinPolicy` from Firestore / older clients. Canonical values are `public`, `private`, `restricted`.
 * Legacy `"publicGroup"` is normalized to `"public"`.
 */
export function parseFirestoreJoinPolicy(raw: unknown): AppGroupJoinPolicy | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t) return null
  const normalized = t === 'publicGroup' ? 'public' : t
  return isAppGroupJoinPolicy(normalized) ? normalized : null
}
