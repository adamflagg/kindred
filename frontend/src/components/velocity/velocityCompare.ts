/**
 * Pure helpers shared by the Velocity and Cancellations pages (#3209): which prior year the
 * page compares with, the same-point "vs" value, and the small labels around them.
 */

import type { PriorYearSessionSummary, VelocityCurve } from '../../types/velocity'
import { formatCount } from '../../utils/numberFormat'
import { resolveSessionAlias } from '../../utils/sessionAliases'

/** Small muted pill, as used for the "new" session marker and the no-history note. */
export const MUTED_PILL_CLASS =
  'bg-muted text-muted-foreground ml-1.5 rounded-full px-2 py-0.5 text-xs font-medium'

/**
 * The one prior year every comparison on the page uses: the most recent selected year the
 * response actually carries. Filtering by the selection matters while placeholder data from
 * the previous selection is still showing; with nothing selected, every response year counts.
 */
export function pickComparisonYear(
  responseYears: number[],
  selectedYears: number[]
): number | null {
  const candidates = selectedYears.length
    ? responseYears.filter((y) => selectedYears.includes(y))
    : responseYears
  return candidates.length ? Math.max(...candidates) : null
}

/**
 * A session's prior-year summary as the By Session table reads it: by its own id when matched, else by its
 * canonical name. The pace card reads through this too, so the two never disagree (PR 12).
 */
export function sessionPriorOf(
  session: VelocityCurve,
  priorSessionMap: ReadonlyMap<number | string, PriorYearSessionSummary>
): PriorYearSessionSummary | undefined {
  const canonical = session.session_name ? resolveSessionAlias(session.session_name) : null
  return (
    (session.session_cm_id != null ? priorSessionMap.get(session.session_cm_id) : undefined) ??
    (canonical ? priorSessionMap.get(canonical) : undefined)
  )
}

/** Current latest minus the prior year's value at the same point; null when either is missing. */
export function vsPriorSamePoint(
  current: number | null | undefined,
  priorAtSamePoint: number | null | undefined
): number | null {
  if (current == null || priorAtSamePoint == null) return null
  return current - priorAtSamePoint
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-02-11" (or a full ISO timestamp) → "11 Feb 2026"; null when absent or malformed. */
export function formatHistoryStart(iso: string | null | undefined): string | null {
  const match = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const month = MONTHS[Number(match[2]) - 1]
  if (!month) return null
  return `${Number(match[3])} ${month} ${match[1]}`
}

/** The 1-based week a day offset falls in, matching the weekly charts' x-axis. */
export function todayWeekNumber(todayDayOffset: number): number {
  return Math.floor(todayDayOffset / 7) + 1
}

interface LegendLabelInput {
  currentYear: number
  /** The current line's latest value, in the line's own mode. */
  currentValue: number | null | undefined
  currentWeekNumber: number | null | undefined
  /** While the season is live the current value is a point, not a final. */
  isLive: boolean
  priors: Array<{ year: number; final: number | null | undefined }>
}

/**
 * Legend labels keyed by series name. The series names stay bare years so the tooltips,
 * which read the year out of the name, are unaffected.
 */
export function buildLegendLabels({
  currentYear,
  currentValue,
  currentWeekNumber,
  isLive,
  priors,
}: LegendLabelInput): Record<string, string> {
  const labels: Record<string, string> = {}
  const current = String(currentYear)
  if (currentValue == null) {
    labels[current] = current
  } else if (isLive && currentWeekNumber != null) {
    labels[current] = `${current} (${formatCount(currentValue)} at Wk ${currentWeekNumber})`
  } else {
    labels[current] = `${current} (${formatCount(currentValue)} final)`
  }
  for (const { year, final } of priors) {
    labels[String(year)] = final == null ? String(year) : `${year} (${formatCount(final)} final)`
  }
  return labels
}
