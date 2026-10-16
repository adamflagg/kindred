import type { SessionBreakdown } from '../types/metrics'
import { getAliasGroup } from './sessionAliases'
import { TEEN_PROGRAM_TYPES } from './sessionTypePredicates'

/** The result of pairing a year's sessions with another year's. */
export interface SessionPairing {
  /** For each current row (same order), the prior rows it pairs with: none, one, or every prior teen row of its type. */
  pairs: SessionBreakdown[][]
  /** Prior rows no current row took: sessions not offered this year. */
  retired: SessionBreakdown[]
}

function teenType(session: SessionBreakdown): string | null {
  const type = session.session_type ?? null
  return type != null && (TEEN_PROGRAM_TYPES as readonly string[]).includes(type) ? type : null
}

/**
 * Pair each current-year session with the prior year's, the way Velocity and Forecast do
 * (`match_session_in_year`, api/utils/session_metrics.py; `matchSessionInYear`): CampMinder
 * session id first, then the alias group of the current name (which includes the exact name),
 * one-to-one, so a prior row is used once. This is epic #3207's D-SESSION-MATCH: Overview's
 * Session Details and Session Enrollment Comparison tables share it.
 *
 * Teen programs (SCIT, TLI) then match by program type (ruling 12, 2026-10-14): a prior teen row
 * nothing else paired goes to the first current row of its type that nothing paired, or to the
 * type's only current row, so one current row can take several prior routes. Prior teen rows of
 * a type the current year does not run stay in `retired`.
 *
 * Callers roll TLI rows up first (`rollUpTliSessions`) when comparing. A CampMinder id of 0 means
 * "no id" and never pairs.
 */
export function pairSessions(
  current: readonly SessionBreakdown[],
  prior: readonly SessionBreakdown[]
): SessionPairing {
  const used = new Set<SessionBreakdown>()
  const pairs: SessionBreakdown[][] = current.map(() => [])

  // 1. CampMinder session id.
  current.forEach((c, i) => {
    if (!c.session_cm_id) return
    const hit = prior.find((p) => !used.has(p) && p.session_cm_id === c.session_cm_id)
    if (hit) {
      pairs[i]?.push(hit)
      used.add(hit)
    }
  })

  // 2. Alias group (canonical name first, then old names; the exact name is in its own group).
  current.forEach((c, i) => {
    if (pairs[i]?.length) return
    for (const name of getAliasGroup(c.session_name)) {
      const hit = prior.find((p) => !used.has(p) && p.session_name === name)
      if (hit) {
        pairs[i]?.push(hit)
        used.add(hit)
        return
      }
    }
  })

  // 3. Teen leftovers by program type.
  const paired = pairs.map((m) => m.length > 0)
  for (const p of prior) {
    const type = teenType(p)
    if (type == null || used.has(p)) continue
    const ofType = current.flatMap((c, i) => (teenType(c) === type ? [i] : []))
    const target = ofType.find((i) => !paired[i]) ?? (ofType.length === 1 ? ofType[0] : undefined)
    if (target === undefined) continue
    pairs[target]?.push(p)
    used.add(p)
  }

  return { pairs, retired: prior.filter((p) => !used.has(p)) }
}
