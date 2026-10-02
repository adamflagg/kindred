/**
 * Dates as Camperships shows them. "Today" is camp time, the zone the server's as-of reads cut
 * on (api/services/camp_calendar.py CAMP_TZ). Days arrive as YYYY-MM-DD and are read by their
 * parts, never through `new Date(…)`, which would shift them a day in a western time zone.
 */

const CAMP_TIME_ZONE = 'America/Los_Angeles'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** Today on camp time, YYYY-MM-DD. */
export function campToday(now: Date = new Date()): string {
  // Built from parts: a locale's numeric order is CLDR's to change, ISO is ours.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAMP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month').padStart(2, '0')}-${part('day').padStart(2, '0')}`
}

/** A real calendar day in YYYY-MM-DD, or null (2026-02-30 is not one). */
export function parseIsoDay(raw: string): { year: number; month: number; day: number } | null {
  const match = ISO_DAY.exec(raw)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null
  }
  return { year, month, day }
}

/** "Apr 1". A timestamp is read by its day part; anything unreadable comes back unchanged. */
export function formatShortDate(iso: string): string {
  const day = parseIsoDay(iso.slice(0, 10))
  if (day === null) return iso
  return `${MONTHS[day.month - 1] ?? ''} ${String(day.day)}`
}

/** "Apr 1, 2027". */
export function formatLongDate(iso: string): string {
  const day = parseIsoDay(iso.slice(0, 10))
  if (day === null) return iso
  return `${formatShortDate(iso)}, ${String(day.year)}`
}

/** "Apr 9 16:05": a stored time on camp time, 24-hour (history.html B). Anything unreadable comes back unchanged. */
export function formatCampDateTime(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAMP_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('month')} ${part('day')} ${part('hour')}:${part('minute')}`
}
