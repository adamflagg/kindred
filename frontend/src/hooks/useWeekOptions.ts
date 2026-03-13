import { useQuery } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'
import type { WeekOption } from '../types/forecast'

export function useWeekOptions(year: number) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.forecastWeekOptions(year),
    queryFn: async (): Promise<WeekOption[]> => {
      const response = await fetchWithAuth(`/api/metrics/forecast/week-options?year=${year}`)
      if (!response.ok) {
        throw new Error('Failed to fetch week options')
      }
      return response.json()
    },
    enabled: year > 0 && !isAuthLoading,
    ...syncDataOptions,
  })
}
