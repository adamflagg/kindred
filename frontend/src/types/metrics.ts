/**
 * Types for metrics API responses.
 */

export interface GenderBreakdown {
  gender: string;
  count: number;
  percentage: number;
}

export interface GradeBreakdown {
  grade: number | null;
  count: number;
  percentage: number;
}

export interface SessionBreakdown {
  session_cm_id: number;
  session_name: string;
  count: number;
  capacity: number | null;
  utilization: number | null;
}

export interface YearsAtCampBreakdown {
  years: number;
  count: number;
  percentage: number;
}

export interface SessionLengthBreakdown {
  length_category: string;
  count: number;
  percentage: number;
}

export interface NewVsReturning {
  new_count: number;
  returning_count: number;
  new_percentage: number;
  returning_percentage: number;
}

// New demographic breakdowns (from camper_history)
export interface SchoolBreakdown {
  school: string;
  count: number;
  percentage: number;
}

export interface CityBreakdown {
  city: string;
  count: number;
  percentage: number;
}

export interface SynagogueBreakdown {
  synagogue: string;
  count: number;
  percentage: number;
}

export interface FirstYearBreakdown {
  first_year: number;
  count: number;
  percentage: number;
}

export interface SessionBunkBreakdown {
  session: string;
  bunk: string;
  count: number;
}

// New registration breakdown types for registration tab redesign
export interface GenderByGradeBreakdown {
  grade: number | null;
  male_count: number;
  female_count: number;
  other_count: number;
  total: number;
}

export interface SummerYearsBreakdown {
  summer_years: number;
  count: number;
  percentage: number;
}

export interface FirstSummerYearBreakdown {
  first_summer_year: number;
  count: number;
  percentage: number;
}

// Retention-specific types
export interface RetentionByGender {
  gender: string;
  base_count: number;
  returned_count: number;
  retention_rate: number;
}

export interface RetentionByGrade {
  grade: number | null;
  base_count: number;
  returned_count: number;
  retention_rate: number;
}

export interface RetentionBySession {
  session_cm_id: number;
  session_name: string;
  base_count: number;
  returned_count: number;
  retention_rate: number;
}

export interface RetentionByYearsAtCamp {
  years: number;
  base_count: number;
  returned_count: number;
  retention_rate: number;
}

// New retention breakdown types (from camper_history)
export interface RetentionBySchool {
  school: string;
  base_count: number;
  returned_count: number;
  retention_rate: number;
}

export interface RetentionByCity {
  city: string;
  base_count: number;
  returned_count: number;
  retention_rate: number;
}

export interface RetentionBySynagogue {
  synagogue: string;
  base_count: number;
  returned_count: number;
  retention_rate: number;
}

export interface RetentionByFirstYear {
  first_year: number;
  base_count: number;
  returned_count: number;
  retention_rate: number;
}

export interface RetentionBySessionBunk {
  session: string;
  bunk: string;
  base_count: number;
  returned_count: number;
  retention_rate: number;
}

// New retention breakdown types for retention tab redesign
export interface RetentionBySummerYears {
  summer_years: number;
  base_count: number;
  returned_count: number;
  retention_rate: number;
}

export interface RetentionByFirstSummerYear {
  first_summer_year: number;
  base_count: number;
  returned_count: number;
  retention_rate: number;
}

export interface RetentionByPriorSession {
  prior_session: string;
  base_count: number;
  returned_count: number;
  retention_rate: number;
}

export interface RetentionMetrics {
  base_year: number;
  compare_year: number;
  base_year_total: number;
  compare_year_total: number;
  returned_count: number;
  overall_retention_rate: number;
  by_gender: RetentionByGender[];
  by_grade: RetentionByGrade[];
  by_session: RetentionBySession[];
  by_years_at_camp: RetentionByYearsAtCamp[];
  // Demographic breakdowns (from camper_history)
  by_school?: RetentionBySchool[];
  by_city?: RetentionByCity[];
  by_synagogue?: RetentionBySynagogue[];
  by_first_year?: RetentionByFirstYear[];
  by_session_bunk?: RetentionBySessionBunk[];
  // New breakdowns for retention tab redesign (calculated from attendees)
  by_summer_years?: RetentionBySummerYears[];
  by_first_summer_year?: RetentionByFirstSummerYear[];
  by_prior_session?: RetentionByPriorSession[];
}

export interface RegistrationMetrics {
  year: number;
  total_enrolled: number;
  total_waitlisted: number;
  total_cancelled: number;
  by_gender: GenderBreakdown[];
  by_grade: GradeBreakdown[];
  by_session: SessionBreakdown[];
  by_session_length: SessionLengthBreakdown[];
  by_years_at_camp: YearsAtCampBreakdown[];
  new_vs_returning: NewVsReturning;
  // New demographic breakdowns (from camper_history)
  by_school?: SchoolBreakdown[];
  by_city?: CityBreakdown[];
  by_synagogue?: SynagogueBreakdown[];
  by_first_year?: FirstYearBreakdown[];
  by_session_bunk?: SessionBunkBreakdown[];
  // New breakdowns for registration tab redesign
  by_gender_grade?: GenderByGradeBreakdown[];
  by_summer_years?: SummerYearsBreakdown[];
  by_first_summer_year?: FirstSummerYearBreakdown[];
}

export interface YearSummary {
  year: number;
  total: number;
  by_gender: GenderBreakdown[];
  by_grade: GradeBreakdown[];
}

export interface ComparisonDelta {
  total_change: number;
  percentage_change: number;
}

export interface ComparisonMetrics {
  year_a: YearSummary;
  year_b: YearSummary;
  delta: ComparisonDelta;
}

// Historical trends types
export interface YearMetrics {
  year: number;
  total_enrolled: number;
  by_gender: GenderBreakdown[];
  new_vs_returning: NewVsReturning;
  by_first_year?: FirstYearBreakdown[];
}

export interface HistoricalTrendsResponse {
  years: YearMetrics[];
}

// Enrollment by year (3-year comparison)
export interface GenderEnrollment {
  gender: string;
  count: number;
}

export interface GradeEnrollment {
  grade: number | null;
  count: number;
}

export interface YearEnrollment {
  year: number;
  total: number;
  by_gender: GenderEnrollment[];
  by_grade: GradeEnrollment[];
}

// Retention trends types (3-year view)
export interface RetentionTrendValue {
  from_year: number;
  to_year: number;
  retention_rate: number;
}

export interface RetentionTrendGenderBreakdown {
  gender: string;
  values: RetentionTrendValue[];
}

export interface RetentionTrendGradeBreakdown {
  grade: number | null;
  values: RetentionTrendValue[];
}

export interface RetentionTrendYear {
  from_year: number;
  to_year: number;
  retention_rate: number;
  base_count: number;
  returned_count: number;
  by_gender: RetentionByGender[];
  by_grade: RetentionByGrade[];
}

export interface RetentionTrendsResponse {
  years: RetentionTrendYear[];
  avg_retention_rate: number;
  trend_direction: 'improving' | 'declining' | 'stable';
  by_gender_grouped?: RetentionTrendGenderBreakdown[];
  by_grade_grouped?: RetentionTrendGradeBreakdown[];
  enrollment_by_year?: YearEnrollment[];
}

// Drilldown types (chart click-through)
export interface DrilldownFilter {
  type: 'session' | 'gender' | 'grade' | 'school' | 'years_at_camp' | 'status';
  value: string;
  label: string; // Display label for modal title
}

export interface DrilldownAttendee {
  person_id: number;
  first_name: string;
  last_name: string;
  preferred_name?: string;
  grade?: number;
  gender?: string;
  age?: number;
  school?: string;
  city?: string;
  years_at_camp?: number;
  session_name: string;
  session_cm_id: number;
  status: string;
  is_returning: boolean;
}
