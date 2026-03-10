/** Per-session forecast data with budget goals and revenue. */
export interface SessionForecast {
  session_cm_id: number
  session_name: string
  session_type: string
  participant_goal: number | null
  session_fee: number | null
  enrolled: number
  waitlisted: number
  pct_of_goal: number | null
  prior_year_count: number | null
  two_year_prior_count: number | null
  participants_vs_budget: number | null
  participants_vs_prior_year: number | null
  budget_revenue: number | null
  actual_revenue: number | null
  revenue_delta: number | null
  revenue_pct: number | null
}

/** Full forecast response with per-session data and grand total. */
export interface ForecastResponse {
  year: number
  sessions: SessionForecast[]
  grand_total: SessionForecast
  snapshot_date?: string | null
}
