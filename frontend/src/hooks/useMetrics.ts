/**
 * React Query hooks for metrics API endpoints.
 */

import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'
import type {
  RetentionMetrics,
  RegistrationMetrics,
  ComparisonMetrics,
  HistoricalTrendsResponse,
  WaitlistMetrics,
  CancellationMetrics,
} from '../types/metrics'

/**
 * Shared filter options for metrics hooks.
 *
 * sessionCmId and duration are mutually exclusive (#567):
 * - sessionCmId: filter to a single session by CampMinder ID
 * - duration: filter by session grouping (e.g., "1-week", "2-week", "at-camp", "quest")
 * The backend rejects requests with both set (422), and the UI prevents it,
 * but this type also enforces it at compile time.
 */
export type MetricsFilterOptions =
  | { sessionTypes?: string | undefined; sessionCmId: number; duration?: undefined }
  | { sessionTypes?: string | undefined; sessionCmId?: undefined; duration: string }
  | { sessionTypes?: string | undefined; sessionCmId?: undefined; duration?: undefined }

export type RegistrationFilterOptions = MetricsFilterOptions & { statuses?: string }

export type HistoricalFilterOptions = MetricsFilterOptions & { years?: string }

/**
 * Build a properly-typed MetricsFilterOptions from loose params.
 *
 * Call sites typically have `sessionCmId: number | null` and `duration: string | undefined`
 * from the MetricsSessionContext. This helper narrows those wide types into the
 * discriminated union, enforcing mutual exclusivity at runtime.
 *
 * sessionCmId takes priority if both are somehow non-null (shouldn't happen — UI prevents it).
 */
export function metricsFilter(params: {
  sessionTypes?: string | undefined
  sessionCmId?: number | null | undefined
  duration?: string | null | undefined
}): MetricsFilterOptions {
  if (params.sessionCmId != null) {
    return { sessionTypes: params.sessionTypes, sessionCmId: params.sessionCmId }
  }
  if (params.duration != null) {
    return { sessionTypes: params.sessionTypes, duration: params.duration }
  }
  return { sessionTypes: params.sessionTypes }
}

/**
 * Fetch retention metrics comparing two years.
 */
export function useRetentionMetrics(
  baseYear: number,
  compareYear: number,
  options?: MetricsFilterOptions,
  includeTeenPipeline = false
) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.retention(
      baseYear,
      compareYear,
      options?.sessionTypes,
      options?.sessionCmId,
      options?.duration,
      includeTeenPipeline
    ),
    queryFn: async (): Promise<RetentionMetrics> => {
      const params = new URLSearchParams({
        base_year: baseYear.toString(),
        compare_year: compareYear.toString(),
      })
      if (options?.sessionTypes) {
        params.set('session_types', options.sessionTypes)
      }
      if (options?.sessionCmId !== undefined) {
        params.set('session_cm_id', options.sessionCmId.toString())
      }
      if (options?.duration) {
        params.set('duration', options.duration)
      }
      if (includeTeenPipeline) {
        params.set('include_teen_pipeline', 'true')
      }

      const response = await fetchWithAuth(`/api/metrics/retention?${params}`)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail ?? 'Failed to fetch retention metrics')
      }
      return response.json()
    },
    enabled: baseYear > 0 && compareYear > 0 && !isAuthLoading,
    placeholderData: keepPreviousData, // Keep showing old data during filter changes
    ...syncDataOptions,
  })
}

/**
 * Fetch registration metrics for a single year.
 */
export function useRegistrationMetrics(year: number, options?: RegistrationFilterOptions) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.registration(
      year,
      options?.sessionTypes,
      options?.statuses,
      options?.sessionCmId,
      options?.duration
    ),
    queryFn: async (): Promise<RegistrationMetrics> => {
      const params = new URLSearchParams({
        year: year.toString(),
      })
      if (options?.sessionTypes) {
        params.set('session_types', options.sessionTypes)
      }
      if (options?.statuses) {
        params.set('statuses', options.statuses)
      }
      if (options?.sessionCmId !== undefined) {
        params.set('session_cm_id', options.sessionCmId.toString())
      }
      if (options?.duration) {
        params.set('duration', options.duration)
      }

      const response = await fetchWithAuth(`/api/metrics/registration?${params}`)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail ?? 'Failed to fetch registration metrics')
      }
      return response.json()
    },
    enabled: year > 0 && !isAuthLoading,
    placeholderData: keepPreviousData, // Keep showing old data during filter changes
    ...syncDataOptions,
  })
}

/**
 * Fetch comparison metrics between two years.
 */
export function useComparisonMetrics(yearA: number, yearB: number, options?: MetricsFilterOptions) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.comparison(
      yearA,
      yearB,
      options?.sessionTypes,
      options?.sessionCmId,
      options?.duration
    ),
    queryFn: async (): Promise<ComparisonMetrics> => {
      const params = new URLSearchParams({
        year_a: yearA.toString(),
        year_b: yearB.toString(),
      })
      // Backend comparison endpoint only supports session_types today.
      // sessionCmId/duration are accepted in the type for pattern consistency
      // but not sent until the backend adds support.
      if (options?.sessionTypes) {
        params.set('session_types', options.sessionTypes)
      }

      const response = await fetchWithAuth(`/api/metrics/comparison?${params}`)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail ?? 'Failed to fetch comparison metrics')
      }
      return response.json()
    },
    enabled: yearA > 0 && yearB > 0 && !isAuthLoading,
    placeholderData: keepPreviousData, // Keep showing old data during filter changes
    ...syncDataOptions,
  })
}

/**
 * Fetch historical trends across multiple years.
 * Default: last 5 years (2021-2025).
 *
 * @param options.years - Comma-separated years (e.g., "2021,2022,2023")
 * @param options.sessionTypes - Comma-separated session types (e.g., "main,embedded,ag")
 * @param options.sessionCmId - Filter to specific session by CampMinder ID.
 *                      Uses name-matching across years to show trends
 *                      for the same session across multiple years.
 */
export function useHistoricalTrends(options?: HistoricalFilterOptions) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.historical(
      options?.years,
      options?.sessionTypes,
      options?.sessionCmId,
      options?.duration
    ),
    queryFn: async (): Promise<HistoricalTrendsResponse> => {
      const params = new URLSearchParams()
      if (options?.years) {
        params.set('years', options.years)
      }
      if (options?.sessionTypes) {
        params.set('session_types', options.sessionTypes)
      }
      if (options?.sessionCmId !== undefined) {
        params.set('session_cm_id', options.sessionCmId.toString())
      }
      if (options?.duration) {
        params.set('duration', options.duration)
      }

      const url = params.toString()
        ? `/api/metrics/historical?${params}`
        : '/api/metrics/historical'

      const response = await fetchWithAuth(url)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail ?? 'Failed to fetch historical trends')
      }
      return response.json()
    },
    enabled: !isAuthLoading,
    placeholderData: keepPreviousData, // Keep showing old data during filter changes
    ...syncDataOptions,
  })
}

/**
 * Fetch waitlist analysis metrics for a single year.
 */
export function useWaitlistMetrics(year: number, options?: MetricsFilterOptions) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.waitlist(
      year,
      options?.sessionTypes,
      options?.sessionCmId,
      options?.duration
    ),
    queryFn: async (): Promise<WaitlistMetrics> => {
      const params = new URLSearchParams({
        year: year.toString(),
      })
      if (options?.sessionTypes) {
        params.set('session_types', options.sessionTypes)
      }
      if (options?.sessionCmId !== undefined) {
        params.set('session_cm_id', options.sessionCmId.toString())
      }
      if (options?.duration) {
        params.set('duration', options.duration)
      }

      const response = await fetchWithAuth(`/api/metrics/waitlist?${params}`)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail ?? 'Failed to fetch waitlist metrics')
      }
      return response.json()
    },
    enabled: year > 0 && !isAuthLoading,
    placeholderData: keepPreviousData,
    ...syncDataOptions,
  })
}

/**
 * Fetch cancellation analysis metrics for a single year.
 */
export function useCancellationMetrics(year: number, options?: MetricsFilterOptions) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.cancellations(
      year,
      options?.sessionTypes,
      options?.sessionCmId,
      options?.duration
    ),
    queryFn: async (): Promise<CancellationMetrics> => {
      const params = new URLSearchParams({
        year: year.toString(),
      })
      if (options?.sessionTypes) {
        params.set('session_types', options.sessionTypes)
      }
      if (options?.sessionCmId !== undefined) {
        params.set('session_cm_id', options.sessionCmId.toString())
      }
      if (options?.duration) {
        params.set('duration', options.duration)
      }

      const response = await fetchWithAuth(`/api/metrics/cancellations?${params}`)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail ?? 'Failed to fetch cancellation metrics')
      }
      return response.json()
    },
    enabled: year > 0 && !isAuthLoading,
    placeholderData: keepPreviousData,
    ...syncDataOptions,
  })
}
