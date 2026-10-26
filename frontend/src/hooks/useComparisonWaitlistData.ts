/**
 * Hook for fetching waitlist metrics for two years in comparison mode.
 *
 * Calls useWaitlistMetrics twice — once for the primary year and once for
 * the compare year. The compare query is disabled when compareYear is null.
 *
 * The compare year is asked against the primary season (`same_point_of`, PM-8 A): a past waitlist
 * can't be rebuilt for a day, so while that season is live the answer says there is no comparison.
 * The comparison's `prior_basis` says which.
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
  const comparison = useWaitlistMetrics(compareYear ?? 0, {
    ...compareOptions,
    samePointOf: primaryYear,
  })

  return {
    primary,
    comparison: compareYear ? comparison : null,
    isComparing: compareYear !== null,
  }
}
