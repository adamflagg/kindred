/** Types for registration velocity API response */

export interface WeeklyDataPoint {
  week_start: string
  week_label: string
  enrolled: number
  waitlisted: number
  delta: number
  data_source: 'snapshot' | 'reconstructed'
  week_number: number
}

export interface VelocityCurve {
  year: number
  session_cm_id: number | null
  session_name: string | null
  gender: string | null
  weekly: WeeklyDataPoint[]
}

export interface PhaseMarker {
  phase: string
  date: string
  label: string
}

export interface SessionGenderBreakdown {
  session_cm_id: number
  session_name: string | null
  boys_enrolled: number
  girls_enrolled: number
}

export interface VelocityResponse {
  year: number
  season_start: string
  combined: VelocityCurve
  by_session: VelocityCurve[]
  by_gender: VelocityCurve[]
  prior_years: VelocityCurve[]
  prior_year_by_gender: VelocityCurve[]
  phase_markers: PhaseMarker[]
  session_gender_breakdown: SessionGenderBreakdown[]
}
