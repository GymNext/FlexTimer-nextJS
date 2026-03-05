/**
 * User settings hierarchy matching iOS UserDetails:
 * - First layer: [Section] e.g. [Timer Defaults], [Visual]
 * - Second layer: // Subgroup e.g. Default Settings, Warmup, Cooldown
 */

export type SettingsSubgroup = { title: string; keys: string[] }

export type UserSettingsSection = {
  id: string
  title: string
  subgroups: SettingsSubgroup[]
}

export const USER_SETTINGS_SECTIONS: UserSettingsSection[] = [
  {
    id: 'timer-defaults',
    title: 'Timer Defaults',
    subgroups: [
      { title: 'Default Settings', keys: ['prelude', 'direction', 'restDirection', 'segue', 'warnings', 'warningStrategy'] },
      { title: 'Warmup', keys: ['warmupDuration', 'warmupDirection'] },
      { title: 'Cooldown', keys: ['cooldownDuration', 'cooldownDirection'] },
    ],
  },
  {
    id: 'visual',
    title: 'Visual',
    subgroups: [
      { title: 'Colors/Font', keys: ['timerTheme'] },
      { title: 'In App Visuals', keys: ['fullScreenLandscape', 'restAsDashes', 'allowRepCounting'] },
      { title: 'Flex Timer Visuals', keys: ['powerOnBehaviour'] },
      { title: 'Audio', keys: ['ledMute', 'mute'] },
      { title: 'In App Audio', keys: ['muteSpeech', 'appAudioLevel', 'audioSyncAlways', 'audioSyncRest', 'warningAudioType', 'raiseExternalAudioDuringRest'] },
    ],
  },
  {
    id: 'audio',
    title: 'Audio',
    subgroups: [
      { title: 'Voice', keys: ['voiceType'] },
      { title: 'Transition Sound Effects', keys: ['endSoundType', 'startSoundType', 'roundEndSoundType', 'roundStartSoundType', 'segmentEndSoundType', 'segmentStartSoundType', 'restSoundType'] },
      { title: 'Other Sound Effects', keys: ['markSoundType', 'cueSoundType', 'warningSoundType', 'playPauseSoundType2'] },
      { title: 'Flex Timer Buzzer', keys: ['ledVolume', 'ledVolumeMigration', 'multiTimerSingleAudio', 'audioActiveTimerOnly'] },
    ],
  },
  {
    id: 'heart-rates',
    title: 'Heart Rates',
    subgroups: [
      { title: 'Heart Rate Zone Tracking', keys: ['heartRateZoneEnabled', 'heartRateDisplayEnabled', 'heartRateDisplayFrequency'] },
      { title: 'Default Heart Rate Zones', keys: ['heartRateZone1Default', 'heartRateZone2Default', 'heartRateZone3Default'] },
      { title: 'Device Specific Heart Rate Zones', keys: ['heartRateZone1', 'heartRateZone2', 'heartRateZone3', 'heartRatePreferredDisplays'] },
    ],
  },
  {
    id: 'general',
    title: 'General',
    subgroups: [
      { title: 'Auto Close', keys: ['autoCloseOnTimerCompletionv31', 'autoCloseOnTimerCompletionDurationv31', 'duplicateIntervalOnCreation'] },
      { title: 'App Behaviour', keys: ['multiple', 'multipleTimers', 'forceDisconnectBlocked'] },
    ],
  },
  {
    id: 'other',
    title: 'Other',
    subgroups: [{ title: 'Other', keys: ['forceDisconnectBlocked'] }],
  },
  {
    id: 'backup',
    title: 'Backup',
    subgroups: [
      { title: 'Backup', keys: ['TimeOfLastBackup', 'BackupShareId'] },
    ],
  },
  {
    id: 'internal',
    title: 'Internal',
    subgroups: [
      { title: 'Time tracking', keys: ['TimeOfFirstLaunch', 'TimeOfLastClose'] },
      { title: 'Firmware', keys: ['TimeOfLastFirmwarePromptClose', 'LastFirmwareUpdateFailed'] },
      { title: 'Other', keys: ['OptedOutRating', 'ftueComplete', 'ignoreTimeZoneDifferences', 'ledVolumeMigration', 'timerSettingsVersion', 'audioActiveTimerOnly'] },
    ],
  },
  {
    id: 'multipeer',
    title: 'MultiPeer',
    subgroups: [
      { title: 'MultiPeer', keys: ['deviceName', 'multiPeerEnabled', 'multiPeerSharingEnabled', 'myPeers'] },
    ],
  },
]

export function getSettingsSection(sectionId: string): UserSettingsSection | undefined {
  return USER_SETTINGS_SECTIONS.find((s) => s.id === sectionId)
}

/** All keys for a section (flat), for backward compatibility. */
export function getSectionKeys(section: UserSettingsSection): string[] {
  return section.subgroups.flatMap((g) => g.keys)
}

function humanKey(key: string): string {
  const withoutVersion = key.replace(/v\d+$/i, '')
  return withoutVersion
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim()
}

/** Custom display labels for specific keys */
const LABEL_OVERRIDES: Record<string, string> = {
  multiple: 'Connect to Multiple Flex Timers',
  multipleTimers: 'Run Multiple Timers Simultaneously',
  ledMute: 'Flex Timer Buzzer',
  mute: 'In App Audio',
  playPauseSoundType2: 'Play & Pause Sound',
}

function getSettingLabel(key: string): string {
  return LABEL_OVERRIDES[key] ?? humanKey(key)
}

/** RestSoundType / StartEndSoundType: same cases */
const REST_START_END_SOUND_LABELS: string[] = ['beep', 'air_horn', 'fog_horn', 'stadium_horn', 'boxing_bell', 'scoreboard', 'whistle', 'voice']
/** MarkSoundType */
const MARK_SOUND_LABELS: string[] = ['dong', 'sticks', 'knock', 'ping']
/** PlayPauseSoundType */
const PLAY_PAUSE_SOUND_LABELS: string[] = ['beep', 'whistle', 'none']
/** CueSoundType (also used for warningSoundType) */
const CUE_SOUND_LABELS: string[] = ['beep', 'voice']
/** TimerTheme */
const TIMER_THEME_LABELS: string[] = ['Dark', 'Light']

function formatEnumCase(name: string): string {
  return name.replace(/_/g, ' ').replace(/^./, (s) => s.toUpperCase())
}

const SOUND_TYPE_KEYS: Record<string, string[] | undefined> = {
  restSoundType: REST_START_END_SOUND_LABELS,
  endSoundType: REST_START_END_SOUND_LABELS,
  startSoundType: REST_START_END_SOUND_LABELS,
  roundEndSoundType: REST_START_END_SOUND_LABELS,
  roundStartSoundType: REST_START_END_SOUND_LABELS,
  segmentEndSoundType: REST_START_END_SOUND_LABELS,
  segmentStartSoundType: REST_START_END_SOUND_LABELS,
  markSoundType: MARK_SOUND_LABELS,
  playPauseSoundType2: PLAY_PAUSE_SOUND_LABELS,
  cueSoundType: CUE_SOUND_LABELS,
  warningSoundType: CUE_SOUND_LABELS,
  timerTheme: TIMER_THEME_LABELS,
}

const ON_OFF_KEYS = new Set<string>(['ledMute', 'mute'])

function formatSettingValueWithKey(key: string, value: unknown): string {
  const labels = SOUND_TYPE_KEYS[key]
  if (labels && typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < labels.length) {
    return formatEnumCase(labels[value])
  }
  if (ON_OFF_KEYS.has(key) && typeof value === 'boolean') {
    return value ? 'on' : 'off'
  }
  return formatSettingValue(value)
}

export function formatSettingValue(value: unknown): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((v) => formatSettingValue(v)).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export type SettingRow = { key: string; label: string; value: string }

export function getSectionSettings(settings: Record<string, unknown> | undefined, keys: string[]): SettingRow[] {
  if (!settings) return keys.map((key) => ({ key, label: getSettingLabel(key), value: '—' }))
  return keys.map((key) => ({
    key,
    label: getSettingLabel(key),
    value: formatSettingValueWithKey(key, settings[key]),
  }))
}

/** Returns subgroups with their key-value rows for a section. */
export function getSectionSubgroupsWithRows(
  settings: Record<string, unknown> | undefined,
  section: UserSettingsSection
): { title: string; rows: SettingRow[] }[] {
  return section.subgroups.map((subgroup) => ({
    title: subgroup.title,
    rows: getSectionSettings(settings, subgroup.keys),
  }))
}
