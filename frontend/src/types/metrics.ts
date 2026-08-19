/**
 * Types for metrics API responses.
 */

export interface GenderBreakdown {
  gender: string
  count: number
  percentage: number
  no_enrollment?: number
  has_enrollment?: number
  was_enrolled?: number
  was_waitlisted?: number
  was_applied?: number
  other_prior_status?: number
}

export interface GradeBreakdown {
  grade: number | null
  count: number
  percentage: number
  no_enrollment?: number
  has_enrollment?: number
  was_enrolled?: number
  was_waitlisted?: number
  was_applied?: number
  other_prior_status?: number
}

export interface SessionBreakdown {
  session_cm_id: number
  session_name: string
  count: number
  capacity: number | null
  utilization: number | null
}

export interface YearsAtCampBreakdown {
  years: number
  count: number
  percentage: number
}

export interface SessionLengthBreakdown {
  length_category: string
  count: number
  percentage: number
}

export interface SessionInLengthCategory {
  session_name: string
  session_cm_id: number
  count: number
}

export interface SessionLengthBySessionBreakdown {
  length_category: string
  sessions: SessionInLengthCategory[]
  total: number
}

export interface NewVsReturning {
  new_count: number
  returning_count: number
  new_percentage: number
  returning_percentage: number
}

export interface SchoolBreakdown {
  school: string
  count: number
  percentage: number
}

export interface CityBreakdown {
  city: string
  count: number
  percentage: number
}

export interface SynagogueBreakdown {
  synagogue: string
  count: number
  percentage: number
}

// New registration breakdown types for registration tab redesign
export interface GenderByGradeBreakdown {
  grade: number | null
  male_count: number
  female_count: number
  total: number
}

export interface GenderBySessionLengthBreakdown {
  length_category: string
  male_count: number
  female_count: number
  total: number
}

export interface SummerYearsBreakdown {
  summer_years: number
  count: number
  percentage: number
}

export interface FirstSummerYearBreakdown {
  first_summer_year: number
  count: number
  percentage: number
}

// Retention-specific types
export interface RetentionByGender {
  gender: string
  base_count: number
  returned_count: number
  retention_rate: number
}

export interface RetentionByGrade {
  grade: number | null
  base_count: number
  returned_count: number
  retention_rate: number
}

export interface RetentionBySession {
  session_cm_id: number
  session_name: string
  base_count: number
  returned_count: number
  retention_rate: number
}

export interface RetentionByYearsAtCamp {
  years: number
  base_count: number
  returned_count: number
  retention_rate: number
}

export interface RetentionBySchool {
  school: string
  base_count: number
  returned_count: number
  retention_rate: number
}

export interface RetentionByCity {
  city: string
  base_count: number
  returned_count: number
  retention_rate: number
}

export interface RetentionBySynagogue {
  synagogue: string
  base_count: number
  returned_count: number
  retention_rate: number
}

export interface RetentionBySessionBunk {
  session: string
  bunk: string
  base_count: number
  returned_count: number
  retention_rate: number
}

// New retention breakdown types for retention tab redesign
export interface RetentionBySummerYears {
  summer_years: number
  base_count: number
  returned_count: number
  retention_rate: number
}

export interface RetentionByFirstSummerYear {
  first_summer_year: number
  base_count: number
  returned_count: number
  retention_rate: number
}

export interface RetentionByPriorSession {
  prior_session: string
  start_date?: string | null
  base_count: number
  returned_count: number
  retention_rate: number
}

export interface SessionFlowItem {
  source: string
  target: string
  value: number
  source_cm_id: number
  target_cm_id: number | null
}

export interface RetentionMetrics {
  base_year: number
  compare_year: number
  base_year_total: number
  compare_year_total: number
  returned_count: number
  overall_retention_rate: number
  by_gender: RetentionByGender[]
  by_grade: RetentionByGrade[]
  by_session: RetentionBySession[]
  by_years_at_camp: RetentionByYearsAtCamp[]
  // Demographic breakdowns
  by_school?: RetentionBySchool[]
  by_city?: RetentionByCity[]
  by_synagogue?: RetentionBySynagogue[]
  by_session_bunk?: RetentionBySessionBunk[]
  // New breakdowns for retention tab redesign (calculated from attendees)
  by_summer_years?: RetentionBySummerYears[]
  by_first_summer_year?: RetentionByFirstSummerYear[]
  by_prior_session?: RetentionByPriorSession[]
  session_flow?: SessionFlowItem[]
  aged_out_count?: number
}

export interface RegistrationMetrics {
  year: number
  total_enrolled: number
  total_waitlisted: number
  total_cancelled: number
  by_gender: GenderBreakdown[]
  by_grade: GradeBreakdown[]
  by_session: SessionBreakdown[]
  by_session_length: SessionLengthBreakdown[]
  by_years_at_camp: YearsAtCampBreakdown[]
  new_vs_returning: NewVsReturning
  // Demographic breakdowns
  by_school?: SchoolBreakdown[]
  by_city?: CityBreakdown[]
  by_synagogue?: SynagogueBreakdown[]
  // New breakdowns for registration tab redesign
  by_gender_grade?: GenderByGradeBreakdown[]
  by_session_length_by_session?: SessionLengthBySessionBreakdown[]
  by_gender_by_session_length?: GenderBySessionLengthBreakdown[]
  by_summer_years?: SummerYearsBreakdown[]
  by_first_summer_year?: FirstSummerYearBreakdown[]
}

export interface YearSummary {
  year: number
  total: number
  by_gender: GenderBreakdown[]
  by_grade: GradeBreakdown[]
}

export interface ComparisonDelta {
  total_change: number
  percentage_change: number
}

export interface ComparisonMetrics {
  year_a: YearSummary
  year_b: YearSummary
  delta: ComparisonDelta
}

// Historical trends types
export interface YearMetrics {
  year: number
  total_enrolled: number
  by_gender: GenderBreakdown[]
  new_vs_returning: NewVsReturning
  total_cancelled?: number
  cancellation_rate?: number
  /**
   * Whether attendee_status_history holds any rows for this year at all.
   * When false, total_cancelled/cancellation_rate were never measured (not
   * a measured zero) -- render "no data", not 0 / 0.0%. Defaults to true
   * for backward compatibility with callers built before this field existed.
   */
  has_cancellation_data?: boolean
}

export interface HistoricalTrendsResponse {
  years: YearMetrics[]
}

// Enrollment by year (3-year comparison)
export interface GenderEnrollment {
  gender: string
  count: number
}

export interface GradeEnrollment {
  grade: number | null
  count: number
}

export interface SummerYearsEnrollment {
  summer_years: number
  count: number
}

export interface FirstSummerYearEnrollment {
  first_summer_year: number
  count: number
}

export interface CityEnrollment {
  city: string
  count: number
}

export interface SchoolEnrollment {
  school: string
  count: number
}

export interface SynagogueEnrollment {
  synagogue: string
  count: number
}

export interface RegionEnrollment {
  region: string
  count: number
}

export interface YearEnrollment {
  year: number
  total: number
  by_gender: GenderEnrollment[]
  by_grade: GradeEnrollment[]
  by_summer_years?: SummerYearsEnrollment[]
  by_first_summer_year?: FirstSummerYearEnrollment[]
  by_city?: CityEnrollment[]
  by_school?: SchoolEnrollment[]
  by_synagogue?: SynagogueEnrollment[]
  by_region?: RegionEnrollment[]
}

// Retention trends types (3-year view)
export interface RetentionTrendValue {
  from_year: number
  to_year: number
  retention_rate: number
}

export interface RetentionTrendGenderBreakdown {
  gender: string
  values: RetentionTrendValue[]
}

export interface RetentionTrendGradeBreakdown {
  grade: number | null
  values: RetentionTrendValue[]
}

export interface RetentionTrendYear {
  from_year: number
  to_year: number
  retention_rate: number
  base_count: number
  returned_count: number
  by_gender: RetentionByGender[]
  by_grade: RetentionByGrade[]
  aged_out_count?: number
}

export interface RetentionTrendsResponse {
  years: RetentionTrendYear[]
  avg_retention_rate: number
  trend_direction: 'improving' | 'declining' | 'stable'
  by_gender_grouped?: RetentionTrendGenderBreakdown[]
  by_grade_grouped?: RetentionTrendGradeBreakdown[]
  enrollment_by_year?: YearEnrollment[]
}

// Retention bar chart item (used by CSS and line chart retention components)
export interface RetentionRateBarItem {
  name: string
  retentionRate: number // 0-1
  baseCount: number
  returnedCount: number
  id?: string | number // Optional identifier for drilldown (e.g., session_cm_id, grade number)
}

// Drilldown types (chart click-through)
export interface DrilldownSession {
  session_name: string
  session_cm_id: number
}

export interface DrilldownFilter {
  type:
    | 'session'
    | 'gender'
    | 'grade'
    | 'school'
    | 'city'
    | 'synagogue'
    | 'years_at_camp'
    | 'summer_years'
    | 'status'
    | 'returning_status'
    | 'session_length'
    | 'first_summer_year'
    | 'retention_session'
    | 'retention_all'
    | 'retention_returned'
    | 'retention_not_returned'
    | 'waitlist_no_enrollment'
    | 'waitlist_has_enrollment'
    | 'waitlist_accepted'
    | 'waitlist_declined'
    | 'waitlist_total'
    | 'cancellation_total'
    | 'cancellation_was_enrolled'
    | 'cancellation_was_waitlisted'
    | 'cancellation_has_other_sessions'
    | 'cancellation_no_other_sessions'
    | 'cancellation_re_enrolled'
    | 'waitlist_session_gender'
    | 'waitlist_teen_program'
  value: string
  label: string // Display label for modal title
  /** Title format: 'in' → "X campers in Label", 'adjective' → "X Label Camper(s)" */
  titleFormat?: 'in' | 'adjective'
  /** Override status filter (for status cards like Waitlisted, Cancelled) */
  statusOverride?: string[]
  /** When true, drilldown from waitlist tab shows waitlist columns (Waitlisted For, Enrolled In) */
  waitlistContext?: boolean
  /** Retention context: base year and compare year for retention drilldowns */
  retentionContext?: { baseYear: number; compareYear: number }
}

export interface DrilldownAttendee {
  person_id: number
  first_name: string
  last_name: string
  preferred_name?: string
  grade?: number
  gender?: string
  age?: number
  school?: string
  city?: string
  state?: string
  years_at_camp?: number
  enrollment_date?: string
  effective_date?: string
  session_name: string
  session_cm_id: number
  status: string
  is_returning: boolean
  sessions?: DrilldownSession[]
  enrolled_sessions?: DrilldownSession[]
}

// Waitlist analysis types
export interface WaitlistEnrolledSessionCount {
  session_cm_id: number
  session_name: string
  count: number
}

export interface WaitlistSessionBreakdown {
  session_cm_id: number
  session_name: string
  waitlisted: number
  no_enrollment: number
  has_enrollment: number
  accepted: number
  declined: number
  enrolled_in: WaitlistEnrolledSessionCount[]
}

export interface WaitlistMetrics {
  year: number
  total_waitlisted: number
  waitlisted_no_enrollment: number
  waitlisted_has_enrollment: number
  total_accepted: number
  total_declined: number
  avg_days_to_acceptance?: number | null
  median_days_to_acceptance?: number | null
  avg_days_to_decline?: number | null
  median_days_to_decline?: number | null
  by_session: WaitlistSessionBreakdown[]
  by_grade: GradeBreakdown[]
  by_gender: GenderBreakdown[]
}

// Cancellation analysis types
export interface TimeBucket {
  label: string
  count: number
  percentage: number
}

export interface RegistrationMonthBreakdown {
  month: string
  count: number
  percentage: number
}

export interface CancellationSessionBreakdown {
  session_cm_id: number
  session_name: string
  total_cancelled: number
  was_enrolled: number
  was_waitlisted: number
  was_applied?: number
  other_prior_status?: number
  has_other_sessions: number
  no_other_sessions: number
  session_swap_count?: number
}

export interface CancellationMetrics {
  year: number
  total_cancelled: number
  was_enrolled: number
  was_waitlisted: number
  was_applied: number
  other_prior_status: number
  has_other_sessions: number
  no_other_sessions: number
  total_re_enrolled: number
  session_swap_count?: number
  true_departure_count?: number
  avg_days_to_cancellation?: number | null
  median_days_to_cancellation?: number | null
  time_to_cancellation_buckets?: TimeBucket[]
  by_registration_month?: RegistrationMonthBreakdown[]
  by_session: CancellationSessionBreakdown[]
  by_grade: GradeBreakdown[]
  by_gender: GenderBreakdown[]
}
