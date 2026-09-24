/**
 * Display age utility — owner ruling 2026-09-24.
 *
 * `persons.age` is CampMinder's yy.mm SNAPSHOT, taken whenever that year's
 * row last synced, and rows for different years sync at different times. The
 * old rule ("stored age minus (calendar year - viewing year)") therefore
 * drifted: a camper's two pages could read ages well over a year apart for
 * what is one year. So an age is computed from `birthdate` instead:
 *
 * - Current year: the age as of TODAY.
 * - Prior year: the age at that year's SESSION START. The caller passes it:
 *   the session in context on a board, or the person's earliest enrolled
 *   session start that year on the camper page (`earliestSessionStart`).
 *   With no session, the age on today's date that many years ago.
 * - No readable birthdate: the stored `persons.age` with the old year
 *   adjustment. That is APPROXIMATE — off by however far the snapshot's sync
 *   date sits from the day being shown.
 *
 * Output stays CampMinder's yy.mm, so `formatAge`/`displayCampMinderAge`
 * render it unchanged. Weekend surfaces do not read this: their ages come
 * from the server (`lodging_roster_service.py`, kindred#2088/#2420).
 */

import {
  completedMonths,
  isLeapYear,
  monthsToCampMinderAge,
  parseCalendarDay,
  todayCalendarDay,
  type CalendarDay,
} from './ageCalculator'

export interface PersonWithAge {
  age?: number | undefined
  birthdate?: string | undefined
}

/** Today's month and day in `year` — Feb 29 becomes Feb 28 in a common year. */
function todayInYear(today: CalendarDay, year: number): CalendarDay {
  const day = today.month === 2 && today.day === 29 && !isLeapYear(year) ? 28 : today.day
  return { year, month: today.month, day }
}

/**
 * Get display age for a person based on viewing context
 *
 * @param person - Person record with optional age and birthdate
 * @param viewingYear - The year being viewed in the UI
 * @param sessionStart - `start_date` of the session the age is read at (see
 *   the module comment); used only for a year other than the current one
 * @returns Age in CampMinder format (years.months), or null if unavailable
 */
export function getDisplayAge(
  person: PersonWithAge,
  viewingYear: number,
  sessionStart?: string | null
): number | null {
  const today = todayCalendarDay()
  const birth = parseCalendarDay(person.birthdate)

  if (birth) {
    const asOf =
      viewingYear === today.year
        ? today
        : (parseCalendarDay(sessionStart) ?? todayInYear(today, viewingYear))
    const months = completedMonths(birth, asOf)
    // Measured before the birth: bad data, not an age (the server's `_age_at`).
    return months < 0 ? null : monthsToCampMinderAge(months)
  }

  // Approximate fallback: the snapshot, shifted by the year gap.
  if (person.age !== undefined) {
    const adjustedAge = person.age - (today.year - viewingYear)
    return Math.round(adjustedAge * 100) / 100
  }

  return null
}

/**
 * Hook-friendly alias of `getDisplayAge`.
 */
export function getDisplayAgeForYear(
  person: PersonWithAge,
  viewingYear: number,
  sessionStart?: string | null
): number | null {
  return getDisplayAge(person, viewingYear, sessionStart)
}

/**
 * The earliest `start_date` among `sessions`, compared by calendar day —
 * for a surface with no single session in context (the camper page for a
 * past year), which reads the age at the person's earliest enrolled session
 * start that year. Missing sessions and blank dates are skipped.
 */
export function earliestSessionStart(
  sessions: ReadonlyArray<{ readonly start_date?: string | null | undefined } | null | undefined>
): string | undefined {
  let earliest: string | undefined
  let earliestKey = ''
  for (const session of sessions) {
    const start = session?.start_date
    if (!start || !parseCalendarDay(start)) continue
    // A validated `YYYY-MM-DD` prefix sorts as a string.
    const key = start.trim().slice(0, 10)
    if (earliest === undefined || key < earliestKey) {
      earliest = start
      earliestKey = key
    }
  }
  return earliest
}
