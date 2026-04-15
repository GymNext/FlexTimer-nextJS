import type { Workout } from '@/types/user'

/** Remove leading "Copy of …" patterns so planned snapshots keep the original display name. */
export function stripCopyOfPrefixFromWorkoutName(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return null
  const paren = /^copy of\s*\(([^)]*)\)\s*$/i.exec(s)
  if (paren) {
    const inner = paren[1].trim()
    return inner.length ? inner : null
  }
  if (/^copy of\s+/i.test(s)) {
    const rest = s.replace(/^copy of\s+/i, '').trim()
    return rest.length ? rest : null
  }
  return s
}

/** Snapshot of a shared bookmark workout for planning: embedded copy, no live library link (`sourceWorkoutId` null). */
export function sharedBookmarkWorkoutToPlanDayEntry(w: Workout): Record<string, unknown> {
  const base = workoutToPlanDayEntry(w)
  base.workoutName = stripCopyOfPrefixFromWorkoutName(base.workoutName as string | null | undefined)
  return base
}

/** Build plan-day-entry shaped object from a Workout for the planned-workout API. */
export function workoutToPlanDayEntry(w: Workout): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    timerMode: w.timerMode ?? (Array.isArray(w.timerModes) ? (w.timerModes as number[])[0] : 1),
    workoutName: w.workoutName ?? null,
    workoutDescription: w.workoutDescription ?? null,
    type: w.type,
  }
  if (w.workoutSchedule != null) entry.workoutSchedule = w.workoutSchedule
  if (w.direction != null) entry.direction = w.direction
  if (w.type === 'SingleSegmentWorkout' && 'workoutDetails' in w && w.workoutDetails != null) {
    entry.workoutDetails = w.workoutDetails
  }
  if (w.type === 'MultiSegmentWorkout' && w.segments) entry.segments = w.segments
  return entry
}
