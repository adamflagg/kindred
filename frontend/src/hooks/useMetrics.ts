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
 * Fetch retention metrics comparing two years.
 */
export function useRetentionMetrics(
  baseYear: number,
  compareYear: number,
  sessionTypes?: string,
  sessionCmId?: number,
  duration?: string
) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.retention(baseYear, compareYear, sessionTypes, sessionCmId, duration),
    queryFn: async (): Promise<RetentionMetrics> => {
      const params = new URLSearchParams({
        base_year: baseYear.toString(),
        compare_year: compareYear.toString(),
      })
      if (sessionTypes) {
        params.set('session_types', sessionTypes)
      }
      if (sessionCmId !== undefined) {
        params.set('session_cm_id', sessionCmId.toString())
      }
      if (duration) {
        params.set('duration', duration)
      }

      const response = await fetchWithAuth(`/api/metrics/retention?${params}`)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail || 'Failed to fetch retention metrics')
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
export function useRegistrationMetrics(
  year: number,
  sessionTypes?: string,
  statuses?: string,
  sessionCmId?: number,
  duration?: string
) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.registration(year, sessionTypes, statuses, sessionCmId, duration),
    queryFn: async (): Promise<RegistrationMetrics> => {
      const params = new URLSearchParams({
        year: year.toString(),
      })
      if (sessionTypes) {
        params.set('session_types', sessionTypes)
      }
      if (statuses) {
        params.set('statuses', statuses)
      }
      if (sessionCmId !== undefined) {
        params.set('session_cm_id', sessionCmId.toString())
      }
      if (duration) {
        params.set('duration', duration)
      }

      const response = await fetchWithAuth(`/api/metrics/registration?${params}`)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail || 'Failed to fetch registration metrics')
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
export function useComparisonMetrics(yearA: number, yearB: number) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.comparison(yearA, yearB),
    queryFn: async (): Promise<ComparisonMetrics> => {
      const params = new URLSearchParams({
        year_a: yearA.toString(),
        year_b: yearB.toString(),
      })

      const response = await fetchWithAuth(`/api/metrics/comparison?${params}`)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail || 'Failed to fetch comparison metrics')
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
 * @param years - Comma-separated years (e.g., "2021,2022,2023")
 * @param sessionTypes - Comma-separated session types (e.g., "main,embedded,ag")
 * @param sessionCmId - Filter to specific session by CampMinder ID.
 *                      Uses name-matching across years to show trends
 *                      for the same session across multiple years.
 */
export function useHistoricalTrends(
  years?: string,
  sessionTypes?: string,
  sessionCmId?: number,
  duration?: string
) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.historical(years, sessionTypes, sessionCmId, duration),
    queryFn: async (): Promise<HistoricalTrendsResponse> => {
      const params = new URLSearchParams()
      if (years) {
        params.set('years', years)
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

      const url = params.toString()
        ? `/api/metrics/historical?${params}`
        : '/api/metrics/historical'

      const response = await fetchWithAuth(url)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail || 'Failed to fetch historical trends')
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
export function useWaitlistMetrics(
  year: number,
  sessionTypes?: string,
  sessionCmId?: number,
  duration?: string
) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.waitlist(year, sessionTypes, sessionCmId, duration),
    queryFn: async (): Promise<WaitlistMetrics> => {
      const params = new URLSearchParams({
        year: year.toString(),
      })
      if (sessionTypes) {
        params.set('session_types', sessionTypes)
      }
      if (sessionCmId !== undefined) {
        params.set('session_cm_id', sessionCmId.toString())
      }
      if (duration) {
        params.set('duration', duration)
      }

      const response = await fetchWithAuth(`/api/metrics/waitlist?${params}`)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail || 'Failed to fetch waitlist metrics')
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
export function useCancellationMetrics(
  year: number,
  sessionTypes?: string,
  sessionCmId?: number,
  duration?: string
) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.cancellations(year, sessionTypes, sessionCmId, duration),
    queryFn: async (): Promise<CancellationMetrics> => {
      const params = new URLSearchParams({
        year: year.toString(),
      })
      if (sessionTypes) {
        params.set('session_types', sessionTypes)
      }
      if (sessionCmId !== undefined) {
        params.set('session_cm_id', sessionCmId.toString())
      }
      if (duration) {
        params.set('duration', duration)
      }

      const response = await fetchWithAuth(`/api/metrics/cancellations?${params}`)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail || 'Failed to fetch cancellation metrics')
      }
      return response.json()
    },
    enabled: year > 0 && !isAuthLoading,
    placeholderData: keepPreviousData,
    ...syncDataOptions,
  })
}
