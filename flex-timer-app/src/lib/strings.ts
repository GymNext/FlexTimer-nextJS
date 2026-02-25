/**
 * Localized strings matching iOS Flex Timer app (Localizable.strings).
 * Keys and default (English) values from the iOS app for parity in admin and plan UI.
 */

export const strings = {
  none_text: 'None',
  infinite_text: 'Infinite',
  unknown_text: 'Unknown',
  compound_text: 'Multi Segment',
  multi_segment_text: 'Multi Segment',
  empty_multi_segment_text: 'No Segments',

  standard_text: 'Standard',
  round_text: 'Round',
  custom_interval_text: 'Mixed Intervals',
  tabata_text: 'Tabata',
  emom_text: 'EMOM',
  shot_clock_text: 'Shot Clock',
  beep_test_text: 'Beep Test',
  timed_squash_text: 'Scoreboard',
  lap_timer_text: 'Lap Timer',
  rest_driven_text: 'Sets with Rest',
  rest_text: 'Rest',
  warmup_text: 'Warmup',
  cooldown_text: 'Cooldown',

  rest_abbr: 'R',

  count_up_to_text: 'Count up to %@',
  count_down_from_text: 'Count down from %@',
  count_up_infinite_text: 'Count up indefinitely',
  infinite_rounds_of_text: 'Infinite rounds of %@',
  rounds_of_text: '%i rounds of %@',
  with_rest_between_text: ' with %@ rest in between',
  no_custom_intervals_specified_text: 'No intervals specified',

  one_tabata_long_description_text: '%i rounds of %@/%@R',
  multiple_tabatas_long_description_text: '%i rounds of %@/%@R repeated %i times',
  emom_long_description_text: 'Every minute on the minute for %i minutes',
  emom_custom_long_description_text: 'Every %i seconds repeated %i times',

  lap_based_timer_text: 'Lap based timer',
  shot_clock_long_description_text: '%i second shot clock',
  multi_stage_fitness_test_text: 'Multi-stage fitness test',
  timed_squash_long_description_text: '%@ game clock',

  warmup_up_to_text: 'Warmup for ↑%@',
  warmup_down_from_text: 'Warmup for ↓%@',
  cooldown_up_to_text: 'Cooldown for ↑%@',
  cooldown_down_from_text: 'Cooldown for ↓%@',

  rest_driven_fixed_long_desc_text: '%i sets with %@ rest periods',
  rest_driven_ratio_long_desc_text: '%i sets with %i:%i work:rest periods',
  rest_up_to_text: 'Rest for ↑%@',
  rest_down_from_text: 'Rest for ↓%@',

  rest_between_repetitions_description_text: ' rest between repetitions ',
  with_text: ' with ',
} as const

/** Replace %@ (object) and %i (integer) in order with the given values. */
export function formatStr(
  template: string,
  ...values: (string | number)[]
): string {
  let out = template
  let i = 0
  out = out.replace(/%@|%i/g, () => {
    const v = values[i++]
    return v === undefined ? '' : String(v)
  })
  return out
}
