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
  SessionFlowItem,
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

/** Map raw gender codes to readable display names. */
export function getGenderDisplayName(raw: string): string {
  switch (raw) {
    case 'M':
      return 'Male'
    case 'F':
      return 'Female'
    default:
      return raw
  }
}

export function genderToBarData(data: RetentionByGender[] | undefined): RetentionRateBarItem[] {
  if (!data?.length) return []
  return data.map((d) => ({
    name: getGenderDisplayName(d.gender),
    retentionRate: d.retention_rate,
    baseCount: d.base_count,
    returnedCount: d.returned_count,
    id: d.gender,
  }))
}

export function gradeToBarData(data: RetentionByGrade[] | undefined): RetentionRateBarItem[] {
  if (!data?.length) return []
  return data.map((d) => ({
    name: d.grade !== null ? `${d.grade}` : 'Unknown',
    retentionRate: d.retention_rate,
    baseCount: d.base_count,
    returnedCount: d.returned_count,
    id: d.grade !== null ? d.grade : 'null',
  }))
}

export function sessionToBarData(data: RetentionBySession[] | undefined): RetentionRateBarItem[] {
  if (!data?.length) return []
  return data.map((d) => ({
    name: d.session_name,
    retentionRate: d.retention_rate,
    baseCount: d.base_count,
    returnedCount: d.returned_count,
    id: d.session_cm_id,
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
    id: d.summer_years,
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
    id: d.first_summer_year,
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
  impact: number // abs(deviation_pp) * baseCount / 100
  expectedCount: number // Math.round(overallRate * baseCount)
}

export interface SankeyNode {
  name: string
  cmId: number | null
}

export interface SankeyLink {
  source: number
  target: number
  value: number
}

export interface SankeyData {
  nodes: SankeyNode[]
  links: SankeyLink[]
}

function getNodeIndex(map: Map<string, number>, key: string): number {
  const idx = map.get(key)
  if (idx === undefined) throw new Error(`Missing node index for ${key}`)
  return idx
}

/**
 * Convert SessionFlowItem[] from API to Recharts Sankey data format.
 *
 * Source nodes get "(from)" suffix, target nodes get "(to)" suffix
 * to disambiguate when the same session name appears on both sides.
 * "Did Not Return" is a special target that gets no suffix.
 */
export function sessionFlowToSankeyData(data: SessionFlowItem[] | undefined): SankeyData | null {
  if (!data?.length) return null

  // Collect unique sources and targets with their cm_ids
  const sourceCmIds = new Map<string, number>()
  const targetCmIds = new Map<string, number | null>()
  for (const item of data) {
    sourceCmIds.set(item.source, item.source_cm_id)
    if (!targetCmIds.has(item.target)) {
      targetCmIds.set(item.target, item.target_cm_id)
    }
  }

  // Build node list: sources first, then targets
  const nodes: SankeyNode[] = []
  const nodeIndexMap = new Map<string, number>()

  for (const [name, cmId] of sourceCmIds) {
    const displayName = `${name} (from)`
    nodeIndexMap.set(`source:${name}`, nodes.length)
    nodes.push({ name: displayName, cmId })
  }

  for (const [name, cmId] of targetCmIds) {
    const displayName = name === 'Did Not Return' ? name : `${name} (to)`
    nodeIndexMap.set(`target:${name}`, nodes.length)
    nodes.push({ name: displayName, cmId: cmId ?? null })
  }

  // Build links
  const links: SankeyLink[] = data.map((item) => ({
    source: getNodeIndex(nodeIndexMap, `source:${item.source}`),
    target: getNodeIndex(nodeIndexMap, `target:${item.target}`),
    value: item.value,
  }))

  return { nodes, links }
}

export function computeRetentionOutliers(
  data: RetentionRateBarItem[],
  overallRate: number,
  options?: { minBaseCount?: number; minDeviation?: number }
): RetentionOutlier[] {
  const minBaseCount = options?.minBaseCount ?? 8
  const minDeviation = options?.minDeviation ?? 10
  const minImpact = 3.0

  return data
    .filter((d) => d.baseCount >= minBaseCount)
    .map((d) => {
      const deviation = Math.round(d.retentionRate * 100) - Math.round(overallRate * 100)
      const impact = (Math.abs(deviation) * d.baseCount) / 100
      const expectedCount = Math.round(overallRate * d.baseCount)
      return {
        name: d.name,
        retentionRate: d.retentionRate,
        baseCount: d.baseCount,
        returnedCount: d.returnedCount,
        deviation,
        impact,
        expectedCount,
      }
    })
    .filter((d) => {
      // Must have meaningful deviation
      if (Math.abs(d.deviation) < minDeviation) return false
      // Zero retention always notable if base count qualifies
      if (d.retentionRate === 0) return true
      // Must have meaningful impact
      return d.impact >= minImpact
    })
    .sort((a, b) => b.impact - a.impact)
}
