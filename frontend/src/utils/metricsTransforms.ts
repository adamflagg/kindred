/**
 * Metrics data transform utilities.
 *
 * Extracted from RetentionTab.tsx and RegistrationTab.tsx to enable
 * testing and reduce component complexity.
 */

import type {
  AgeBandBreakdown,
  FirstSummerYearBreakdown,
  GenderBreakdown,
  GradeBreakdown,
  NewVsReturning,
  SessionBreakdown,
  SummerYearsBreakdown,
} from '../types/metrics'
import { sessionName } from './sessionName'
import { rollUpTliSessions } from './tliRollup'
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

const GENDER_LABEL_MAP: Record<string, string> = {
  M: 'Male',
  F: 'Female',
}

export function transformGenderData(data: GenderBreakdown[] | undefined): ChartDataPoint[] {
  if (!data?.length) return []
  return data.map((g) => ({
    name: GENDER_LABEL_MAP[g.gender] ?? (g.gender || 'Unknown'),
    value: g.count,
    percentage: g.percentage,
    id: g.gender,
  }))
}

export function transformGradeData(data: GradeBreakdown[] | undefined): ChartDataPoint[] {
  if (!data?.length) return []
  return data.map((g) => ({
    name: g.grade !== null ? `Grade ${g.grade}` : 'Unknown',
    value: g.count,
    percentage: g.percentage,
    id: g.grade ?? 'null',
  }))
}

/** An age band's chart label: en dashes for ranges, "None" for no birthdate. */
export function ageBandLabel(band: string): string {
  return band === 'none' ? 'None' : band.replace('-', '–')
}

/** Age bars in the server's order; empty when no camper is counted, so the chart says so. */
export function transformAgeData(data: AgeBandBreakdown[] | undefined): ChartDataPoint[] {
  if (!data?.some((b) => b.count > 0)) return []
  return data.map((b) => ({
    name: ageBandLabel(b.band),
    value: b.count,
    percentage: b.percentage,
    id: b.band,
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
    name: sessionName(s.session_name, undefined, 'chart'),
    value: s.count,
    percentage: s.utilization ?? 0,
    id: String(s.session_cm_id),
  }))
}

/**
 * Session rows for a year-over-year session comparison table: `transformSessionData` after the
 * year's TLI rows roll into one "Teen Leadership Institute" line (owner, 2026-10-14), so a
 * two-route year and a one-row year compare as one program. Compare mode only; the per-year
 * charts keep `transformSessionData`.
 */
export function transformSessionComparisonData(
  data: SessionBreakdown[] | undefined,
  sessionDateLookup: SessionDateLookup,
  sessionTypeLookup?: SessionTypeLookup
): ChartDataPoint[] {
  return transformSessionData(rollUpTliSessions(data ?? []), sessionDateLookup, sessionTypeLookup)
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

/**
 * Kindred's attendance history starts with the 2017 summer, so First Summer Year's
 * earliest bucket holds everyone who first came in 2017 or before (the API folds
 * any earlier year into it). Epic #3207 decision 36b names it that way.
 */
export const FIRST_HISTORY_SUMMER = 2017

export function firstSummerYearLabel(year: number | string): string {
  return Number(year) <= FIRST_HISTORY_SUMMER ? `${FIRST_HISTORY_SUMMER} or earlier` : String(year)
}

export function transformFirstSummerYearData(
  data: FirstSummerYearBreakdown[] | undefined
): ChartDataPoint[] {
  if (!data?.length) return []
  return data.map((y) => ({
    name: firstSummerYearLabel(y.first_summer_year),
    value: y.count,
    percentage: y.percentage,
    // The drill-down filters on the year, not on the label.
    id: y.first_summer_year,
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
    name: sessionName(s.session_name, undefined, 'chart'),
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
    name: firstSummerYearLabel(y.first_summer_year),
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
    name: sessionName(s.prior_session, undefined, 'chart'),
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
