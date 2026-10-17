import { useMemo } from 'react'
import type { PriorYearSessionSummary, VelocityCurve, VelocityResponse } from '../../types/velocity'
import { buildPaceModel } from './velocityPace'
import type { PaceModel } from './velocityPace'

/**
 * The pace card's model for the page (#3207 PR 12), from the same rows and prior lookup the By Session
 * table reads. Null when there is nothing to pace: no comparison year, or no session with a match.
 */
export function useVelocityPace(
  data: VelocityResponse | undefined,
  sortedBySession: readonly VelocityCurve[],
  priorSessionMap: ReadonlyMap<number | string, PriorYearSessionSummary>,
  comparisonYear: number | null,
  sessions: ReadonlyArray<{ cm_id: number; session_type?: string | null }>,
  fold: boolean
): PaceModel | null {
  return useMemo(() => {
    if (!data || comparisonYear == null) return null
    const model = buildPaceModel({
      sessions: sortedBySession,
      priorSessionMap,
      summaries: data.prior_year_session_summaries.filter((s) => s.year === comparisonYear),
      basis: data.prior_basis ?? 'same_point',
      fold,
      embeddedIds: new Set(
        sessions.filter((s) => s.session_type === 'embedded').map((s) => s.cm_id)
      ),
    })
    return model.rows.length > 0 ? model : null
  }, [data, sortedBySession, priorSessionMap, comparisonYear, sessions, fold])
}
