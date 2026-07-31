/**
 * Weekend lifecycle, mirroring the summer sessions lander's grouping.
 *
 * Dates arrive as PocketBase datetimes ("2026-05-22 07:00:00.000Z") where the
 * 07:00Z IS local midnight at camp, so comparisons use the leading calendar
 * date rather than the instant — otherwise a weekend flips status a few hours
 * early or late depending on the viewer's offset.
 */
import type { WeekendSession } from '../../types/lodging'

export type WeekendStatus = 'in-progress' | 'upcoming' | 'completed'

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
  const start = calendarKey(session.start_date)
  const end = calendarKey(session.end_date)
  // A weekend with no dates cannot be past, and staff still need to see it.
  if (start === null || end === null) return 'upcoming'
  if (today < start) return 'upcoming'
  if (today > end) return 'completed'
  return 'in-progress'
}

export interface WeekendGroups {
  inProgress: WeekendSession[]
  upcoming: WeekendSession[]
  completed: WeekendSession[]
}

/**
 * Group by status, each sorted by start date. In-progress first — it is the
 * weekend staff are standing in.
 */
export function groupWeekends(sessions: WeekendSession[], today: number): WeekendGroups {
  const byStart = (a: WeekendSession, b: WeekendSession) =>
    (calendarKey(a.start_date) ?? 0) - (calendarKey(b.start_date) ?? 0)

  return {
    inProgress: sessions.filter((s) => weekendStatus(s, today) === 'in-progress').sort(byStart),
    upcoming: sessions.filter((s) => weekendStatus(s, today) === 'upcoming').sort(byStart),
    completed: sessions.filter((s) => weekendStatus(s, today) === 'completed').sort(byStart),
  }
}
