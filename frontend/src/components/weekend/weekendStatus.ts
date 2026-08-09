/**
 * Weekend lifecycle, mirroring the summer sessions lander's grouping.
 *
 * Dates arrive as PocketBase datetimes ("2026-05-22 07:00:00.000Z") where the
 * 07:00Z IS local midnight at camp, so comparisons use the leading calendar
 * date rather than the instant — otherwise a weekend flips status a few hours
 * early or late depending on the viewer's offset.
 */
import type { WeekendSession } from '../../types/lodging'

/**
 * Three calendar states and one staff-owned one.
 *
 * `cancelled` is NOT a fourth point on the same timeline — the other three are
 * derived from the dates and this one is read off `session.status`, which staff
 * set at /manage/lodging and nothing syncs (kindred#2092).
 */
export type WeekendStatus = 'in-progress' | 'upcoming' | 'completed' | 'cancelled'

/** "2026-05-22 07:00:00.000Z" -> 20260522, or null when unparseable. */
export function calendarKey(value: string | undefined): number | null {
  if (value === undefined || value === '') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  return Number(`${match[1]}${match[2]}${match[3]}`)
}

/** Today as the same comparable key, in the viewer's local calendar. */
export function todayKey(now: Date): number {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return Number(`${String(year)}${month}${day}`)
}

export function weekendStatus(session: WeekendSession, today: number): WeekendStatus {
  // Cancellation OUTRANKS the calendar, and is checked before the dates are
  // even parsed. A weekend cancelled in March is still cancelled on the day it
  // would have started, and one cancelled after the fact must not read as
  // "completed" — "we ran it" and "nobody came" are different facts, and the
  // second is the one that explains why its board is empty.
  //
  // Only "cancelled" is a claim: the field is absent on an older payload and
  // "active" on almost every weekend, because absence of a status ROW is what
  // active means (kindred#2092).
  if (session.status === 'cancelled') return 'cancelled'
  const start = calendarKey(session.start_date)
  const end = calendarKey(session.end_date)
  // A weekend with no dates cannot be past, and staff still need to see it.
  if (start === null || end === null) return 'upcoming'
  if (today < start) return 'upcoming'
  if (today > end) return 'completed'
  return 'in-progress'
}

/**
 * Chronological order, as the summer sessions lander uses. CampMinder's
 * `sort_order` is a manual field that does not track the calendar, so a
 * picker sorted by it lists June after October.
 */
export function sortWeekendsByDate(sessions: WeekendSession[]): WeekendSession[] {
  return [...sessions].sort(
    (a, b) => (calendarKey(a.start_date) ?? 0) - (calendarKey(b.start_date) ?? 0)
  )
}

export interface WeekendGroups {
  inProgress: WeekendSession[]
  upcoming: WeekendSession[]
  completed: WeekendSession[]
  cancelled: WeekendSession[]
}

/**
 * Group by status, each sorted by start date. In-progress first — it is the
 * weekend staff are standing in.
 *
 * `cancelled` is its own group rather than a badge inside the calendar ones,
 * which is what takes a cancelled weekend out of every aggregate the lander
 * computes over "weekends still to plan" without anything having to remember
 * to exclude it. The group still EXISTS and is still rendered: a cancelled
 * weekend keeps lodging rows the sync deliberately cannot clean up, and its
 * deep link must keep resolving (kindred#2092).
 */
export function groupWeekends(sessions: WeekendSession[], today: number): WeekendGroups {
  return {
    inProgress: sortWeekendsByDate(
      sessions.filter((s) => weekendStatus(s, today) === 'in-progress')
    ),
    upcoming: sortWeekendsByDate(sessions.filter((s) => weekendStatus(s, today) === 'upcoming')),
    completed: sortWeekendsByDate(sessions.filter((s) => weekendStatus(s, today) === 'completed')),
    cancelled: sortWeekendsByDate(sessions.filter((s) => weekendStatus(s, today) === 'cancelled')),
  }
}
