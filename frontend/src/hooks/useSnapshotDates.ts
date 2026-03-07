import { useQuery } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'

export function useSnapshotDates(year: number) {
  const { fetchWithAuth } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.forecastSnapshotDates(year),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/metrics/forecast/snapshot-dates?year=${year}`)
      if (!response.ok) {
        throw new Error('Failed to fetch snapshot dates')
      }
      const data = await response.json()
      return data.dates as string[]
    },
    ...syncDataOptions,
  })
}
