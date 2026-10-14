import type { SessionBreakdown } from '../../types/metrics'
import { resolveSessionAlias } from '../../utils/sessionAliases'

/** One row of the Overview's Session Details table. */
export interface SessionDetailRow {
  key: string
  /** The session's own name: the current year's, or the prior year's for a retired row. */
  sessionName: string
  /** Current-year figures; null on a retired row. */
  enrolled: number | null
  capacity: number | null
  utilization: number | null
  /** The prior year's name when an alias matched a renamed session ("was: …"). */
  priorName: string | null
  /** Prior-year count; null outside compare mode or with no prior match. */
  priorEnrolled: number | null
  /** Current minus prior; a retired row's is minus its prior count. */
  delta: number | null
  /** A prior-year session with no current match: it was not offered this year. */
  retired: boolean
}

/**
 * Session Details rows. Current sessions keep their order, matched to the prior year by
 * alias-resolved name. In compare mode, each prior session no current session matches follows
 * them as a retired row (decision 43 / K8), so the Delta column sums to the real change.
 * Teen routes are not matched by type: a single current teen session and two prior routes stay
 * one unmatched row and two retired rows.
 */
export function buildSessionDetailRows(
  current: readonly SessionBreakdown[],
  prior: readonly SessionBreakdown[] | null | undefined,
  isComparing: boolean
): SessionDetailRow[] {
  const comparing = isComparing && prior != null
  const priorByName = new Map<string, SessionBreakdown>()
  if (comparing) {
    for (const p of prior) {
      const name = resolveSessionAlias(p.session_name)
      if (!priorByName.has(name)) priorByName.set(name, p)
    }
  }

  const matched = new Set<string>()
  const rows: SessionDetailRow[] = current.map((session) => {
    const name = resolveSessionAlias(session.session_name)
    const match = comparing ? priorByName.get(name) : undefined
    if (match) matched.add(name)
    return {
      key: `current-${session.session_cm_id}-${session.session_name}`,
      sessionName: session.session_name,
      enrolled: session.count,
      capacity: session.capacity,
      utilization: session.utilization,
      priorName: match && match.session_name !== session.session_name ? match.session_name : null,
      priorEnrolled: match?.count ?? null,
      delta: match ? session.count - match.count : null,
      retired: false,
    }
  })

  if (!comparing) return rows
  for (const p of prior) {
    if (matched.has(resolveSessionAlias(p.session_name))) continue
    rows.push({
      key: `retired-${p.session_cm_id}-${p.session_name}`,
      sessionName: p.session_name,
      enrolled: null,
      capacity: null,
      utilization: null,
      priorName: null,
      priorEnrolled: p.count,
      delta: -p.count,
      retired: true,
    })
  }
  return rows
}
