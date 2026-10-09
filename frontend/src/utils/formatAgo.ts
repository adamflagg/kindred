const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/**
 * A compact relative time for the secondary bar's freshness chips: "18h ago", "3d ago" (owner
 * 2026-10-08). date-fns' "about 18 hours ago" cut the Camperships Remaining line off; the absolute
 * time stays in each chip's tooltip (#1706). Each unit floors, so a chip never claims fresher than it is.
 */
export function formatAgo(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime()
  if (ms < MINUTE) return 'just now'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`
  if (ms < MONTH) return `${Math.floor(ms / DAY)}d ago`
  if (ms < YEAR) return `${Math.floor(ms / MONTH)}mo ago`
  return `${Math.floor(ms / YEAR)}y ago`
}
