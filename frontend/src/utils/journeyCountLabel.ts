/**
 * The camper journey's count line (owner rulings 2026-09-22):
 * "3 summers · 2 adult weekends". Each part only when non-zero, `·` only
 * between shown parts, "" when all are zero. "at camp" is gone everywhere.
 * One builder for every header, so they cannot drift apart.
 */
import type { JourneyCounts } from '../hooks/camper/types'

export const EMPTY_JOURNEY_COUNTS: JourneyCounts = {
  summers: 0,
  familyWeekends: 0,
  adultWeekends: 0,
}

function part(count: number, noun: string): string | null {
  return count > 0 ? `${String(count)} ${noun}${count === 1 ? '' : 's'}` : null
}

export function journeyCountLabel(counts: JourneyCounts): string {
  return [
    part(counts.summers, 'summer'),
    part(counts.familyWeekends, 'family weekend'),
    part(counts.adultWeekends, 'adult weekend'),
  ]
    .filter((p): p is string => p !== null)
    .join(' · ')
}
