/** Same rules as iOS `_normalizeUserHandle` / user `handleKey` (max 64). */
const MAX_KEY = 64

export function normalizeGroupHandleKey(raw: string): string | null {
  let value = raw.trim().toLowerCase()
  if (value.startsWith('@')) value = value.slice(1)
  if (!value) return null
  if (value.length > MAX_KEY) return null
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(value)) return null
  return value
}

export function stripAtPrefix(raw: string): string {
  let v = raw.trim()
  if (v.startsWith('@')) v = v.slice(1)
  return v.trim()
}

/** Stored `handle` on `groups` / public profile (Swift `_userHandleDisplayString`). */
export function groupHandleDisplayForStore(strippedNoAt: string, normalizedKey: string): string {
  const t = strippedNoAt.trim()
  if (t !== '') return t.startsWith('@') ? t : `@${t}`
  return `@${normalizedKey}`
}

/** Stable internal key for sub hubs (not in `groupHandleIndex`, not user-facing). */
export function subgroupInternalHandleKey(groupId: string): string {
  const compact = groupId.replace(/-/g, '').toLowerCase()
  return `sub${compact}`
}

export function normalizedGroupNameSearchKey(name: string): string | null {
  let s = name.trim()
  if (s.startsWith('@')) s = s.slice(1).trim()
  if (!s) return null
  const folded = s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const parts = folded.split(/\s+/).filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}
