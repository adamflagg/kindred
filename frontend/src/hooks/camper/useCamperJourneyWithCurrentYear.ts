/**
 * A person's whole camper journey — the current year AND the prior years —
 * for a journey surface that has no live enrollment read of its own: the
 * summer board's sidebar (`CamperDetailsPanel`) and the Women's/Men's Weekend
 * sidebar (`weekend/PersonJourneyCard`).
 *
 * Owner rulings 2026-09-24 (kindred#2812): "we should simply always show
 * current year enrollment data across family/adult/camper sidebars and full
 * page, if we have the info, even if we dont have the housing assignment
 * yet". So a sidebar shows the current year exactly as the camper record
 * does, and it does that by running the camper record's OWN build —
 * `useCamperEnrollment` (the live attendees and bunks, every program) under
 * `useCamperHistory` (the per-program cabin rules, a parent's family weekends,
 * the prior years) — rather than a second copy of it. The same query keys, so
 * a record and a sidebar open on one person share one cache entry, and every
 * existing invalidation of either key reaches both.
 */
import { useCamperEnrollment } from './useCamperEnrollment'
import { useCamperHistory } from './useCamperHistory'
import type { HistoricalRecord, JourneyCounts } from './types'

export interface UseCamperJourneyWithCurrentYearResult {
  /** Current year first, then prior years; chronological within a year. */
  history: HistoricalRecord[]
  counts: JourneyCounts
  isLoading: boolean
  error: Error | null
}

export function useCamperJourneyWithCurrentYear(
  personCmId: number | null,
  year: number
): UseCamperJourneyWithCurrentYearResult {
  const enrollment = useCamperEnrollment(personCmId, year)
  // The camper record's own primary-camper choice (`CamperDetail`): enrolled
  // first, else the best non-enrolled attendee.
  const camper = enrollment.enrolledCampers[0] ?? enrollment.allAttendees[0] ?? null
  const journey = useCamperHistory(personCmId, year, camper, enrollment.allAttendees)
  return {
    history: journey.camperHistory,
    counts: journey.counts,
    isLoading: enrollment.isLoading || journey.isLoading,
    error: journey.error ?? enrollment.error,
  }
}
