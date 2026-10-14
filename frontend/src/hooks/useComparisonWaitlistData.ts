/**
 * Hook for fetching waitlist metrics for two years in comparison mode.
 *
 * Calls useWaitlistMetrics twice — once for the primary year and once for
 * the compare year. The compare query is disabled when compareYear is null.
 */

import { useWaitlistMetrics } from './useMetrics'
import { useCompareYearFilter } from './useCompareYearFilter'
import type { MetricsFilterOptions } from './useMetrics'

export function useComparisonWaitlistData(
  primaryYear: number,
  compareYear: number | null,
  options?: MetricsFilterOptions
) {
  const primary = useWaitlistMetrics(primaryYear, options)

  // Pass 0 to disable the query when not comparing (enabled: year > 0)
  // The picked session's id belongs to the primary year; map it onto the compare year
  const compareOptions = useCompareYearFilter(primaryYear, compareYear, options)
  const comparison = useWaitlistMetrics(compareYear ?? 0, compareOptions)

  return {
    primary,
    comparison: compareYear ? comparison : null,
    isComparing: compareYear !== null,
  }
}
