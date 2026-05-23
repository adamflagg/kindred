/**
 * Hook to fetch retention trends data for 3-year view.
 *
 * Returns retention data across multiple year transitions for the retention tab.
 */

import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'
import type { RetentionTrendsResponse } from '../types/metrics'
import type { MetricsFilterOptions } from './useMetrics'

/** Extends MetricsFilterOptions with retention-specific numYears field (#674). */
export type UseRetentionTrendsOptions = MetricsFilterOptions & {
  /** Number of years to include (default: 3) */
  numYears?: number | undefined
  /** Credit grade-10 campers who continue into a summer teen program (SCIT/TLI) as retained. */
  includeTeenPipeline?: boolean | undefined
}

/**
 * Fetch retention trends across multiple year transitions.
 *
 * For a currentYear of 2026 with numYears=3:
 * - Returns transitions: 2023→2024, 2024→2025, 2025→2026
 * - Includes overall retention rates and breakdowns by gender/grade
 *
 * @param currentYear - The current/target year (e.g., 2026)
 * @param options - Optional filtering parameters
 */
export function useRetentionTrends(currentYear: number, options: UseRetentionTrendsOptions = {}) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()
  const { numYears = 3, sessionTypes, sessionCmId, duration, includeTeenPipeline = false } = options

  return useQuery({
    queryKey: queryKeys.retentionTrends(
      currentYear,
      numYears,
      sessionTypes,
      sessionCmId,
      duration,
      includeTeenPipeline
    ),
    queryFn: async (): Promise<RetentionTrendsResponse> => {
      const params = new URLSearchParams({
        current_year: currentYear.toString(),
      })

      if (numYears !== 3) {
        params.set('num_years', numYears.toString())
      }

      if (sessionTypes) {
        params.set('session_types', sessionTypes)
      }

      if (sessionCmId !== undefined) {
        params.set('session_cm_id', sessionCmId.toString())
      }

      if (duration) {
        params.set('duration', duration)
      }

      if (includeTeenPipeline) {
        params.set('include_teen_pipeline', 'true')
      }

      const response = await fetchWithAuth(`/api/metrics/retention-trends?${params}`)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail ?? 'Failed to fetch retention trends')
      }
      return response.json()
    },
    enabled: currentYear > 0 && !isAuthLoading,
    placeholderData: keepPreviousData,
    ...syncDataOptions,
  })
}
