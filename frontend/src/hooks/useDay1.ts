import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { useApiWithAuth } from './useApiWithAuth'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'
import type { Day1Response } from '../types/day1'

export function useDay1(year: number, sessionTypes?: string) {
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading } = useAuth()

  return useQuery<Day1Response>({
    queryKey: queryKeys.day1(year, sessionTypes),
    queryFn: async () => {
      const params = new URLSearchParams({ year: String(year) })
      if (sessionTypes) params.set('session_types', sessionTypes)
      const response = await fetchWithAuth(`/api/metrics/registration/day1?${params}`)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail ?? 'Failed to fetch Day 1 data')
      }
      return response.json()
    },
    enabled: !isLoading && year > 0,
    placeholderData: keepPreviousData,
    ...syncDataOptions,
  })
}
