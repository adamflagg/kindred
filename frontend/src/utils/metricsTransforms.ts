/**
 * Metrics data transform utilities.
 *
 * Extracted from RetentionTab.tsx and RegistrationTab.tsx to enable
 * testing and reduce component complexity.
 */

import type {
  FirstSummerYearBreakdown,
  GenderBreakdown,
  GradeBreakdown,
  NewVsReturning,
  SessionBreakdown,
  SessionLengthBreakdown,
  SummerYearsBreakdown,
} from '../types/metrics'
import { getSessionChartLabel } from './sessionDisplay'
import {
  sortSessionDataByDate,
  sortSessionDataByCampThenQuest,
  sortPriorSessionDataByDate,
  type SessionDateLookup,
  type SessionTypeLookup,
} from './sessionUtils'

// ============================================================================
// Common types
// ============================================================================

export interface ChartDataPoint {
  name: string
  value: number
  percentage: number
  [key: string]: string | number | undefined
}

export interface DemographicTableRow {
  name: string
  base_count: number
  returned_count: number
  retention_rate: number
}

export interface TrendDisplay {
  label: string
  colorClass: string
}

// ============================================================================
// Registration transforms (types from types/metrics.ts)
// ============================================================================

export function transformGenderData(data: GenderBreakdown[] | undefined): ChartDataPoint[] {
  if (!data?.length) return []
  return data.map((g) => ({
    name: g.gender || 'Unknown',
    value: g.count,
    percentage: g.percentage,
  }))
}

export function transformGradeData(data: GradeBreakdown[] | undefined): ChartDataPoint[] {
  if (!data?.length) return []
  return data.map((g) => ({
    name: g.grade !== null ? `Grade ${g.grade}` : 'Unknown',
    value: g.count,
    percentage: g.percentage,
    id: g.grade !== null ? g.grade : 'null',
  }))
}

export function transformSessionData(
  data: SessionBreakdown[] | undefined,
  sessionDateLookup: SessionDateLookup,
  sessionTypeLookup?: SessionTypeLookup
): ChartDataPoint[] {
  if (!data?.length) return []
  const sorted = sessionTypeLookup
    ? sortSessionDataByCampThenQuest(data, sessionDateLookup, sessionTypeLookup)
    : sortSessionDataByDate(data, sessionDateLookup)
  return sorted.map((s) => ({
    name: getSessionChartLabel(s.session_name, undefined, sessionDateLookup),
    value: s.count,
    percentage: s.utilization ?? 0,
    id: String(s.session_cm_id),
  }))
}

export function transformSessionLengthData(
  data: SessionLengthBreakdown[] | undefined
): ChartDataPoint[] {
  if (!data?.length) return []
  return data.map((s) => ({
    name: s.length_category,
    value: s.count,
    percentage: s.percentage,
  }))
}

export function transformSummerYearsData(
  data: SummerYearsBreakdown[] | undefined
): ChartDataPoint[] {
  if (!data?.length) return []
  return data.map((y) => ({
    name: y.summer_years === 1 ? '1 summer' : `${y.summer_years} summers`,
    value: y.count,
    percentage: y.percentage,
    id: y.summer_years,
  }))
}

export function transformFirstSummerYearData(
  data: FirstSummerYearBreakdown[] | undefined
): ChartDataPoint[] {
  if (!data?.length) return []
  return data.map((y) => ({
    name: y.first_summer_year.toString(),
    value: y.count,
    percentage: y.percentage,
  }))
}

export function transformNewVsReturningData(data: NewVsReturning | undefined): ChartDataPoint[] {
  if (!data) return []
  return [
    {
      name: 'New Campers',
      value: data.new_count,
      percentage: data.new_percentage,
    },
    {
      name: 'Returning',
      value: data.returning_count,
      percentage: data.returning_percentage,
    },
  ]
}

// ============================================================================
// Retention transforms
// ============================================================================

export interface RetentionSessionBreakdown {
  session_name: string
  base_count: number
  returned_count: number
  retention_rate: number
}

export function transformRetentionSessionData(
  data: RetentionSessionBreakdown[] | undefined,
  sessionDateLookup: SessionDateLookup
): ChartDataPoint[] {
  if (!data?.length) return []
  const sorted = sortSessionDataByDate(data, sessionDateLookup)
  return sorted.map((s) => ({
    name: getSessionChartLabel(s.session_name, undefined, sessionDateLookup),
    value: s.returned_count,
    percentage: s.retention_rate * 100,
  }))
}

export interface RetentionSummerYearsBreakdown {
  summer_years: number
  base_count: number
  returned_count: number
  retention_rate: number
}

export function transformRetentionSummerYearsData(
  data: RetentionSummerYearsBreakdown[] | undefined
): ChartDataPoint[] {
  if (!data?.length) return []
  return data.map((y) => ({
    name: y.summer_years === 1 ? '1 summer' : `${y.summer_years} summers`,
    value: y.returned_count,
    percentage: y.retention_rate * 100,
  }))
}

export interface RetentionFirstSummerYearBreakdown {
  first_summer_year: number
  base_count: number
  returned_count: number
  retention_rate: number
}

export function transformRetentionFirstSummerYearData(
  data: RetentionFirstSummerYearBreakdown[] | undefined
): ChartDataPoint[] {
  if (!data?.length) return []
  return data.map((y) => ({
    name: y.first_summer_year.toString(),
    value: y.returned_count,
    percentage: y.retention_rate * 100,
  }))
}

export interface PriorSessionBreakdown {
  prior_session: string
  base_count: number
  returned_count: number
  retention_rate: number
}

export function transformPriorSessionData(
  data: PriorSessionBreakdown[] | undefined,
  sessionDateLookup: SessionDateLookup
): ChartDataPoint[] {
  if (!data?.length) return []
  const sorted = sortPriorSessionDataByDate(data, sessionDateLookup)
  return sorted.map((s) => ({
    name: getSessionChartLabel(s.prior_session, undefined, sessionDateLookup),
    value: s.returned_count,
    percentage: s.retention_rate * 100,
  }))
}

export interface DemographicBreakdown {
  school?: string
  city?: string
  synagogue?: string
  base_count: number
  returned_count: number
  retention_rate: number
}

export function transformDemographicTableData(
  data: DemographicBreakdown[] | undefined,
  field: 'school' | 'city' | 'synagogue'
): DemographicTableRow[] {
  if (!data?.length) return []
  return data.map((item) => ({
    name: (item[field] as string) || '',
    base_count: item.base_count,
    returned_count: item.returned_count,
    retention_rate: item.retention_rate,
  }))
}

// ============================================================================
// Trend utilities
// ============================================================================

export type TrendDirection = 'improving' | 'declining' | 'stable'

export function getTrendDirection(direction: TrendDirection): TrendDisplay {
  switch (direction) {
    case 'improving':
      return { label: 'Improving', colorClass: 'text-emerald-500' }
    case 'declining':
      return { label: 'Declining', colorClass: 'text-red-500' }
    default:
      return { label: 'Stable', colorClass: 'text-muted-foreground' }
  }
}
