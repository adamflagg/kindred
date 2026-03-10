/**
 * Hook for fetching cancellation metrics for two years in comparison mode.
 *
 * Calls useCancellationMetrics twice — once for the primary year and once for
 * the compare year. The compare query is disabled when compareYear is null.
 */

import { useCancellationMetrics } from './useMetrics'

export function useComparisonCancellationData(
  primaryYear: number,
  compareYear: number | null,
  sessionTypesParam?: string,
  sessionCmId?: number,
  duration?: string
) {
  const primary = useCancellationMetrics(primaryYear, sessionTypesParam, sessionCmId, duration)

  // Pass 0 to disable the query when not comparing (enabled: year > 0)
  const comparison = useCancellationMetrics(
    compareYear ?? 0,
    sessionTypesParam,
    sessionCmId,
    duration
  )

  return {
    primary,
    comparison: compareYear ? comparison : null,
    isComparing: compareYear !== null,
  }
}
