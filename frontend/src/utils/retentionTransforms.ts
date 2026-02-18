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

export type RetentionSortBy = 'rate' | 'count' | 'name' | 'none'

/**
 * Sort and optionally limit retention bar data.
 * - 'rate': descending by retention rate (default)
 * - 'count': descending by base count
 * - 'name': ascending natural/numeric order (1 year < 2 years < 10 years)
 */
export function sortRetentionBarData(
  data: RetentionRateBarItem[],
  sortBy: RetentionSortBy = 'rate',
  topN?: number
): RetentionRateBarItem[] {
  const sorted = [...data]
  switch (sortBy) {
    case 'rate':
      sorted.sort((a, b) => b.retentionRate - a.retentionRate)
      break
    case 'count':
      sorted.sort((a, b) => b.baseCount - a.baseCount)
      break
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      break
    case 'none':
      break // preserve input order
  }
  return topN ? sorted.slice(0, topN) : sorted
}

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
    name: d.grade !== null ? `${d.grade}` : 'Unknown',
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

export interface RetentionOutlier {
  name: string
  retentionRate: number
  baseCount: number
  returnedCount: number
  deviation: number // percentage points above/below overall rate
}

export function computeRetentionOutliers(
  data: RetentionRateBarItem[],
  overallRate: number,
  options?: { minBaseCount?: number; minDeviation?: number }
): RetentionOutlier[] {
  const minBaseCount = options?.minBaseCount ?? 8
  const minDeviation = options?.minDeviation ?? 10

  return data
    .filter((d) => d.baseCount >= minBaseCount)
    .map((d) => {
      const deviation = Math.round(d.retentionRate * 100) - Math.round(overallRate * 100)
      return {
        name: d.name,
        retentionRate: d.retentionRate,
        baseCount: d.baseCount,
        returnedCount: d.returnedCount,
        deviation,
      }
    })
    .filter((d) => Math.abs(d.deviation) >= minDeviation)
    .sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation))
}
