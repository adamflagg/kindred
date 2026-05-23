import type { SessionForecast } from '../types/forecast'

export interface ForecastSection {
  key: 'camp' | 'quest' | 'teen'
  label: string
  sessions: SessionForecast[]
  total: SessionForecast
}

/**
 * Compute a section total across a list of sessions.
 * Mirrors the Python `_compute_grand_total()` logic from forecast_service.py:
 * - enrolled/waitlisted are always summed
 * - nullable fields (goal, prior, revenue) use null-aware aggregation:
 *   return null if ALL sessions have null, otherwise sum treating null as 0
 * - derived fields (percentages, deltas) are computed from the aggregated totals
 */
export function computeSectionTotal(sessions: SessionForecast[], label: string): SessionForecast {
  const totalEnrolled = sessions.reduce((sum, s) => sum + s.enrolled, 0)
  const totalWaitlisted = sessions.reduce((sum, s) => sum + s.waitlisted, 0)

  const totalGoal = sessions.reduce((sum, s) => sum + (s.participant_goal ?? 0), 0)
  const totalPrior = sessions.reduce((sum, s) => sum + (s.prior_year_count ?? 0), 0)
  const totalTwoYear = sessions.reduce((sum, s) => sum + (s.two_year_prior_count ?? 0), 0)

  const hasGoal = sessions.some((s) => s.participant_goal !== null)
  const hasPrior = sessions.some((s) => s.prior_year_count !== null)
  const hasTwoYear = sessions.some((s) => s.two_year_prior_count !== null)

  const totalBudgetRev = sessions.reduce((sum, s) => sum + (s.budget_revenue ?? 0), 0)
  const totalActualRev = sessions.reduce((sum, s) => sum + (s.actual_revenue ?? 0), 0)
  const hasRevenue = sessions.some((s) => s.budget_revenue !== null)

  let pctOfGoal: number | null = null
  if (hasGoal && totalGoal > 0) {
    pctOfGoal = Math.round((totalEnrolled / totalGoal) * 1000) / 10
  }

  const participantsVsBudget = hasGoal ? totalEnrolled - totalGoal : null
  const participantsVsPriorYear = hasPrior ? totalEnrolled - totalPrior : null

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
    waitlisted: totalWaitlisted,
    participant_goal: hasGoal ? totalGoal : null,
    pct_of_goal: pctOfGoal,
    prior_year_count: hasPrior ? totalPrior : null,
    two_year_prior_count: hasTwoYear ? totalTwoYear : null,
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
  teenSessions: SessionForecast[] = []
): ForecastSection[] {
  const sections: ForecastSection[] = []

  if (campSessions.length > 0) {
    sections.push({
      key: 'camp',
      label: 'At Camp',
      sessions: campSessions,
      total: computeSectionTotal(campSessions, 'At Camp'),
    })
  }

  if (questSessions.length > 0) {
    sections.push({
      key: 'quest',
      label: 'Quests',
      sessions: questSessions,
      total: computeSectionTotal(questSessions, 'Quests'),
    })
  }

  if (teenSessions.length > 0) {
    sections.push({
      key: 'teen',
      label: 'Teen Programs',
      sessions: teenSessions,
      total: computeSectionTotal(teenSessions, 'Teen Programs'),
    })
  }

  return sections
}
