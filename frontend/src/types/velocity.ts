/** Types for registration velocity API response */

export interface DailyDataPoint {
  date: string
  day_offset: number
  gross_enrolled: number
  enrolled: number
  cancelled: number
  daily_new: number
  daily_cancelled: number
  daily_new_boys: number | null
  daily_new_girls: number | null
  daily_cancelled_boys: number | null
  daily_cancelled_girls: number | null
  gross_enrolled_boys: number | null
  gross_enrolled_girls: number | null
  enrolled_boys: number | null
  enrolled_girls: number | null
  data_source: 'snapshot' | 'reconstructed' | 'mixed'
}

export interface WeeklyDataPoint {
  week_start: string
  week_end: string
  week_label: string
  week_number: number
  enrolled: number
  delta: number
  data_source: 'snapshot' | 'reconstructed' | 'mixed'
  gross_enrolled: number
  weekly_new: number
  weekly_cancelled: number
  is_partial: boolean
  days_in_week: number
  enrolled_boys: number | null
  enrolled_girls: number | null
  gross_enrolled_boys: number | null
  gross_enrolled_girls: number | null
  weekly_new_boys: number | null
  weekly_new_girls: number | null
  weekly_cancelled_boys: number | null
  weekly_cancelled_girls: number | null
}

export interface VelocityCurve {
  year: number
  session_cm_id: number | null
  session_name: string | null
  gender: string | null
  daily: DailyDataPoint[]
  weekly: WeeklyDataPoint[]
}

export interface PhaseMarker {
  phase: string
  date: string
  label: string
  week_number: number
}

export interface SessionGenderBreakdown {
  session_cm_id: number
  session_name: string | null
  boys_enrolled: number
  girls_enrolled: number
}

export interface PriorYearCancelledSummary {
  year: number
  cancelled_at_current_week: number | null
  cancelled_final: number
}

export interface PriorYearSessionSummary {
  year: number
  session_name: string | null
  session_cm_id: number | null
  enrolled_at_current_week: number | null
  final_enrolled: number
}

export interface PriorYearVelocity {
  year: number
  daily: DailyDataPoint[]
  weekly: WeeklyDataPoint[]
}

export interface VelocityResponse {
  year: number
  season_start: string
  combined: VelocityCurve
  by_session: VelocityCurve[]
  by_gender: VelocityCurve[]
  prior_years: PriorYearVelocity[]
  prior_year_by_gender: VelocityCurve[]
  phase_markers: PhaseMarker[]
  session_gender_breakdown: SessionGenderBreakdown[]
  cancelled_to_date: number | null
  prior_year_cancelled_to_date: PriorYearCancelledSummary[]
  prior_year_session_summaries: PriorYearSessionSummary[]
  prior_year_season_starts: Record<number, string>
  daily: DailyDataPoint[]
  weekly: WeeklyDataPoint[]
  session_swap_count?: number
  warnings: string[]
}
