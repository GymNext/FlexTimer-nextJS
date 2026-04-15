import type { AppGroupType } from '@/types/group'

export type HubTypeCard = {
  type: AppGroupType
  title: string
  description: string
  barColor: string
  emoji: string
}

/** Visual + copy for each hub type (Create Hub picker and Hubs list). */
export const HUB_TYPE_CARDS: readonly HubTypeCard[] = [
  {
    type: 'organization',
    title: 'Organization',
    description:
      'A parent hub for businesses, schools, or associations that manage people, programs, and sub-hubs.',
    barColor: '#2563eb',
    emoji: '🏛',
  },
  {
    type: 'gym',
    title: 'Gym',
    description: 'A training facility where members follow programs and participate in events.',
    barColor: '#0d9488',
    emoji: '🏋',
  },
  {
    type: 'class',
    title: 'Class',
    description: 'A scheduled training session led by a coach or instructor for a group of members.',
    barColor: '#38bdf8',
    emoji: '👥',
  },
  {
    type: 'team',
    title: 'Team',
    description: 'A group of athletes and/or coaches who train or compete together.',
    barColor: '#84cc16',
    emoji: '⚽',
  },
  {
    type: 'series',
    title: 'Series',
    description:
      'A collection of related events grouped under a competition, season, or recurring structure.',
    barColor: '#ea580c',
    emoji: '📋',
  },
  {
    type: 'event',
    title: 'Event',
    description: 'A single scheduled activity such as a game, workout, or competition.',
    barColor: '#6366f1',
    emoji: '📅',
  },
  {
    type: 'circle',
    title: 'Circle',
    description:
      'A community hub for users connected by a shared interest, role, job, or location.',
    barColor: '#9333ea',
    emoji: '⭕',
  },
] as const

const FALLBACK: Pick<HubTypeCard, 'emoji' | 'barColor' | 'title'> = {
  emoji: '📌',
  barColor: '#9ca3af',
  title: 'Hub',
}

export function hubTypeCard(groupType: AppGroupType | null): Pick<HubTypeCard, 'emoji' | 'barColor' | 'title'> {
  if (!groupType) return FALLBACK
  const c = HUB_TYPE_CARDS.find((x) => x.type === groupType)
  return c ?? FALLBACK
}
