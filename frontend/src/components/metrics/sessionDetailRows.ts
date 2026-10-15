import type { SessionBreakdown } from '../../types/metrics'
import { resolveSessionAlias } from '../../utils/sessionAliases'
import { rollUpTliSessions } from '../../utils/tliRollup'
import { TEEN_PROGRAM_TYPES } from '../../utils/sessionTypePredicates'

/** One row of the Overview's Session Details table. */
export interface SessionDetailRow {
  key: string
  /** The session's own name: the current year's, or the prior year's for a retired row. */
  sessionName: string
  /** Current-year figures; null on a retired row. */
  enrolled: number | null
  capacity: number | null
  utilization: number | null
  /** The prior year's name when one prior session matched under another name ("was: …"). */
  priorName: string | null
  /** Prior-year count; null outside compare mode or with no prior match. */
  priorEnrolled: number | null
  /** Current minus prior; a retired row's is minus its prior count. */
  delta: number | null
  /** A prior-year session with no current match: it was not offered this year. */
  retired: boolean
}

function teenType(session: SessionBreakdown): string | null {
  const type = session.session_type ?? null
  return type != null && (TEEN_PROGRAM_TYPES as readonly string[]).includes(type) ? type : null
}

/**
 * Session Details rows. Current sessions keep their order, matched to the prior year by
 * alias-resolved name. In compare mode, each prior session no current session matches follows
 * them as a retired row (decision 43 / K8), so the Delta column sums to the real change.
 *
 * Teen programs (SCIT, TLI) match by program type, as Forecast does (ruling 12, 2026-10-14): a
 * prior teen row no name matches goes to the first current row of its type with no name match,
 * or to the type's only current row, so one TLI row is compared with every prior TLI route. A
 * lone current row of a type therefore takes the whole prior type. Prior teen rows of a type
 * the current year does not run stay retired rows.
 *
 * In compare mode both years' TLI rows first roll into one "Teen Leadership Institute" line
 * (owner, 2026-10-14; `rollUpTliSessions`), so TLI matches by that name and the type matching
 * above now only reaches SCIT. With Compare off the rows stay as CampMinder has them.
 */
export function buildSessionDetailRows(
  currentRows: readonly SessionBreakdown[],
  priorRows: readonly SessionBreakdown[] | null | undefined,
  isComparing: boolean
): SessionDetailRow[] {
  const comparing = isComparing && priorRows != null
  const current = comparing ? rollUpTliSessions(currentRows) : currentRows
  const prior = comparing && priorRows ? rollUpTliSessions(priorRows) : []
  const priorByName = new Map<string, SessionBreakdown>()
  if (comparing) {
    for (const p of prior) {
      const name = resolveSessionAlias(p.session_name)
      if (!priorByName.has(name)) priorByName.set(name, p)
    }
  }

  // Each current row's prior sessions: its name match, then any teen rows of its type.
  const matchedPrior: SessionBreakdown[][] = current.map((session) => {
    const match = comparing ? priorByName.get(resolveSessionAlias(session.session_name)) : undefined
    return match ? [match] : []
  })
  const nameMatched = matchedPrior.map((m) => m.length > 0)
  const used = new Set<SessionBreakdown>(matchedPrior.flat())
  const matchedNames = new Set([...used].map((p) => resolveSessionAlias(p.session_name)))

  if (comparing) {
    for (const p of prior) {
      const type = teenType(p)
      if (type == null || used.has(p) || matchedNames.has(resolveSessionAlias(p.session_name)))
        continue
      const ofType = current.flatMap((c, i) => (teenType(c) === type ? [i] : []))
      const target =
        ofType.find((i) => !nameMatched[i]) ?? (ofType.length === 1 ? ofType[0] : undefined)
      if (target === undefined) continue
      matchedPrior[target]?.push(p)
      used.add(p)
    }
  }

  const rows: SessionDetailRow[] = current.map((session, i) => {
    const matches = matchedPrior[i] ?? []
    const priorEnrolled = matches.length ? matches.reduce((sum, p) => sum + p.count, 0) : null
    const only = matches.length === 1 ? matches[0] : undefined
    return {
      key: `current-${session.session_cm_id}-${session.session_name}`,
      sessionName: session.session_name,
      enrolled: session.count,
      capacity: session.capacity,
      utilization: session.utilization,
      priorName: only && only.session_name !== session.session_name ? only.session_name : null,
      priorEnrolled,
      delta: priorEnrolled != null ? session.count - priorEnrolled : null,
      retired: false,
    }
  })

  if (!comparing) return rows
  for (const p of prior) {
    if (used.has(p) || matchedNames.has(resolveSessionAlias(p.session_name))) continue
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
