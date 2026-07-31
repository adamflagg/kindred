/**
 * Weekend date formatting.
 *
 * Its own module rather than a named export beside the picker: exporting a
 * helper from a component file breaks React Fast Refresh, which the repo
 * lints for.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const DATE_PART = /^(\d{4})-(\d{2})-(\d{2})/

function calendarDate(value: string): [number, number, number] | null {
  const match = DATE_PART.exec(value)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * "Sep 4–7, 2026".
 *
 * Parsed by hand rather than through `new Date`, for two reasons. PocketBase
 * sends a datetime, not a date — "2026-05-22 07:00:00.000Z" — and that 07:00Z
 * IS local midnight at camp, so `new Date(...)` formatted in any negative
 * offset would land on the right day only by accident. Taking the leading
 * calendar date is what the field actually means.
 */
export function formatSessionDates(start: string | undefined, end: string | undefined): string {
  if (start === undefined || end === undefined || start === '' || end === '') return ''

  const startParts = calendarDate(start)
  const endParts = calendarDate(end)
  if (!startParts || !endParts) return ''
  const [sy, sm, sd] = startParts
  const [ey, em, ed] = endParts

  const startMonth = MONTHS[sm - 1]
  const endMonth = MONTHS[em - 1]
  if (startMonth === undefined || endMonth === undefined) return ''

  if (sy === ey && sm === em && sd === ed) return `${startMonth} ${String(sd)}, ${String(sy)}`
  if (sy === ey && sm === em) {
    return `${startMonth} ${String(sd)}–${String(ed)}, ${String(sy)}`
  }
  return `${startMonth} ${String(sd)} – ${endMonth} ${String(ed)}, ${String(ey)}`
}
