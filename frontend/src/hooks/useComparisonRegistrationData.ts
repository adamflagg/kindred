/**
 * Hook for fetching registration metrics for two years in comparison mode.
 *
 * Calls useRegistrationMetrics twice — once for the primary year and once for
 * the compare year. The compare query is disabled when compareYear is null.
 */

import { useRegistrationMetrics } from './useMetrics'
import type { RegistrationFilterOptions } from './useMetrics'

export function useComparisonRegistrationData(
  primaryYear: number,
  compareYear: number | null,
  options?: RegistrationFilterOptions
) {
  const primary = useRegistrationMetrics(primaryYear, options)

  // Pass 0 to disable the query when not comparing (enabled: year > 0)
  const comparison = useRegistrationMetrics(compareYear ?? 0, options)

  return {
    primary,
    comparison: compareYear ? comparison : null,
    isComparing: compareYear !== null,
  }
}
