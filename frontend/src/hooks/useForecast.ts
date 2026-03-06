import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'
import type { ForecastResponse } from '../types/forecast'

export function useForecast(
  year: number,
  params: { sessionCmId?: number | null; sessionTypes?: string; snapshotDate?: string | null }
) {
  const { fetchWithAuth } = useApiWithAuth()

  const searchParams = new URLSearchParams({ year: String(year) })
  if (params.sessionCmId) searchParams.set('session_cm_id', String(params.sessionCmId))
  if (params.sessionTypes) searchParams.set('session_types', params.sessionTypes)
  if (params.snapshotDate) searchParams.set('snapshot_date', params.snapshotDate)

  return useQuery({
    queryKey: queryKeys.forecast(
      year,
      params.sessionTypes,
      params.sessionCmId ?? undefined,
      params.snapshotDate ?? undefined
    ),
    queryFn: async (): Promise<ForecastResponse> => {
      const response = await fetchWithAuth(`/api/metrics/forecast?${searchParams}`)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail || 'Failed to fetch forecast')
      }
      return response.json()
    },
    enabled: year > 0,
    placeholderData: keepPreviousData,
    ...syncDataOptions,
  })
}
