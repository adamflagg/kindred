/**
 * Utility functions for year-over-year comparison mode.
 *
 * Used by ComparisonSummaryTable, GeoComparisonDetailList, and page-level
 * comparison logic to merge two years' datasets and calculate deltas.
 */

export interface ComparisonMergedItem {
  name: string
  /** Set when compare year had a different display name (matched by matchKey) */
  compareName?: string | undefined
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
  nameKey: string = 'name',
  matchKey?: string,
  aliasMap?: Record<string, string>
): ComparisonMergedItem[] {
  const mk = matchKey ?? nameKey

  // Map: matchKeyValue → { displayName, value }
  const primaryMap = new Map<string, { displayName: string; value: number }>()
  const compareMap = new Map<string, { displayName: string; value: number }>()

  for (const item of primaryData) {
    const key = String(item[mk] ?? '')
    const displayName = String(item[nameKey] ?? '')
    const rawPrimaryValue = item['value']
    primaryMap.set(key, {
      displayName,
      value: typeof rawPrimaryValue === 'number' ? rawPrimaryValue : 0,
    })
  }

  for (const item of compareData) {
    let key = String(item[mk] ?? '')
    if (aliasMap) key = aliasMap[key] ?? key
    const displayName = String(item[nameKey] ?? '')
    const rawCompareValue = item['value']
    compareMap.set(key, {
      displayName,
      value: typeof rawCompareValue === 'number' ? rawCompareValue : 0,
    })
  }

  // Collect all unique match keys, primary first then compare-only
  const allKeys = new Set<string>()
  for (const key of primaryMap.keys()) allKeys.add(key)
  for (const key of compareMap.keys()) allKeys.add(key)

  const result: ComparisonMergedItem[] = []
  for (const key of allKeys) {
    const pEntry = primaryMap.get(key)
    const cEntry = compareMap.get(key)
    const pv = pEntry?.value ?? 0
    const cv = cEntry?.value ?? 0
    const change = pv - cv
    // Primary year's display name wins; fall back to compare's
    const displayName = pEntry?.displayName ?? cEntry?.displayName ?? key

    let changePercent: number | null = null
    if (cv !== 0) {
      changePercent = Math.round(((pv - cv) / cv) * 1000) / 10
    } else if (pv === 0) {
      // Both zero — 0% change
      changePercent = 0
    }
    // else cv===0, pv>0 → null (can't calculate percent from zero base)

    const compareName =
      pEntry && cEntry && pEntry.displayName !== cEntry.displayName ? cEntry.displayName : undefined

    result.push({
      name: displayName,
      compareName,
      primaryValue: pv,
      compareValue: cv,
      change,
      changePercent,
    })
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
