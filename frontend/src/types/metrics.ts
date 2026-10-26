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
  /** Session type; teen programs (scit/tli) are compared by type in Session Details. */
  session_type?: string | null
  count: number
  capacity: number | null
  utilization: number | null
}

export interface YearsAtCampBreakdown {
  years: number
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
/** Gender identity label (the API's raw label, #2898) → campers. */
export type GenderCounts = Record<string, number>

export interface GenderByGradeBreakdown {
  grade: number | null
  by_gender: GenderCounts
  total: number
}

export interface GenderBySessionLengthBreakdown {
  length_category: string
  by_gender: GenderCounts
  total: number
}

export interface SummerYearsBreakdown {
  summer_years: number
  count: number
  percentage: number
}

/** Campers in one age band: season year minus birth year (D-UNCOVERED). `band` is the drill-down key. */
export interface AgeBandBreakdown {
  band: string
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
  /** How many of gender_fallback_count returned (#82's Read with care line). */
  gender_fallback_returned_count?: number
  /** Campers in the gender split with no identity answer, counted by the Gender field (ruling 58). */
  gender_fallback_count?: number
  base_year: number
  compare_year: number
  base_year_total: number
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
  /**
   * Asked with same_point_of (#3207 PR 11): which way the compare year was read. 'unavailable' means its
   * registration dates could not be read: the figures are not a comparison and must not be shown as one.
   */
  prior_basis?: 'same_point' | 'final' | 'unavailable' | null
  /** Set with prior_basis 'unavailable': why. */
  prior_unavailable_reason?: 'registration_dates_unreadable' | null
  day_offset?: number | null
  prior_day_offset?: number | null
  as_of_date?: string | null
}

export interface RegistrationMetrics {
  /** Campers in the gender split with no identity answer, counted by the Gender field (ruling 58). */
  gender_fallback_count?: number
  year: number
  total_enrolled: number
  /** null on a same-point read: a past waitlist cannot be rebuilt. */
  total_waitlisted: number | null
  total_cancelled: number
  by_gender: GenderBreakdown[]
  by_grade: GradeBreakdown[]
  by_session: SessionBreakdown[]
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
  /** Mean CampMinder Years At Camp of the charted campers; null when there are none. */
  average_summers_at_camp?: number | null
  by_first_summer_year?: FirstSummerYearBreakdown[]
  // A comparison year read with same_point_of (decision 7)
  /** 'same_point' while the primary season is live, 'final' after; absent on a plain read. */
  prior_basis?: 'same_point' | 'final' | null
  /** The primary season's registration day (days from its anchor). */
  day_offset?: number | null
  /** The day this year was read at: day_offset + 1 on an opening day (decision 45). */
  prior_day_offset?: number | null
  /** The last day (YYYY-MM-DD) this year was read through. */
  as_of_date?: string | null
  /** Every age band in order ("5-7" … "17+", then "none"), zeros included. */
  by_age?: AgeBandBreakdown[]
}

// Historical trends types
export interface YearMetrics {
  /** Campers in the gender split with no identity answer, counted by the Gender field (ruling 58). */
  gender_fallback_count?: number
  year: number
  total_enrolled: number
  by_gender: GenderBreakdown[]
  new_vs_returning: NewVsReturning
  total_cancelled?: number
  /** null when nobody was enrolled that year (camp did not run): there is no rate to show. */
  cancellation_rate?: number | null
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
  /** Campers in the gender split with no identity answer, counted by the Gender field (ruling 58). */
  gender_fallback_count?: number
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
export interface RetentionTrendYear {
  /** Campers in the gender split with no identity answer, counted by the Gender field (ruling 58). */
  gender_fallback_count?: number
  from_year: number
  to_year: number
  /** Null when it can't be worked out (PM-4): no base, or a past season nobody attended (2020). */
  retention_rate: number | null
  base_count: number
  returned_count: number
  by_gender: RetentionByGender[]
  by_grade: RetentionByGrade[]
  aged_out_count?: number
  /** While the newest season is live (ruling #89): this transition at the same registration day. */
  same_point_rate?: number | null
  same_point_as_of?: string | null
}

export interface RetentionTrendsResponse {
  years: RetentionTrendYear[]
  prior_basis?: 'same_point' | 'final' | null
  day_offset?: number | null
  prior_day_offset?: number | null
  as_of_date?: string | null
  enrollment_by_year?: YearEnrollment[]
}

// Retention bar chart item (used by CSS and line chart retention components)
export interface RetentionRateBarItem {
  name: string
  retentionRate: number // 0-1
  baseCount: number
  returnedCount: number
  id?: string | number // Optional identifier for drilldown (e.g., session_cm_id, grade number)
  /** Last year's rate for the same row (#3207 PR 11): same point while live, final after. */
  priorRate?: number | null
}

// Drilldown types (chart click-through)
export interface DrilldownSession {
  session_name: string
  session_cm_id: number
  /** This enrollment's Registered day (effective_date), for one row per enrollment. */
  effective_date?: string | null
  /** This enrollment's current-status instant: Enrolled on, Cancelled or Applied. */
  enrollment_date?: string | null
}

export interface DrilldownFilter {
  type:
    | 'session'
    | 'gender'
    | 'grade'
    | 'age_band'
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
  /** Open at Rows: Enrollments, newest first (Analytics › Today's "View all", #3207 PR 8). */
  initialRows?: 'enrollments'
  /** Keep only enrollments whose Enrolled on camp day is this YYYY-MM-DD or later (Today's 7-day window). */
  enrolledSince?: string
}

export interface DrilldownAttendee {
  person_id: number
  first_name: string
  last_name: string
  preferred_name?: string
  grade?: number
  /** Gender identity label (#2898), as every Analytics split counts it. */
  gender?: string
  /** The binary Gender field (F / M / Other): the CSV's Gender field column (#80). */
  gender_field?: string | null
  /** Gender read from the Gender field: no identity answer (ruling 58). The modal marks it. */
  gender_counted_by_field?: boolean
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
  /** CSV only (decision 13): the primary childhood household's billing postal code. */
  zip?: string | null
  /** CSV only (decision 44): caregiver names in the household's mailing-title order. */
  caregivers?: string[]
  /** The primary childhood household's CampMinder id: what the list groups by, and the CSV's Household ID (PR 6b). */
  household_cm_id?: number | null
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
  /** Campers in the gender split with no identity answer, counted by the Gender field (ruling 58). */
  gender_fallback_count?: number
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
  /** Campers in the gender split with no identity answer, counted by the Gender field (ruling 58). */
  gender_fallback_count?: number
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
