import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'
import type { ForecastResponse } from '../types/forecast'

export function useForecast(
  year: number,
  params: { sessionCmId?: number | null; sessionTypes?: string }
) {
  const searchParams = new URLSearchParams({ year: String(year) })
  if (params.sessionCmId) searchParams.set('session_cm_id', String(params.sessionCmId))
  if (params.sessionTypes) searchParams.set('session_types', params.sessionTypes)

  return useQuery({
    queryKey: queryKeys.forecast(year, params.sessionTypes, params.sessionCmId ?? undefined),
    ...syncDataOptions,
    queryFn: async () => {
      return await pb.send<ForecastResponse>(`/api/metrics/forecast?${searchParams}`, {
        method: 'GET',
      })
    },
  })
}
