/** A calendar day, with no time and no time zone. */
export interface CalendarDay {
  readonly year: number
  readonly month: number // 1-12
  readonly day: number // 1-31
}

/**
 * The calendar day a PocketBase date string names — its first ten
 * characters. PocketBase hands dates back as `YYYY-MM-DD HH:MM:SS.mmmZ`, and a
 * session's `start_date` is Pacific midnight stored as UTC; `new Date(...)`
 * would turn that into an instant and, west of UTC, a birthdate into the day
 * before. Mirrors the server's `_as_date` (api/services/lodging_roster_service.py).
 *
 * @returns the day, or null when the string does not start with a date
 */
export function parseCalendarDay(value: string | null | undefined): CalendarDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value?.trim() ?? '')
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** Days in `month` (1-12) of `year` — `_as_date` refuses Feb 30 and Apr 31 too. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/** Today's calendar day, in local time. */
export function todayCalendarDay(now: Date = new Date()): CalendarDay {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
}

/**
 * Whole months from `start` to `end`, the way a parent counts them — the
 * last month counts only once it has finished. Same arithmetic as the
 * server's `_completed_months`, so a leap-day birth turns over on Mar 1 in a
 * common year. Negative when `end` predates `start`.
 */
export function completedMonths(start: CalendarDay, end: CalendarDay): number {
  const months = (end.year - start.year) * 12 + (end.month - start.month)
  return end.day < start.day ? months - 1 : months
}

/** Whole months as CampMinder's yy.mm (13 years 2 months -> 13.02). */
export function monthsToCampMinderAge(totalMonths: number): number {
  const years = Math.floor(totalMonths / 12)
  const months = totalMonths - years * 12
  return (years * 100 + months) / 100
}

/**
 * Calculate age in years with fractional months (e.g., 12.07 for 12 years 7 months)
 * @param birthdate - Date string in format YYYY-MM-DD (a PocketBase datetime works too)
 * @param asOf - The day to measure at: a date string or a local `Date`; defaults to today
 * @returns Age in CampMinder's yy.mm form (e.g., 12.07); NaN when either date is
 *   unreadable or `asOf` predates the birth (the server's `_age_at` reports None)
 */
export function calculateAge(birthdate: string, asOf: string | Date = new Date()): number {
  const birth = parseCalendarDay(birthdate)
  const end = typeof asOf === 'string' ? parseCalendarDay(asOf) : todayCalendarDay(asOf)
  if (!birth || !end) return NaN
  const months = completedMonths(birth, end)
  return months < 0 ? NaN : monthsToCampMinderAge(months)
}
