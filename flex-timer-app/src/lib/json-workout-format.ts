/**
 * Format workout schedule and options for admin display.
 * Firestore stores SingleSegmentWorkout with workoutSchedule (JSON string) and flat options;
 * schedule JSON mirrors JsonHelper.swift (timerMode determines which fields are present).
 * Display strings match iOS Localizable.strings via lib/strings.
 */

import { formatStr, strings } from '@/lib/strings'

/** RestDirection (Swift rawValue): matchWorkout=1, forceUp=2, forceDown=3 */
const REST_DIRECTION_BY_RAW: Record<number, string> = {
  1: 'Match workout',
  2: 'Force up',
  3: 'Force down',
}

/** WarningStrategy (Swift rawValue): allSets=1, workOnly=2, restOnly=3 */
const WARNING_STRATEGY_BY_RAW: Record<number, string> = {
  1: 'All sets',
  2: 'Work only',
  3: 'Rest only',
}

/** TimerMode (Swift rawValue): standard=1, then commonInterval(2), customInterval(3), tabata(4), emom(5), stopwatch(6), shotClock(7), beepTest(8), timedSquash(9), warmup(10), cooldown(11), restDriven(12), rest(13) */
const TIMER_MODE_BY_RAW: Record<number, string> = {
  1: 'Standard',
  2: 'CommonInterval',
  3: 'CustomInterval',
  4: 'Tabata',
  5: 'Emom',
  6: 'Stopwatch',
  7: 'ShotClock',
  8: 'BeepTest',
  9: 'TimedSquash',
  10: 'Warmup',
  11: 'Cooldown',
  12: 'RestDriven',
  13: 'Rest',
}

/** Timer mode colors (RGB) matching Swift Colors. Returns css value e.g. rgb(179,3,33). */
const TIMER_MODE_COLORS: Record<number, string> = {
  1: 'rgb(179, 3, 33)',       // Standard
  2: 'rgb(255, 110, 40)',     // CommonInterval
  3: 'rgb(116, 160, 6)',      // CustomInterval
  4: 'rgb(248, 194, 22)',     // Tabata
  5: 'rgb(57, 131, 57)',      // Emom
  6: 'rgb(92, 96, 104)',      // Stopwatch
  7: 'rgb(92, 96, 104)',      // ShotClock
  8: 'rgb(92, 96, 104)',      // BeepTest
  9: 'rgb(92, 96, 104)',     // TimedSquash
  10: 'rgb(245, 55, 45)',     // Warmup
  11: 'rgb(17, 158, 215)',    // Cooldown
  12: 'rgb(58, 110, 165)',    // RestDriven
  13: 'rgb(184, 215, 242)',   // Rest
}

/** Returns true if the color is dark (use white text for contrast). */
function isDarkTimerModeColor(mode: number): boolean {
  const darkModes = [1, 3, 5, 6, 7, 8, 9, 12] // standard, customInterval, emom, stopwatch, shotClock, beepTest, timedSquash, restDriven
  return darkModes.includes(mode)
}

/** Get background color for a timer mode (raw int). For display in planned workout cards etc. */
export function getTimerModeColor(value: unknown): string {
  if (value === undefined || value === null) return 'rgb(92, 96, 104)'
  if (typeof value === 'number') return TIMER_MODE_COLORS[value] ?? 'rgb(92, 96, 104)'
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'number')
    return TIMER_MODE_COLORS[value[0]] ?? 'rgb(92, 96, 104)'
  return 'rgb(92, 96, 104)'
}

/** Purple for multi-segment / compound workouts. */
const MULTI_SEGMENT_BAR_COLOR = 'rgb(107, 33, 168)'

/** Bar color for a workout/entry: purple for multi-segment, otherwise timer mode color. */
export function getWorkoutBarColor(entry: WorkoutEntryLike): string {
  if (entry.segments && entry.segments.length > 0) return MULTI_SEGMENT_BAR_COLOR
  return getTimerModeColor(entry.timerMode ?? entry.timerModes)
}

/** Whether to use white text on the timer mode color bar (for contrast). */
export function getTimerModeBarTextDark(value: unknown): boolean {
  const mode = typeof value === 'number' ? value : Array.isArray(value) && value.length > 0 && typeof value[0] === 'number' ? value[0] : null
  if (mode === null) return false
  return isDarkTimerModeColor(mode)
}

/** Schedule keys to show per timer mode (camelCase as in JSON). */
const SCHEDULE_KEYS_BY_MODE: Record<string, string[]> = {
  Standard: ['standardTimeCap', 'standardShowReps'],
  Rest: ['restTimeCap'],
  Cooldown: ['cooldownTimeCap'],
  Warmup: ['warmupTimeCap'],
  CommonInterval: [
    'commonIntervalDuration',
    'commonIntervalNumberOfRounds',
    'commonIntervalRestBetweenRounds',
    'commonIntervalShowRoundNumber',
  ],
  CustomInterval: [
    'customIntervalDurations',
    'customIntervalTypes',
    'customIntervalRepeats',
    'customIntervalSetNames',
    'customIntervalRestDurations',
    'customIntervalRestBetweenIntervals',
    'customIntervalNumberOfRounds',
    'customIntervalRestBetweenRounds',
    'customIntervalContinuousDisplay',
    'customIntervalShowIntervalNumber',
    'customIntervalShowRoundNumber',
  ],
  Tabata: [
    'tabataWorkDuration',
    'tabataRestDuration',
    'roundsPerTabata',
    'numberOfTabatas',
    'restBetweenTabatas',
    'tabataRestLastRound',
  ],
  Emom: ['emomIntervalDuration', 'emomNumberOfIntervals', 'emomShowRoundNumber'],
  Stopwatch: [],
  ShotClock: ['shotClockDuration'],
  TimedSquash: ['timedSquashDuration', 'score1Title', 'score2Title'],
  BeepTest: ['beepTestDisplay', 'beepTestVariation'],
  RestDriven: [
    'restDrivenNumberOfSets',
    'restDrivenType',
    'restDrivenFixedRestDuration',
    'restDrivenWorkRatio',
    'restDrivenRestRatio',
    'restDrivenRestLastRound',
  ],
}

function getTimerModeLabel(timerMode: unknown): string {
  if (timerMode === undefined || timerMode === null) return strings.unknown_text
  if (typeof timerMode === 'string') return timerMode
  if (typeof timerMode === 'number') return TIMER_MODE_BY_RAW[timerMode] ?? `Mode ${timerMode}`
  return String(timerMode)
}

/** Format timerMode (number) or timerModes (number[]) for display in lists (e.g. profile workouts table). */
export function formatTimerModeForDisplay(value: unknown): string {
  if (value === undefined || value === null) return '—'
  if (Array.isArray(value)) {
    const labels = value.map((v) => (typeof v === 'number' ? (TIMER_MODE_BY_RAW[v] ?? String(v)) : String(v)))
    return labels.length ? labels.join(', ') : '—'
  }
  return getTimerModeLabel(value)
}

/** Duration in seconds to "m:ss" or "h:mm:ss". 0 → none_text, -1 → infinite_text. (UIHelper.durationToString) */
export function durationToString(seconds: number): string {
  if (seconds === 0) return strings.none_text
  if (seconds === -1) return strings.infinite_text
  const h = Math.floor(seconds / 3600)
  const m = Math.floor(seconds / 60) - h * 60
  const s = seconds % 60
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  if (h === 0) return `${m}:${pad(s)}`
  return `${h}:${pad(m)}:${pad(s)}`
}

/** User-facing timer mode labels (iOS Localizable.strings). */
const TIMER_MODE_DISPLAY: Record<number, string> = {
  1: strings.standard_text,
  2: strings.round_text,
  3: strings.custom_interval_text,
  4: strings.tabata_text,
  5: strings.emom_text,
  6: strings.lap_timer_text,
  7: strings.shot_clock_text,
  8: strings.beep_test_text,
  9: strings.timed_squash_text,
  10: strings.warmup_text,
  11: strings.cooldown_text,
  12: strings.rest_driven_text,
  13: strings.rest_text,
}

/** Timer mode to user-facing string (UIHelper.timerTypeToString). */
export function timerModeToDisplayString(value: unknown): string {
  if (value === undefined || value === null) return strings.unknown_text
  if (typeof value === 'number') return TIMER_MODE_DISPLAY[value] ?? strings.unknown_text
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'number')
    return TIMER_MODE_DISPLAY[value[0]] ?? strings.unknown_text
  return strings.unknown_text
}

/** Parse workoutSchedule JSON and return timerMode (number) or undefined. */
function getTimerModeFromSchedule(scheduleStr: string | null | undefined): number | undefined {
  if (scheduleStr == null || typeof scheduleStr !== 'string') return undefined
  try {
    const s = JSON.parse(scheduleStr) as Record<string, unknown>
    return typeof s.timerMode === 'number' ? s.timerMode : undefined
  } catch {
    return undefined
  }
}

/** Build a short schedule description from workoutSchedule JSON (UIHelper._description equivalent). */
function scheduleToDisplayDescription(
  workoutScheduleJson: string | null | undefined,
  direction?: boolean
): string {
  if (workoutScheduleJson == null || typeof workoutScheduleJson !== 'string') return ''
  let s: Record<string, unknown>
  try {
    s = JSON.parse(workoutScheduleJson) as Record<string, unknown>
  } catch {
    return ''
  }
  const mode = typeof s.timerMode === 'number' ? s.timerMode : 0
  const dir = direction === true
  const n = (key: string, def: number) => (typeof s[key] === 'number' ? (s[key] as number) : def)

  switch (mode) {
    case 1: {
      const cap = n('standardTimeCap', 0)
      if (dir && cap !== 0) return formatStr(strings.count_up_to_text, durationToString(cap))
      if (cap === 0) return strings.count_up_infinite_text
      return formatStr(strings.count_down_from_text, durationToString(cap))
    }
    case 2: {
      const dur = n('commonIntervalDuration', 0)
      const rounds = n('commonIntervalNumberOfRounds', 0)
      const rest = n('commonIntervalRestBetweenRounds', 0)
      const durStr = durationToString(dur)
      let r =
        rounds === 0
          ? formatStr(strings.infinite_rounds_of_text, durStr)
          : formatStr(strings.rounds_of_text, rounds, durStr)
      if (rest > 0) r += formatStr(strings.with_rest_between_text, durationToString(rest))
      return r
    }
    case 3: {
      /** customIntervalTypes in schedule: 1=duration, 2=rest, 3=durationRepeated, 4=durationRestRepeated. Never 0.
       * customIntervalDurations:
       *   - type=duration or durationRepeated: work duration
       *   - type=rest: rest duration
       *   - type=durationRestRepeated: work duration
       * customIntervalRestDurations:
       *   - only used for type=durationRestRepeated: rest duration inside the block
       */
      const typeNumToStr: Record<number, string> = { 1: 'duration', 2: 'rest', 3: 'durationRepeated', 4: 'durationRestRepeated' }
      const rawTypes = Array.isArray(s.customIntervalTypes) ? s.customIntervalTypes : []
      const durations = Array.isArray(s.customIntervalDurations)
        ? (s.customIntervalDurations as number[])
        : []
      const restDurations = Array.isArray(s.customIntervalRestDurations)
        ? (s.customIntervalRestDurations as number[])
        : []
      const repeats = Array.isArray(s.customIntervalRepeats)
        ? (s.customIntervalRepeats as number[])
        : []
      if (rawTypes.length === 0 && durations.length === 0) {
        return strings.no_custom_intervals_specified_text
      }
      const rounds = n('customIntervalNumberOfRounds', 1)
      const parts: string[] = []
      const count = Math.max(rawTypes.length, durations.length, restDurations.length, repeats.length)
      for (let i = 0; i < count; i += 1) {
        const raw = rawTypes[i]
        const num = typeof raw === 'number' ? raw : typeof raw === 'string' && /^[1-4]$/.test(raw) ? parseInt(raw as string, 10) : 1
        const t = typeNumToStr[num] ?? 'duration'
        const primary = durations[i] ?? 0
        const secondary = restDurations[i] ?? 0
        const repsRaw = repeats[i]
        const reps = typeof repsRaw === 'number' && repsRaw > 0 ? repsRaw : 1
        if (t === 'duration') {
          parts.push(durationToString(primary))
        } else if (t === 'rest') {
          // Rest-only interval: its rest duration is stored in customIntervalDurations.
          parts.push(`${durationToString(primary)}R`)
        } else if (t === 'durationRepeated') {
          parts.push(`${reps} x ${durationToString(primary)}`)
        } else if (t === 'durationRestRepeated') {
          parts.push(`${reps} x ${durationToString(primary)}/${durationToString(secondary)}R`)
        } else {
          parts.push(durationToString(primary))
        }
      }
      let r = rounds > 1 ? `${rounds} x ` : ''
      r += parts.join(', ')
      return r
    }
    case 4: {
      const work = n('tabataWorkDuration', 0)
      const rest = n('tabataRestDuration', 0)
      const perTabata = n('roundsPerTabata', 8)
      const numTabatas = n('numberOfTabatas', 1)
      const workStr = durationToString(work)
      const restStr = durationToString(rest)
      if (numTabatas === 1)
        return formatStr(strings.one_tabata_long_description_text, perTabata, workStr, restStr)
      return formatStr(strings.multiple_tabatas_long_description_text, perTabata, workStr, restStr, numTabatas)
    }
    case 5: {
      const interval = n('emomIntervalDuration', 60)
      const count = n('emomNumberOfIntervals', 0)
      if (interval === 60) return formatStr(strings.emom_long_description_text, count)
      return formatStr(strings.emom_custom_long_description_text, interval, count)
    }
    case 6:
      return strings.lap_based_timer_text
    case 7:
      return formatStr(strings.shot_clock_long_description_text, n('shotClockDuration', 0))
    case 8:
      return strings.multi_stage_fitness_test_text
    case 9:
      return formatStr(strings.timed_squash_long_description_text, durationToString(n('timedSquashDuration', 0)))
    case 10: {
      const cap = durationToString(n('warmupTimeCap', 0))
      return dir ? formatStr(strings.warmup_up_to_text, cap) : formatStr(strings.warmup_down_from_text, cap)
    }
    case 11: {
      const cap = durationToString(n('cooldownTimeCap', 0))
      return dir ? formatStr(strings.cooldown_up_to_text, cap) : formatStr(strings.cooldown_down_from_text, cap)
    }
    case 12: {
      const sets = n('restDrivenNumberOfSets', 0)
      const type = n('restDrivenType', 0)
      if (type === 0)
        return formatStr(strings.rest_driven_fixed_long_desc_text, sets, durationToString(n('restDrivenFixedRestDuration', 0)))
      return formatStr(strings.rest_driven_ratio_long_desc_text, sets, n('restDrivenWorkRatio', 1), n('restDrivenRestRatio', 1))
    }
    case 13: {
      const cap = durationToString(n('restTimeCap', 0))
      return dir ? formatStr(strings.rest_up_to_text, cap) : formatStr(strings.rest_down_from_text, cap)
    }
    default:
      return ''
  }
}

/** Entry-like shape (PlanDayEntry or planned workout.workout) for display helpers. */
export interface WorkoutEntryLike {
  workoutName?: string | null
  workoutDescription?: string | null
  type?: string
  timerMode?: number | unknown
  timerModes?: number[] | unknown
  workoutSchedule?: string | null
  segments?: Array<{ workoutName?: string | null; workoutDescription?: string | null; workoutSchedule?: string | null; timerMode?: number }>
  direction?: boolean
}

/** Display name for workout/entry: name if set, else schedule description or "Compound". (UIHelper.workoutName) */
export function getWorkoutDisplayName(entry: WorkoutEntryLike): string {
  if (entry.workoutName != null && entry.workoutName !== '') return entry.workoutName
  const segments = entry.segments
  if (segments && segments.length > 0) {
    // Multi-segment: use segment title if set, else timer mode label (Warmup, Standard, Cooldown, etc.)
    const parts = segments.map((seg, i) => {
      if (seg.workoutName != null && seg.workoutName !== '') return seg.workoutName
      const modeLabel = timerModeToDisplayString(
        seg.timerMode ?? getTimerModeFromSchedule(seg.workoutSchedule)
      )
      return modeLabel !== strings.unknown_text ? modeLabel : `Segment ${i + 1}`
    })
    return parts.join(', ') || strings.compound_text
  }
  const desc = scheduleToDisplayDescription(entry.workoutSchedule, entry.direction)
  return desc || timerModeToDisplayString(entry.timerMode ?? entry.timerModes)
}

/** Display name for a single segment in lists: segment title if set, else schedule description (workout type), else "Segment N". */
export function getSegmentDisplayName(
  seg: { workoutName?: string | null; workoutSchedule?: string | null; direction?: boolean },
  index: number
): string {
  if (seg.workoutName != null && seg.workoutName.trim() !== '') return seg.workoutName.trim()
  const desc = scheduleToDisplayDescription(seg.workoutSchedule, seg.direction)
  return desc || `Segment ${index + 1}`
}

/** Display description: workoutDescription if set, else timer mode label or compound_text. (UIHelper.workoutDescription) */
export function getWorkoutDisplayDescription(entry: WorkoutEntryLike): string {
  if (entry.workoutDescription != null && entry.workoutDescription !== '') return entry.workoutDescription
  if (entry.segments && entry.segments.length > 0) return strings.compound_text
  return timerModeToDisplayString(entry.timerMode ?? entry.timerModes)
}

/** Schedule-only description (duration, rounds, etc.) from workoutSchedule JSON. Use for body/details. */
export function getScheduleDisplayDescription(entry: WorkoutEntryLike): string {
  if (entry.segments && entry.segments.length > 0) return strings.compound_text
  return scheduleToDisplayDescription(entry.workoutSchedule, entry.direction)
}

/** Collection-like shape for display helpers (UIHelper.workoutCollectionName / workoutCollectionDescription). */
export interface CollectionEntryLike {
  workoutCollectionName?: string | null
  workoutCollectionDescription?: string | null
  workoutIds?: unknown[]
}

/** Display name for collection: name if set, else "<empty>". (UIHelper.workoutCollectionName) */
export function getCollectionDisplayName(entry: CollectionEntryLike): string {
  if (entry.workoutCollectionName != null && entry.workoutCollectionName !== '')
    return entry.workoutCollectionName
  return '<empty>'
}

/** Display description for collection: description if set, else count-based fallback. (UIHelper.workoutCollectionDescription) */
export function getCollectionDisplayDescription(entry: CollectionEntryLike): string {
  if (entry.workoutCollectionDescription != null && entry.workoutCollectionDescription !== '')
    return entry.workoutCollectionDescription
  const count = entry.workoutIds?.length ?? 0
  if (count === 0) return 'Empty collection of workouts'
  if (count === 1) return 'Collection of 1 workout'
  return `Collection of ${count} workouts`
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number' || typeof value === 'string') return String(value)
  if (Array.isArray(value)) return value.map((v) => formatValue(v)).join(', ')
  return JSON.stringify(value)
}

function humanKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim()
}

export interface JsonWorkoutSection {
  title: string
  rows: { label: string; value: string }[]
}

/**
 * Parse workoutSchedule JSON string (from Firestore) and return a Schedule section for display.
 * Schedule is stored as JSON string from JsonHelper.toJsonFromWorkoutSchedule.
 */
export function parseWorkoutScheduleForDisplay(workoutScheduleJson: string | null | undefined): JsonWorkoutSection | null {
  if (workoutScheduleJson == null || typeof workoutScheduleJson !== 'string') return null
  let scheduleObj: Record<string, unknown>
  try {
    scheduleObj = JSON.parse(workoutScheduleJson) as Record<string, unknown>
  } catch {
    return null
  }
  const timerMode = scheduleObj.timerMode
  const modeLabel = getTimerModeLabel(timerMode)
  const scheduleRows: { label: string; value: string }[] = [
    { label: 'Timer mode', value: modeLabel },
  ]
  const keysToShow = SCHEDULE_KEYS_BY_MODE[modeLabel]
  if (keysToShow) {
    for (const key of keysToShow) {
      if (key in scheduleObj) {
        scheduleRows.push({ label: humanKey(key), value: formatValue(scheduleObj[key]) })
      }
    }
  } else {
    for (const [k, v] of Object.entries(scheduleObj)) {
      if (k === 'timerMode') continue
      scheduleRows.push({ label: humanKey(k), value: formatValue(v) })
    }
  }
  return { title: 'Schedule', rows: scheduleRows }
}

/**
 * Build Options section from Firestore flat fields (SingleSegmentWorkout or one segment).
 */
export function buildOptionsSection(options: {
  prelude?: number
  segue?: boolean
  warnings?: number[]
  metronome?: number
  direction?: boolean
  restDirection?: number
  warningStrategy?: number
  continuity?: boolean
}): JsonWorkoutSection {
  const rows: { label: string; value: string }[] = []
  if (options.prelude !== undefined && options.prelude !== -1) rows.push({ label: 'Prelude', value: String(options.prelude) })
  if (options.segue !== undefined) rows.push({ label: 'Segue', value: options.segue ? 'Yes' : 'No' })
  if (options.warnings?.length) rows.push({ label: 'Warnings', value: options.warnings.join(', ') })
  if (options.metronome !== undefined) rows.push({ label: 'Metronome', value: String(options.metronome) })
  if (options.direction !== undefined) rows.push({ label: 'Direction', value: options.direction ? 'Yes' : 'No' })
  if (options.restDirection !== undefined) {
    const label = REST_DIRECTION_BY_RAW[options.restDirection] ?? `Raw ${options.restDirection}`
    rows.push({ label: 'Rest direction', value: label })
  }
  if (options.warningStrategy !== undefined) {
    const label = WARNING_STRATEGY_BY_RAW[options.warningStrategy] ?? `Raw ${options.warningStrategy}`
    rows.push({ label: 'Warning strategy', value: label })
  }
  if (options.continuity !== undefined) rows.push({ label: 'Continuity', value: options.continuity ? 'Yes' : 'No' })
  return { title: 'Options', rows }
}
