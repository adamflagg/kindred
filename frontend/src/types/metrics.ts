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
