/**
 * Hook for fetching registration metrics for two years in comparison mode.
 *
 * Calls useRegistrationMetrics twice — once for the primary year and once for
 * the compare year. The compare query is disabled when compareYear is null.
 *
 * By default the compare year is read at its final. A page that opts in with `samePoint` (decision
 * 7 covers Registration › Overview only) gets it at the same point of the primary season while that
 * season is live, and at its final after; the comparison's `prior_basis` says which.
 */

import { useRegistrationMetrics } from './useMetrics'
import { useCompareYearFilter } from './useCompareYearFilter'
import type { RegistrationFilterOptions } from './useMetrics'

export function useComparisonRegistrationData(
  primaryYear: number,
  compareYear: number | null,
  options?: RegistrationFilterOptions,
  { samePoint = false }: { samePoint?: boolean } = {}
) {
  const primary = useRegistrationMetrics(primaryYear, options)

  // Pass 0 to disable the query when not comparing (enabled: year > 0)
  // The picked session's id belongs to the primary year; map it onto the compare year
  const compareOptions = useCompareYearFilter(primaryYear, compareYear, options)
  const comparison = useRegistrationMetrics(
    compareYear ?? 0,
    samePoint ? { ...compareOptions, samePointOf: primaryYear } : compareOptions
  )

  return {
    primary,
    comparison: compareYear ? comparison : null,
    isComparing: compareYear !== null,
  }
}
