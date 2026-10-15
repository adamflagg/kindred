/** Per-session forecast data with budget goals and revenue. */
export interface SessionForecast {
  session_cm_id: number
  session_name: string
  session_type: string
  participant_goal: number | null
  session_fee: number | null
  enrolled: number
  /** null in week mode: a past waitlist cannot be rebuilt. */
  waitlisted: number | null
  pct_of_goal: number | null
  prior_year_count: number | null
  two_year_prior_count: number | null
  participants_vs_budget: number | null
  participants_vs_prior_year: number | null
  budget_revenue: number | null
  actual_revenue: number | null
  revenue_delta: number | null
  revenue_pct: number | null
  enrolled_boys: number | null
  enrolled_girls: number | null
}

/** Whole-scope prior totals for a section (camp / quest / teen). */
export interface ForecastPriorTotals {
  prior_year_count: number | null
  two_year_prior_count: number | null
}

/** Full forecast response with per-session data and grand total. */
export interface ForecastResponse {
  year: number
  sessions: SessionForecast[]
  grand_total: SessionForecast
  week_number: number | null
  day_offset: number | null
  /** Whether the prior columns are same-point-last-year or last year's final. */
  prior_basis: 'same_point' | 'final'
  /** Keys: camp, quest, teen. */
  section_priors: Record<string, ForecastPriorTotals>
}

/** A selectable week in the forecast dropdown. */
export interface WeekOption {
  week_number: number
  day_offset: number
  label: string
  is_today: boolean
}
