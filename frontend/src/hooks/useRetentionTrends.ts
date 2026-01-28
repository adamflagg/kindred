/**
 * Hook to fetch retention trends data for 3-year view.
 *
 * Returns retention data across multiple year transitions for the retention tab.
 */

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useApiWithAuth } from './useApiWithAuth';
import { queryKeys, syncDataOptions } from '../utils/queryKeys';
import type { RetentionTrendsResponse } from '../types/metrics';

export interface UseRetentionTrendsOptions {
  /** Number of years to include (default: 3) */
  numYears?: number | undefined;
  /** Comma-separated session types to filter */
  sessionTypes?: string | undefined;
  /** Filter to specific session by CampMinder ID */
  sessionCmId?: number | undefined;
}

/**
 * Fetch retention trends across multiple year transitions.
 *
 * For a currentYear of 2026 with numYears=3:
 * - Returns transitions: 2024→2025, 2025→2026
 * - Includes overall retention rates and breakdowns by gender/grade
 *
 * @param currentYear - The current/target year (e.g., 2026)
 * @param options - Optional filtering parameters
 */
export function useRetentionTrends(
  currentYear: number,
  options: UseRetentionTrendsOptions = {}
) {
  const { fetchWithAuth } = useApiWithAuth();
  const { numYears = 3, sessionTypes, sessionCmId } = options;

  return useQuery({
    queryKey: queryKeys.retentionTrends(currentYear, numYears, sessionTypes, sessionCmId),
    queryFn: async (): Promise<RetentionTrendsResponse> => {
      const params = new URLSearchParams({
        current_year: currentYear.toString(),
      });

      if (numYears !== 3) {
        params.set('num_years', numYears.toString());
      }

      if (sessionTypes) {
        params.set('session_types', sessionTypes);
      }

      if (sessionCmId !== undefined) {
        params.set('session_cm_id', sessionCmId.toString());
      }

      const response = await fetchWithAuth(`/api/metrics/retention-trends?${params}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Failed to fetch retention trends');
      }
      return response.json();
    },
    enabled: currentYear > 0,
    placeholderData: keepPreviousData,
    ...syncDataOptions,
  });
}
