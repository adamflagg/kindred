import type { SessionBreakdown } from '../types/metrics'

/** The one line a year's TLI rows roll into when a comparison is on. */
export const TLI_ROLLUP_NAME = 'Teen Leadership Institute'

/**
 * Owner ruling (2026-10-14, "agreed on the TLI merge"): with a comparison on, a year's TLI rows
 * roll into ONE "Teen Leadership Institute" line, at the first TLI row's place. One year ran TLI
 * as two routes on the same dates (plus an empty TLI row); every other summer ran one row. Rolled
 * up, the years compare as one program instead of NEW / GONE / dashed rows. Count and capacity sum
 * (capacity over the rows that have one; null when none do), and utilization is re-derived.
 * SCIT is never rolled up: CIT and SIT are different programs. Callers apply this only in compare
 * mode; with Compare off the routes list separately, as CampMinder has them.
 */
export function rollUpTliSessions(rows: readonly SessionBreakdown[]): SessionBreakdown[] {
  const tli = rows.filter((r) => r.session_type === 'tli')
  const first = tli[0]
  if (!first) return [...rows]

  const count = tli.reduce((sum, r) => sum + r.count, 0)
  const capacities = tli.flatMap((r) => (r.capacity != null ? [r.capacity] : []))
  const capacity = capacities.length ? capacities.reduce((sum, c) => sum + c, 0) : null
  const rolled: SessionBreakdown = {
    session_cm_id: first.session_cm_id,
    session_name: TLI_ROLLUP_NAME,
    session_type: 'tli',
    count,
    capacity,
    utilization: capacity ? (count / capacity) * 100 : null,
  }
  return rows.flatMap((r) => (r === first ? [rolled] : r.session_type === 'tli' ? [] : [r]))
}
