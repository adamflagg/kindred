/**
 * React Query hooks for metrics API endpoints.
 */

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useApiWithAuth } from './useApiWithAuth';
import { queryKeys, syncDataOptions } from '../utils/queryKeys';
import type {
  RetentionMetrics,
  RegistrationMetrics,
  ComparisonMetrics,
  HistoricalTrendsResponse,
} from '../types/metrics';

/**
 * Fetch retention metrics comparing two years.
 */
export function useRetentionMetrics(
  baseYear: number,
  compareYear: number,
  sessionTypes?: string,
  sessionCmId?: number
) {
  const { fetchWithAuth } = useApiWithAuth();

  return useQuery({
    queryKey: queryKeys.retention(baseYear, compareYear, sessionTypes, sessionCmId),
    queryFn: async (): Promise<RetentionMetrics> => {
      const params = new URLSearchParams({
        base_year: baseYear.toString(),
        compare_year: compareYear.toString(),
      });
      if (sessionTypes) {
        params.set('session_types', sessionTypes);
      }
      if (sessionCmId !== undefined) {
        params.set('session_cm_id', sessionCmId.toString());
      }

      const response = await fetchWithAuth(`/api/metrics/retention?${params}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Failed to fetch retention metrics');
      }
      return response.json();
    },
    enabled: baseYear > 0 && compareYear > 0,
    placeholderData: keepPreviousData, // Keep showing old data during filter changes
    ...syncDataOptions,
  });
}

/**
 * Fetch registration metrics for a single year.
 */
export function useRegistrationMetrics(
  year: number,
  sessionTypes?: string,
  statuses?: string,
  sessionCmId?: number
) {
  const { fetchWithAuth } = useApiWithAuth();

  return useQuery({
    queryKey: queryKeys.registration(year, sessionTypes, statuses, sessionCmId),
    queryFn: async (): Promise<RegistrationMetrics> => {
      const params = new URLSearchParams({
        year: year.toString(),
      });
      if (sessionTypes) {
        params.set('session_types', sessionTypes);
      }
      if (statuses) {
        params.set('statuses', statuses);
      }
      if (sessionCmId !== undefined) {
        params.set('session_cm_id', sessionCmId.toString());
      }

      const response = await fetchWithAuth(`/api/metrics/registration?${params}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Failed to fetch registration metrics');
      }
      return response.json();
    },
    enabled: year > 0,
    placeholderData: keepPreviousData, // Keep showing old data during filter changes
    ...syncDataOptions,
  });
}

/**
 * Fetch comparison metrics between two years.
 */
export function useComparisonMetrics(yearA: number, yearB: number) {
  const { fetchWithAuth } = useApiWithAuth();

  return useQuery({
    queryKey: queryKeys.comparison(yearA, yearB),
    queryFn: async (): Promise<ComparisonMetrics> => {
      const params = new URLSearchParams({
        year_a: yearA.toString(),
        year_b: yearB.toString(),
      });

      const response = await fetchWithAuth(`/api/metrics/comparison?${params}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Failed to fetch comparison metrics');
      }
      return response.json();
    },
    enabled: yearA > 0 && yearB > 0,
    placeholderData: keepPreviousData, // Keep showing old data during filter changes
    ...syncDataOptions,
  });
}

/**
 * Fetch historical trends across multiple years.
 * Default: last 5 years (2021-2025).
 */
export function useHistoricalTrends(years?: string, sessionTypes?: string) {
  const { fetchWithAuth } = useApiWithAuth();

  return useQuery({
    queryKey: queryKeys.historical(years, sessionTypes),
    queryFn: async (): Promise<HistoricalTrendsResponse> => {
      const params = new URLSearchParams();
      if (years) {
        params.set('years', years);
      }
      if (sessionTypes) {
        params.set('session_types', sessionTypes);
      }

      const url = params.toString()
        ? `/api/metrics/historical?${params}`
        : '/api/metrics/historical';

      const response = await fetchWithAuth(url);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Failed to fetch historical trends');
      }
      return response.json();
    },
    placeholderData: keepPreviousData, // Keep showing old data during filter changes
    ...syncDataOptions,
  });
}
