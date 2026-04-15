import type { Workout } from '@/types/user'
import {
  buildOptionsSection,
  getWorkoutDisplayDescription,
  getWorkoutDisplayName,
  parseWorkoutScheduleForDisplay,
} from '@/lib/json-workout-format'

/** Read-only schedule, options, and segments (admin-style layout without IDs or actions). */
export function ReadOnlyWorkoutPanel({
  workout,
  hideTopDetailsCard,
}: {
  workout: Workout
  /** When the parent already shows name / description (e.g. Library favorites-style header). */
  hideTopDetailsCard?: boolean
}) {
  const singleSections: { title: string; rows: { label: string; value: string }[] }[] = []
  if (workout.type === 'SingleSegmentWorkout') {
    const optionsSection = buildOptionsSection({
      prelude: workout.prelude,
      segue: workout.segue,
      warnings: workout.warnings,
      metronome: workout.metronome,
      direction: workout.direction,
      restDirection: workout.restDirection,
      warningStrategy: workout.warningStrategy,
      continuity: workout.continuity,
    })
    if (optionsSection.rows.length > 0) singleSections.push(optionsSection)
    const scheduleSection = parseWorkoutScheduleForDisplay(workout.workoutSchedule)
    if (scheduleSection) singleSections.push(scheduleSection)
  }

  return (
    <div className="space-y-4">
      {!hideTopDetailsCard && (
        <div className="rounded-lg border border-gymnext-muted/30 bg-white overflow-hidden">
          <div className="border-b border-gymnext-muted/30 bg-gymnext-background/40 px-4 py-3">
            <h2 className="text-sm font-medium text-gray-800">Details</h2>
          </div>
          <dl className="divide-y divide-gymnext-muted/20">
            <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
              <dt className="text-sm font-medium text-gray-500">Name</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{getWorkoutDisplayName(workout) || '—'}</dd>
            </div>
            <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
              <dt className="text-sm font-medium text-gray-500">Description</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{getWorkoutDisplayDescription(workout) || '—'}</dd>
            </div>
            <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
              <dt className="text-sm font-medium text-gray-500">Type</dt>
              <dd className="mt-1 text-sm text-gray-900 sm:col-span-2">{workout.type}</dd>
            </div>
          </dl>
        </div>
      )}

      {singleSections.length > 0 && (
        <div className="rounded-lg border border-gymnext-muted/30 bg-white overflow-hidden">
          <div className="border-b border-gymnext-muted/30 bg-gymnext-background/40 px-4 py-3">
            <h2 className="text-sm font-medium text-gray-800">Schedule & options</h2>
          </div>
          <div className="divide-y divide-gymnext-muted/20">
            {singleSections.map((section) => (
              <div key={section.title} className="px-4 py-3">
                <h3 className="text-xs font-medium uppercase text-gray-500 mb-2">{section.title}</h3>
                <dl className="sm:grid sm:grid-cols-3 sm:gap-4 space-y-2 sm:space-y-0">
                  {section.rows.map((row) => (
                    <div key={row.label} className="sm:grid sm:grid-cols-3 sm:gap-4">
                      <dt className="text-sm font-medium text-gray-500">{row.label}</dt>
                      <dd className="mt-0.5 text-sm text-gray-900 font-mono sm:col-span-2 break-all">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </div>
      )}

      {workout.type === 'MultiSegmentWorkout' && (workout.segments?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-gymnext-muted/30 bg-white overflow-hidden">
          <div className="border-b border-gymnext-muted/30 bg-gymnext-background/40 px-4 py-3">
            <h2 className="text-sm font-medium text-gray-800">Segments</h2>
          </div>
          <div className="divide-y divide-gymnext-muted/20">
            <div className="px-4 py-3 flex flex-wrap gap-4 text-sm text-gray-800">
              <span>
                <strong>Auto progress:</strong> {workout.autoProgress ? 'Yes' : 'No'}
              </span>
              {workout.timerModes != null && (
                <span>
                  <strong>Timer modes:</strong>{' '}
                  {Array.isArray(workout.timerModes) ? (workout.timerModes as number[]).join(', ') : String(workout.timerModes)}
                </span>
              )}
            </div>
            {workout.segments!.map((seg, index) => {
              const segOptions = buildOptionsSection({
                prelude: seg.prelude,
                segue: seg.segue,
                warnings: seg.warnings,
                metronome: seg.metronome,
                direction: seg.direction,
                restDirection: seg.restDirection,
                warningStrategy: seg.warningStrategy,
                continuity: seg.continuity,
              })
              const segSchedule = parseWorkoutScheduleForDisplay(seg.workoutSchedule)
              return (
                <div key={seg.workoutId} className="px-4 py-4">
                  <h3 className="text-sm font-medium text-gray-800 mb-2">
                    Segment {index + 1}: {seg.workoutName ?? seg.workoutId}
                  </h3>
                  {(segOptions.rows.length > 0 || segSchedule) && (
                    <div className="space-y-3 pl-2">
                      {segOptions.rows.length > 0 && (
                        <dl className="sm:grid sm:grid-cols-3 sm:gap-4 space-y-1 text-sm">
                          {segOptions.rows.map((row) => (
                            <div key={row.label} className="sm:grid sm:grid-cols-3 sm:gap-4">
                              <dt className="font-medium text-gray-500">{row.label}</dt>
                              <dd className="font-mono text-gray-900 sm:col-span-2 break-all">{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {segSchedule && (
                        <dl className="sm:grid sm:grid-cols-3 sm:gap-4 space-y-1 text-sm">
                          {segSchedule.rows.map((row) => (
                            <div key={row.label} className="sm:grid sm:grid-cols-3 sm:gap-4">
                              <dt className="font-medium text-gray-500">{row.label}</dt>
                              <dd className="font-mono text-gray-900 sm:col-span-2 break-all">{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
