/** Types for registration velocity API response */

export interface WeeklyDataPoint {
  week_start: string
  week_label: string
  enrolled: number
  waitlisted: number
  delta: number
  data_source: 'snapshot' | 'reconstructed'
}

export interface VelocityCurve {
  year: number
  session_cm_id: number | null
  session_name: string | null
  weekly: WeeklyDataPoint[]
}

export interface PhaseMarker {
  phase: string
  date: string
  label: string
}

export interface VelocityResponse {
  year: number
  combined: VelocityCurve
  by_session: VelocityCurve[]
  prior_years: VelocityCurve[]
  phase_markers: PhaseMarker[]
}
