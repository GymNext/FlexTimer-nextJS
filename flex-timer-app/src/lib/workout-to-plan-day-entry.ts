import type { Workout } from '@/types/user'

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
