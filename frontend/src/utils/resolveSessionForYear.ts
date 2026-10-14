/**
 * Map a session onto another year's session list, in the same order as the
 * API resolver (`match_session_in_year`, api/utils/session_metrics.py):
 * cm_id, then the alias group of the reference name, then exact name.
 *
 * `sessions` is the MetricsSession list for the target year (main, embedded,
 * quest, scit, tli), which already excludes AG and family.
 */
import type { MetricsSession } from '../hooks/useMetricsSessions'
import { getAliasGroup } from './sessionAliases'

export function matchSessionInYear(
  sessions: readonly MetricsSession[],
  cmId: number,
  referenceName: string | null
): number | null {
  if (sessions.some((s) => s.cm_id === cmId)) return cmId
  if (!referenceName) return null
  for (const name of getAliasGroup(referenceName)) {
    const hit = sessions.find((s) => s.name === name)
    if (hit) return hit.cm_id
  }
  return null
}
