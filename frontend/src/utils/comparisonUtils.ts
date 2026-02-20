/**
 * Utility functions for year-over-year comparison mode.
 *
 * Used by ComparisonSummaryTable, GeoComparisonDetailList, and page-level
 * comparison logic to merge two years' datasets and calculate deltas.
 */

export interface ComparisonMergedItem {
  name: string
  primaryValue: number
  compareValue: number
  change: number
  /** null when compareValue is 0 (can't calculate percent from zero base) */
  changePercent: number | null
}

export interface DeltaResult {
  change: number
  changePercent: number | null
  direction: 'up' | 'down' | 'neutral'
}

/**
 * Merge two datasets by a shared name key for side-by-side comparison.
 *
 * Items in primary but not compare get compareValue=0 (NEW items).
 * Items in compare but not primary get primaryValue=0 (GONE items).
 */
export function mergeDataForComparison<T extends Record<string, unknown>>(
  primaryData: T[],
  compareData: T[],
  nameKey: string = 'name'
): ComparisonMergedItem[] {
  const primaryMap = new Map<string, number>()
  const compareMap = new Map<string, number>()

  for (const item of primaryData) {
    const name = String(item[nameKey] ?? '')
    primaryMap.set(name, (item['value'] as number) ?? 0)
  }

  for (const item of compareData) {
    const name = String(item[nameKey] ?? '')
    compareMap.set(name, (item['value'] as number) ?? 0)
  }

  // Collect all unique names, primary first then compare-only
  const allNames = new Set<string>()
  for (const name of primaryMap.keys()) allNames.add(name)
  for (const name of compareMap.keys()) allNames.add(name)

  const result: ComparisonMergedItem[] = []
  for (const name of allNames) {
    const pv = primaryMap.get(name) ?? 0
    const cv = compareMap.get(name) ?? 0
    const change = pv - cv

    let changePercent: number | null = null
    if (cv !== 0) {
      changePercent = Math.round(((pv - cv) / cv) * 1000) / 10
    } else if (pv === 0) {
      // Both zero — 0% change
      changePercent = 0
    }
    // else cv===0, pv>0 → null (can't calculate percent from zero base)

    result.push({ name, primaryValue: pv, compareValue: cv, change, changePercent })
  }

  return result
}

/**
 * Calculate delta between two numeric values.
 */
export function calculateDelta(primary: number, compare: number): DeltaResult {
  const change = primary - compare

  let changePercent: number | null = null
  if (compare !== 0) {
    changePercent = Math.round(((primary - compare) / compare) * 1000) / 10
  } else if (primary === 0) {
    changePercent = 0
  }

  let direction: 'up' | 'down' | 'neutral'
  if (change > 0) direction = 'up'
  else if (change < 0) direction = 'down'
  else direction = 'neutral'

  return { change, changePercent, direction }
}
