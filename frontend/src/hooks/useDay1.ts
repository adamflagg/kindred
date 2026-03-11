import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'
import type { Day1Response } from '../types/day1'

export function useDay1(year: number) {
  const { fetchWithAuth } = useApiWithAuth()

  return useQuery<Day1Response>({
    queryKey: queryKeys.day1(year),
    queryFn: async () => {
      const params = new URLSearchParams({ year: String(year) })
      const response = await fetchWithAuth(`/api/metrics/registration/day1?${params}`)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail || 'Failed to fetch Day 1 data')
      }
      return response.json()
    },
    enabled: year > 0,
    placeholderData: keepPreviousData,
    ...syncDataOptions,
  })
}
