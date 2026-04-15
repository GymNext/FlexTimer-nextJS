'use client'

import { Handshake, UserCircle2, Users } from 'lucide-react'
import type { WorkoutPlan } from '@/types/user'

export type PlanVisualKind = 'personal' | 'private' | 'group'

export function planVisualKindFromPlan(plan: WorkoutPlan): PlanVisualKind {
  if (plan.isPersonal) return 'personal'
  if (plan.trainingIntent === 1) return 'group'
  return 'private'
}

export function planVisualKindFromFlags(isPersonal: boolean, trainingIntent: number): PlanVisualKind {
  if (isPersonal) return 'personal'
  if (trainingIntent === 1) return 'group'
  return 'private'
}

/**
 * Plans / Plan Ahead list: personal vs private training vs group training (lucide icons).
 */
export function PlanKindIcon({
  kind,
  selected = false,
  className,
}: {
  kind: PlanVisualKind
  /** Selected row in Plans or Plan Ahead uses slightly darker teal. */
  selected?: boolean
  className?: string
}) {
  const color = selected ? 'text-teal-700' : 'text-teal-600'
  const cls = ['h-5 w-5 shrink-0', color, className].filter(Boolean).join(' ')
  const stroke = 1.5
  if (kind === 'personal') {
    return <UserCircle2 className={cls} strokeWidth={stroke} aria-hidden />
  }
  if (kind === 'group') {
    return <Users className={cls} strokeWidth={stroke} aria-hidden />
  }
  return <Handshake className={cls} strokeWidth={stroke} aria-hidden />
}
