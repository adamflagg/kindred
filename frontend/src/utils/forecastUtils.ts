import type { ForecastPriorTotals, SessionForecast } from '../types/forecast'

export interface ForecastSection {
  key: 'camp' | 'quest' | 'teen'
  label: string
  sessions: SessionForecast[]
  total: SessionForecast
}

/**
 * Compute a section total across a list of sessions.
 * Mirrors the Python `_compute_grand_total()` logic from forecast_service.py:
 * - enrolled is always summed
 * - nullable fields (waitlisted, goal, prior, revenue) use null-aware aggregation:
 *   return null if ALL sessions have null, otherwise sum treating null as 0
 * - derived fields (percentages, deltas) are computed from the aggregated totals
 *
 * When `priorOverride` is given (the backend's whole-scope section prior), the
 * prior and two-year-prior counts come from it instead of the row sums, and the
 * vs-prior delta is re-derived from it.
 */
export function computeSectionTotal(
  sessions: SessionForecast[],
  label: string,
  priorOverride?: ForecastPriorTotals
): SessionForecast {
  const totalEnrolled = sessions.reduce((sum, s) => sum + s.enrolled, 0)
  const totalWaitlisted = sessions.reduce((sum, s) => sum + (s.waitlisted ?? 0), 0)
  // An empty list keeps the historical 0; null only when every row is null.
  const hasWaitlist = sessions.length === 0 || sessions.some((s) => s.waitlisted !== null)

  const totalGoal = sessions.reduce((sum, s) => sum + (s.participant_goal ?? 0), 0)
  const rowPrior = sessions.reduce((sum, s) => sum + (s.prior_year_count ?? 0), 0)
  const rowTwoYear = sessions.reduce((sum, s) => sum + (s.two_year_prior_count ?? 0), 0)

  const hasGoal = sessions.some((s) => s.participant_goal !== null)
  const rowHasPrior = sessions.some((s) => s.prior_year_count !== null)
  const rowHasTwoYear = sessions.some((s) => s.two_year_prior_count !== null)

  const priorTotal = priorOverride ? priorOverride.prior_year_count : rowHasPrior ? rowPrior : null
  const twoYearTotal = priorOverride
    ? priorOverride.two_year_prior_count
    : rowHasTwoYear
      ? rowTwoYear
      : null

  const totalBudgetRev = sessions.reduce((sum, s) => sum + (s.budget_revenue ?? 0), 0)
  const totalActualRev = sessions.reduce((sum, s) => sum + (s.actual_revenue ?? 0), 0)
  const hasRevenue = sessions.some((s) => s.budget_revenue !== null)

  let pctOfGoal: number | null = null
  if (hasGoal && totalGoal > 0) {
    pctOfGoal = Math.round((totalEnrolled / totalGoal) * 1000) / 10
  }

  const participantsVsBudget = hasGoal ? totalEnrolled - totalGoal : null
  const participantsVsPriorYear = priorTotal !== null ? totalEnrolled - priorTotal : null

  const revenueDelta = hasRevenue ? totalActualRev - totalBudgetRev : null
  let revenuePct: number | null = null
  if (hasRevenue && totalBudgetRev > 0) {
    revenuePct = Math.round((totalActualRev / totalBudgetRev) * 1000) / 10
  }

  const totalBoys = sessions.reduce((sum, s) => sum + (s.enrolled_boys ?? 0), 0)
  const totalGirls = sessions.reduce((sum, s) => sum + (s.enrolled_girls ?? 0), 0)
  const hasGender = sessions.some((s) => s.enrolled_boys !== null)

  return {
    session_cm_id: 0,
    session_name: label,
    session_type: 'total',
    session_fee: null,
    enrolled: totalEnrolled,
    waitlisted: hasWaitlist ? totalWaitlisted : null,
    participant_goal: hasGoal ? totalGoal : null,
    pct_of_goal: pctOfGoal,
    prior_year_count: priorTotal,
    two_year_prior_count: twoYearTotal,
    participants_vs_budget: participantsVsBudget,
    participants_vs_prior_year: participantsVsPriorYear,
    budget_revenue: hasRevenue ? totalBudgetRev : null,
    actual_revenue: hasRevenue ? totalActualRev : null,
    revenue_delta: revenueDelta,
    revenue_pct: revenuePct,
    enrolled_boys: hasGender ? totalBoys : null,
    enrolled_girls: hasGender ? totalGirls : null,
  }
}

/**
 * Build forecast sections from camp and quest session arrays.
 * Only returns sections that have at least one session.
 * Each section includes a precomputed total.
 */
export function buildForecastSections(
  campSessions: SessionForecast[],
  questSessions: SessionForecast[],
  teenSessions: SessionForecast[] = [],
  sectionPriors: Record<string, ForecastPriorTotals> = {}
): ForecastSection[] {
  const sections: ForecastSection[] = []

  if (campSessions.length > 0) {
    sections.push({
      key: 'camp',
      label: 'At Camp',
      sessions: campSessions,
      total: computeSectionTotal(campSessions, 'At Camp', sectionPriors['camp']),
    })
  }

  if (questSessions.length > 0) {
    sections.push({
      key: 'quest',
      label: 'Quests',
      sessions: questSessions,
      total: computeSectionTotal(questSessions, 'Quests', sectionPriors['quest']),
    })
  }

  if (teenSessions.length > 0) {
    sections.push({
      key: 'teen',
      label: 'Teen Programs',
      sessions: teenSessions,
      total: computeSectionTotal(teenSessions, 'Teen Programs', sectionPriors['teen']),
    })
  }

  return sections
}
