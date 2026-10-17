import type { RetentionTrendsResponse, YearMetrics } from '../../types/metrics'
import { groupCounts } from './genderNotes'

/** The live season's comparison, read at the same registration day last year (decision 7, ruling #66). */
export interface LiveCompare {
  /** The season still registering (the newest row). */
  year: number
  priorYear: number
  /** Last year's total as it stood on the same registration day. */
  priorTotal: number
  /** That registration day, YYYY-MM-DD. */
  asOf: string
  /** The priority date itself: the figure waits a day (ruling 9). */
  pending: boolean
}

export interface YearRow {
  year: number
  total: number
  /** Total minus the year before's final, or minus last year at the same point on the live row. */
  change: number | null
  changePct: number | null
  basis: 'final' | 'same point' | null
  pending: boolean
  newCount: number
  returning: number
  newPct: number
  /** Campers per gender identity group (#2898), Gender field filling in where no answer was given. */
  groups: Record<string, number>
  cancelled: number | null
  cancelPct: number | null
  /** Retention into this year, percent (#3207 PR 11): of the year before's campers, the share enrolled now. */
  retention: number | null
  /** In points: against the year before's final, or, on the live row, the year before at the same registration day. */
  retentionChange: number | null
  retentionBasis: 'final' | 'same point' | null
}

/** The year before's same-point retention, for the live row's note ("2025's on that day"). */
export function retentionByYear(retention: RetentionTrendsResponse | undefined) {
  return new Map((retention?.years ?? []).map((t) => [t.to_year, t]))
}

/** Rows oldest first, each compared with the year before, however the table is later sorted. */
export function buildYearRows(
  years: readonly YearMetrics[],
  live: LiveCompare | null,
  retention?: RetentionTrendsResponse
): YearRow[] {
  const ordered = [...years].sort((a, b) => a.year - b.year)
  const transitions = retentionByYear(retention)
  const newestTo = Math.max(0, ...transitions.keys())
  const retentionLive = retention?.prior_basis === 'same_point'
  return ordered.map((year, i) => {
    const into = transitions.get(year.year)
    const before = transitions.get(year.year - 1)
    const liveRetention = retentionLive && year.year === newestTo
    const priorRate = liveRetention ? before?.same_point_rate : before?.retention_rate
    const retentionChange =
      into && priorRate != null ? (into.retention_rate - priorRate) * 100 : null
    const prev = ordered[i - 1]
    const isLive = live !== null && year.year === live.year
    const base = isLive ? live.priorTotal : (prev?.total_enrolled ?? null)
    const change = base === null ? null : year.total_enrolled - base
    const hasCancel = year.has_cancellation_data !== false
    return {
      year: year.year,
      total: year.total_enrolled,
      change,
      changePct: change === null || !base ? null : (change / base) * 100,
      basis: change === null ? null : isLive ? 'same point' : 'final',
      pending: isLive && live.pending,
      newCount: year.new_vs_returning.new_count,
      returning: year.new_vs_returning.returning_count,
      newPct: year.new_vs_returning.new_percentage,
      groups: groupCounts(Object.fromEntries(year.by_gender.map((g) => [g.gender, g.count]))),
      cancelled: hasCancel ? (year.total_cancelled ?? 0) : null,
      cancelPct: hasCancel ? (year.cancellation_rate ?? 0) : null,
      retention: into ? into.retention_rate * 100 : null,
      retentionChange,
      retentionBasis: retentionChange === null ? null : liveRetention ? 'same point' : 'final',
    }
  })
}

/**
 * How many notes the table's own columns carry; the Gender note (#2898) follows them. The
 * Retention column's note (#90) follows Cancel %'s, and the live row's comes last.
 */
export function yearNoteCount(live: LiveCompare | null, hasRetention = false): number {
  return 3 + (hasRetention ? 1 : 0) + (live ? 1 : 0)
}
