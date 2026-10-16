/**
 * Analytics › Today (#3207 PR 8): Session fill and Recent sign-ups. Each card has its own query, so one
 * failing never takes the others with it (D-UNCOVERED: per-card "Try again" on Today).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'
import type { MetricsFilterOptions } from './useMetrics'
import type { ApiRecentSignups, ApiTodaySessions } from '../types/api-types'

function scopeParams(year: number, filter: MetricsFilterOptions): URLSearchParams {
  const params = new URLSearchParams({ year: String(year) })
  if (filter.sessionTypes) params.set('session_types', filter.sessionTypes)
  if (filter.sessionCmId != null) params.set('session_cm_id', String(filter.sessionCmId))
  if (filter.duration) params.set('duration', filter.duration)
  return params
}

async function readJson<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string }
    throw new Error(body.detail ?? `Failed to fetch ${what}`)
  }
  return (await response.json()) as T
}

export function useTodaySessions(year: number, filter: MetricsFilterOptions) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.todaySessions(
      year,
      filter.sessionTypes,
      filter.sessionCmId,
      filter.duration
    ),
    queryFn: async () =>
      readJson<ApiTodaySessions>(
        await fetchWithAuth(`/api/metrics/today/sessions?${scopeParams(year, filter).toString()}`),
        'session fill'
      ),
    enabled: year > 0 && !isAuthLoading,
    placeholderData: keepPreviousData,
    ...syncDataOptions,
  })
}

export function useTodayRecent(year: number, filter: MetricsFilterOptions) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.todayRecent(year, filter.sessionTypes, filter.sessionCmId, filter.duration),
    queryFn: async () =>
      readJson<ApiRecentSignups>(
        await fetchWithAuth(`/api/metrics/today/recent?${scopeParams(year, filter).toString()}`),
        'recent sign-ups'
      ),
    enabled: year > 0 && !isAuthLoading,
    placeholderData: keepPreviousData,
    ...syncDataOptions,
  })
}
