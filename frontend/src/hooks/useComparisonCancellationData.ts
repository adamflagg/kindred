/**
 * Hook for fetching cancellation metrics for two years in comparison mode.
 *
 * Calls useCancellationMetrics twice — once for the primary year and once for
 * the compare year. The compare query is disabled when compareYear is null.
 *
 * The compare year is asked against the primary season (`same_point_of`, PM-8 A): Cancellations
 * reads it at the same registration day while that season is live and at its final after.
 * The comparison's `prior_basis` says which.
 */

import { useCancellationMetrics } from './useMetrics'
import { useCompareYearFilter } from './useCompareYearFilter'
import type { MetricsFilterOptions } from './useMetrics'

export function useComparisonCancellationData(
  primaryYear: number,
  compareYear: number | null,
  options?: MetricsFilterOptions
) {
  const primary = useCancellationMetrics(primaryYear, options)

  // Pass 0 to disable the query when not comparing (enabled: year > 0)
  // The picked session's id belongs to the primary year; map it onto the compare year
  const compareOptions = useCompareYearFilter(primaryYear, compareYear, options)
  const comparison = useCancellationMetrics(compareYear ?? 0, {
    ...compareOptions,
    samePointOf: primaryYear,
  })

  return {
    primary,
    comparison: compareYear ? comparison : null,
    isComparing: compareYear !== null,
  }
}
