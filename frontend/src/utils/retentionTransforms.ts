/**
 * Transform functions converting RetentionBy* types to RetentionRateBarItem arrays
 * for use with the RetentionRateBarChart component.
 */

import type {
  RetentionByGender,
  RetentionByGrade,
  RetentionBySession,
  RetentionByCity,
  RetentionBySchool,
  RetentionBySynagogue,
  RetentionByYearsAtCamp,
  RetentionBySummerYears,
  RetentionByFirstSummerYear,
  RetentionBySessionBunk,
  RetentionByPriorSession,
} from '../types/metrics'
import type { RetentionRateBarItem } from '../components/metrics/RetentionRateBarChart'

export function genderToBarData(data: RetentionByGender[] | undefined): RetentionRateBarItem[] {
  if (!data?.length) return []
  return data.map((d) => ({
    name: d.gender,
    retentionRate: d.retention_rate,
    baseCount: d.base_count,
    returnedCount: d.returned_count,
  }))
}

export function gradeToBarData(data: RetentionByGrade[] | undefined): RetentionRateBarItem[] {
  if (!data?.length) return []
  return data.map((d) => ({
    name: d.grade !== null ? `Grade ${d.grade}` : 'Unknown',
    retentionRate: d.retention_rate,
    baseCount: d.base_count,
    returnedCount: d.returned_count,
  }))
}

export function sessionToBarData(data: RetentionBySession[] | undefined): RetentionRateBarItem[] {
  if (!data?.length) return []
  return data.map((d) => ({
    name: d.session_name,
    retentionRate: d.retention_rate,
    baseCount: d.base_count,
    returnedCount: d.returned_count,
  }))
}

export function cityToBarData(data: RetentionByCity[] | undefined): RetentionRateBarItem[] {
  if (!data?.length) return []
  return data.map((d) => ({
    name: d.city,
    retentionRate: d.retention_rate,
    baseCount: d.base_count,
    returnedCount: d.returned_count,
  }))
}

export function schoolToBarData(data: RetentionBySchool[] | undefined): RetentionRateBarItem[] {
  if (!data?.length) return []
  return data.map((d) => ({
    name: d.school,
    retentionRate: d.retention_rate,
    baseCount: d.base_count,
    returnedCount: d.returned_count,
  }))
}

export function synagogueToBarData(
  data: RetentionBySynagogue[] | undefined
): RetentionRateBarItem[] {
  if (!data?.length) return []
  return data.map((d) => ({
    name: d.synagogue,
    retentionRate: d.retention_rate,
    baseCount: d.base_count,
    returnedCount: d.returned_count,
  }))
}

export function yearsAtCampToBarData(
  data: RetentionByYearsAtCamp[] | undefined
): RetentionRateBarItem[] {
  if (!data?.length) return []
  return data.map((d) => ({
    name: d.years === 1 ? '1 year' : `${d.years} years`,
    retentionRate: d.retention_rate,
    baseCount: d.base_count,
    returnedCount: d.returned_count,
  }))
}

export function summerYearsToBarData(
  data: RetentionBySummerYears[] | undefined
): RetentionRateBarItem[] {
  if (!data?.length) return []
  return data.map((d) => ({
    name: d.summer_years === 1 ? '1 summer' : `${d.summer_years} summers`,
    retentionRate: d.retention_rate,
    baseCount: d.base_count,
    returnedCount: d.returned_count,
  }))
}

export function firstSummerYearToBarData(
  data: RetentionByFirstSummerYear[] | undefined
): RetentionRateBarItem[] {
  if (!data?.length) return []
  return data.map((d) => ({
    name: d.first_summer_year.toString(),
    retentionRate: d.retention_rate,
    baseCount: d.base_count,
    returnedCount: d.returned_count,
  }))
}

export function sessionBunkToBarData(
  data: RetentionBySessionBunk[] | undefined
): RetentionRateBarItem[] {
  if (!data?.length) return []
  return data.map((d) => ({
    name: `${d.session} / ${d.bunk}`,
    retentionRate: d.retention_rate,
    baseCount: d.base_count,
    returnedCount: d.returned_count,
  }))
}

export function priorSessionToBarData(
  data: RetentionByPriorSession[] | undefined
): RetentionRateBarItem[] {
  if (!data?.length) return []
  return data.map((d) => ({
    name: d.prior_session,
    retentionRate: d.retention_rate,
    baseCount: d.base_count,
    returnedCount: d.returned_count,
  }))
}
