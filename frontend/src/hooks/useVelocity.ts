/**
 * React Query hook for fetching registration velocity data.
 */

import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'
import type { VelocityResponse } from '../types/velocity'

export function useVelocity(
  year: number,
  params: {
    sessionCmId?: number | null
    compareYears?: number[]
    sessionTypes?: string
    splitByGender?: boolean
    metric?: 'enrollment' | 'cancellation'
    duration?: string | null | undefined
  } = {}
) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()

  const searchParams = new URLSearchParams({ year: String(year) })
  if (params.sessionCmId) searchParams.set('session_cm_id', String(params.sessionCmId))
  if (params.compareYears?.length) searchParams.set('compare_years', params.compareYears.join(','))
  if (params.sessionTypes) searchParams.set('session_types', params.sessionTypes)
  if (params.splitByGender) searchParams.set('split_by_gender', 'true')
  if (params.metric && params.metric !== 'enrollment') searchParams.set('metric', params.metric)
  if (params.duration) searchParams.set('duration', params.duration)

  return useQuery({
    queryKey: queryKeys.velocity(
      year,
      params.sessionCmId ?? undefined,
      params.compareYears?.join(','),
      params.sessionTypes,
      params.splitByGender,
      params.metric,
      params.duration ?? undefined
    ),
    queryFn: async (): Promise<VelocityResponse> => {
      const response = await fetchWithAuth(`/api/metrics/velocity?${searchParams}`)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail ?? 'Failed to fetch velocity data')
      }
      return response.json()
    },
    enabled: year > 0 && !isAuthLoading,
    placeholderData: keepPreviousData,
    ...syncDataOptions,
  })
}
