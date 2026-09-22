/**
 * Shared types for camper hooks
 */

import type { PersonsResponse, CampSessionsSessionTypeOptions } from '../../types/pocketbase-types'

// Historical camp record
export interface HistoricalRecord {
  year: number
  sessionName: string
  sessionType: string
  /**
   * Housing label for this row: the assigned bunk name for a summer/teen
   * session, or the household's resolved cabin name for a family-camp
   * session. Absent when nothing is assigned/known.
   *
   * A family-camp row NEVER carries the CampMinder day group here
   * (kindred#2466) — a day group is a daytime activity grouping, not where
   * the family slept, and staff do not want it in the slot every other row
   * uses for housing. It is dropped entirely rather than relabeled.
   */
  bunkName?: string
  startDate?: string
  endDate?: string
  /** Non-enrolled status (e.g. 'waitlisted', 'cancelled'). Absent for enrolled records. */
  attendeeStatus?: string
}

// Original CSV bunk data structure
export interface OriginalBunkData {
  share_bunk_with?: string
  share_bunk_with_updated?: string
  share_bunk_with_processed?: string
  do_not_share_bunk_with?: string
  do_not_share_bunk_with_updated?: string
  do_not_share_bunk_with_processed?: string
  internal_bunk_notes?: string
  internal_bunk_notes_updated?: string
  internal_bunk_notes_processed?: string
  bunking_notes_notes?: string
  bunking_notes_notes_updated?: string
  bunking_notes_notes_processed?: string
  ret_parent_socialize_with_best?: string
  ret_parent_socialize_with_best_updated?: string
  ret_parent_socialize_with_best_processed?: string
  first_name?: string
  last_name?: string
  person_cm_id?: number
}

/**
 * The journey header's counts, the same on every journey surface.
 * `summers` is CampMinder's `years_at_camp` — the most recent non-zero value
 * across the person's year rows, because CampMinder zeroes it for adults —
 * capped at the view year: a later season never leaks back, so an earlier
 * year reads as it would have in that year (owner-confirmed 2026-09-22).
 * The weekend counts are distinct (year, session) enrollments, current year
 * included.
 */
export interface JourneyCounts {
  summers: number
  familyWeekends: number
  adultWeekends: number
}

// Sibling with enrollment info
export interface SiblingWithEnrollment extends PersonsResponse {
  session?: {
    id: string
    cm_id: number
    name: string
    session_type: CampSessionsSessionTypeOptions
    start_date?: string
    end_date?: string
  }
  bunkName?: string | null
  attendeeStatus?: string
  /** Every other program this member is enrolled in this year. */
  additionalSessions?: Array<{ name: string; session_type: string }>
}
