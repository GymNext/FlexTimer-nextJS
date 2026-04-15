/**
 * Browser IANA timezone for planned-workout APIs so `day` matches local calendar midnight (iOS startOfDay parity).
 */

export function planDayTimeZoneQuerySuffix(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!tz) return ''
    return `&planDayTimeZone=${encodeURIComponent(tz)}`
  } catch {
    return ''
  }
}

export function planDayTimeZoneBody(): { planDayTimeZone: string } {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!tz) return { planDayTimeZone: 'UTC' }
    return { planDayTimeZone: tz }
  } catch {
    return { planDayTimeZone: 'UTC' }
  }
}
