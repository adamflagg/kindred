/** The two rings of the Waitlist and Cancellations gender donuts (#2898); NestedGenderDonut draws them. */

import type { GenderBreakdown } from '../../types/metrics'
import { getGenderColor } from './genderColors'
import { genderDisplayName, sortByIdentityOrder } from '../camperships/kit/genderIdentity'

export interface DonutPart {
  /** The GenderBreakdown count this part reads. */
  readonly key: string
  readonly label: string
  readonly opacity: number
  /** A fixed colour instead of the gender's (the remainder's grey). */
  readonly color?: string
}

export interface Slice {
  name: string
  value: number
  gender: string
  color: string
}

export interface OuterSlice extends Slice {
  part: string
  opacity: number
}

/**
 * Both rings. Whatever a label's parts leave uncounted goes to `remainder` (Cancellations' Unknown Status), or
 * to the first part when there is none (old waitlist rows carry no split).
 */
export function nestedGenderRings(
  data: readonly GenderBreakdown[],
  parts: readonly DonutPart[],
  remainder?: DonutPart
): { inner: Slice[]; outer: OuterSlice[] } {
  const sorted = sortByIdentityOrder(data, (g) => g.gender)
  const inner = sorted.map((g) => ({
    name: genderDisplayName(g.gender),
    value: g.count,
    gender: g.gender,
    color: getGenderColor(g.gender),
  }))
  const outer: OuterSlice[] = []
  for (const g of sorted) {
    const base = getGenderColor(g.gender)
    const slice = (part: DonutPart, value: number): OuterSlice => ({
      name: `${genderDisplayName(g.gender)} · ${part.label}`,
      value,
      gender: g.gender,
      color: part.color ?? base,
      opacity: part.opacity,
      part: part.label,
    })
    let counted = 0
    for (const part of parts) {
      const value = (g as unknown as Record<string, number | undefined>)[part.key] ?? 0
      counted += value
      if (value > 0) outer.push(slice(part, value))
    }
    const rest = g.count - counted
    const into = remainder ?? parts[0]
    if (rest > 0 && into) outer.push(slice(into, rest))
  }
  return { inner, outer }
}
