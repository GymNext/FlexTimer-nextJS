/**
 * Planned-workout `day` field: Firestore Timestamp = start of local calendar day (00:00)
 * for the planned date in the owner/agreed IANA timezone (iOS `startOfDay` parity).
 */

const MS_DAY = 86400000

/** Keys commonly used on user workout plan docs and user profile docs for IANA ids (iOS / web). */
const PLAN_DAY_TIME_ZONE_KEYS = [
  'planDayTimeZoneId',
  'timeZoneIdentifier',
  'timeZone',
  'calendarTimeZoneIdentifier',
  'ianaTimeZone',
  'scheduledTimeZone',
] as const

export function isValidIanaTimeZone(id: string): boolean {
  const t = id.trim()
  if (!t) return false
  try {
    Intl.DateTimeFormat(undefined, { timeZone: t })
    return true
  } catch {
    return false
  }
}

export function pickTimeZoneIdFromRecord(rec: Record<string, unknown> | null | undefined): string | null {
  if (!rec) return null
  for (const k of PLAN_DAY_TIME_ZONE_KEYS) {
    const v = rec[k]
    if (typeof v === 'string') {
      const s = v.trim()
      if (s && isValidIanaTimeZone(s)) return s
    }
  }
  return null
}

/** Civil date key for comparisons: Y * 10000 + M * 100 + D */
function wallDateKeyFromMs(ms: number, timeZone: string): number {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms))
  const [y, m, d] = s.split('-').map((x) => Number(x))
  if (!y || !m || !d) return NaN
  return y * 10000 + m * 100 + d
}

function wallSecondsSinceLocalMidnight(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms))
  const g = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)
  return g('hour') * 3600 + g('minute') * 60 + g('second')
}

function targetKeyFromYmd(yyyyMmDd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd.trim())
  if (!m) throw new Error(`Invalid calendar day: ${yyyyMmDd}`)
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3])
}

/**
 * UTC epoch ms for local midnight 00:00:00 on `yyyyMmDd` in IANA `timeZone`
 * (same instant family as iOS `Calendar.startOfDay(for:)` in that zone).
 */
export function utcMillisAtStartOfCalendarDayInTimeZone(yyyyMmDd: string, timeZone: string): number {
  const tz = timeZone.trim() || 'UTC'
  const targetKey = targetKeyFromYmd(yyyyMmDd)
  if (tz === 'UTC' || tz === 'Etc/UTC') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd.trim())
    if (!m) throw new Error(`Invalid calendar day: ${yyyyMmDd}`)
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0)
  }

  const cy = Math.floor(targetKey / 10000)
  const cm = Math.floor((targetKey % 10000) / 100)
  const cd = targetKey % 100
  const anchorUtc = Date.UTC(cy, cm - 1, cd, 0, 0, 0, 0)
  let lo = anchorUtc - 2 * MS_DAY
  let hi = anchorUtc + 2 * MS_DAY

  const keyAt = (ms: number) => wallDateKeyFromMs(ms, tz)

  while (keyAt(lo) >= targetKey) lo -= MS_DAY
  while (keyAt(hi) < targetKey) hi += MS_DAY

  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (keyAt(mid) >= targetKey) hi = mid
    else lo = mid
  }

  const b = hi
  if (keyAt(b) !== targetKey) {
    throw new Error(`Could not resolve local calendar day ${yyyyMmDd} in ${tz}`)
  }

  const sec = wallSecondsSinceLocalMidnight(b, tz)
  const atMid = b - sec * 1000
  const v = wallDateKeyFromMs(atMid, tz)
  const sec2 = wallSecondsSinceLocalMidnight(atMid, tz)
  if (v === targetKey && sec2 === 0) return atMid

  for (let step = 1; step <= 86_400_000; step += 1000) {
    const t = atMid + step
    if (wallDateKeyFromMs(t, tz) !== targetKey) break
    if (wallSecondsSinceLocalMidnight(t, tz) === 0) return t
  }
  throw new Error(`Could not resolve start-of-day for ${yyyyMmDd} in ${tz}`)
}

/** Next calendar day as YYYY-MM-DD (civil arithmetic on the date triple). */
/** Today's calendar date (YYYY-MM-DD) in the given IANA zone (for range caps vs client grid). */
export function calendarYmdTodayInTimeZone(timeZone: string): string {
  const tz = timeZone.trim() || 'UTC'
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function addCalendarDays(yyyyMmDd: string, deltaDays: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd.trim())
  if (!m) throw new Error(`Invalid calendar day: ${yyyyMmDd}`)
  const y = Number(m[1])
  const mo = Number(m[2])
  const da = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, da + deltaDays))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}
