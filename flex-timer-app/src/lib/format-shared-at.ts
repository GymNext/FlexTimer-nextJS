/**
 * Long calendar date for hub/connection share lines (no time), e.g. "April 8, 2026".
 * Uses the runtime default locale.
 */
export function formatSharedOnLongDate(iso: string | null | undefined): string | null {
  if (iso == null || typeof iso !== 'string' || !iso.trim()) return null
  const t = Date.parse(iso.trim())
  if (Number.isNaN(t)) return null
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(t))
  } catch {
    return null
  }
}

/** Full label for UI: "Shared on April 8, 2026". */
export function formatSharedOnLine(iso: string | null | undefined): string | null {
  const d = formatSharedOnLongDate(iso)
  return d ? `Shared on ${d}` : null
}
