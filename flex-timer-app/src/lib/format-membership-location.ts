/** Pure string helper — safe to import from client components (no firebase-admin). */
export function formatMembershipLocation(
  country: string | null,
  region: string | null,
  city: string | null,
): string | null {
  const parts = [city, region, country].map((s) => (s && s.trim()) || '').filter(Boolean)
  if (parts.length === 0) return null
  return parts.join(', ')
}
