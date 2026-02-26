/**
 * Prefetches the 3 primary metrics tab datasets (registration, retention, historical)
 * when the user enters the metrics section. This ensures tab switches are instant
 * since data is already in the React Query cache.
 *
 * Called from MetricsLayout.tsx (inside MetricsSessionProvider).
 * Query functions mirror those in useMetrics.ts.
 */

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import { useCurrentYear } from './useCurrentYear'
import { useMetricsSession } from './useMetricsSession'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'

export function useMetricsPrefetch() {
  const queryClient = useQueryClient()
  const { fetchWithAuth } = useApiWithAuth()
  const { currentYear } = useCurrentYear()
  const { sessionTypesParam, selectedSessionCmId } = useMetricsSession()

  useEffect(() => {
    if (currentYear <= 0) return

    const sessionCmId = selectedSessionCmId ?? undefined

    // Registration (mirrors useRegistrationMetrics in useMetrics.ts)
    queryClient.prefetchQuery({
      queryKey: queryKeys.registration(currentYear, sessionTypesParam, 'enrolled', sessionCmId),
      queryFn: async () => {
        const params = new URLSearchParams({ year: currentYear.toString() })
        if (sessionTypesParam) params.set('session_types', sessionTypesParam)
        params.set('statuses', 'enrolled')
        if (sessionCmId !== undefined) params.set('session_cm_id', sessionCmId.toString())
        const response = await fetchWithAuth(`/api/metrics/registration?${params}`)
        if (!response.ok) throw new Error('Failed to prefetch registration metrics')
        return response.json()
      },
      ...syncDataOptions,
    })

    // Retention (mirrors useRetentionMetrics in useMetrics.ts)
    queryClient.prefetchQuery({
      queryKey: queryKeys.retention(currentYear - 1, currentYear, sessionTypesParam, sessionCmId),
      queryFn: async () => {
        const params = new URLSearchParams({
          base_year: (currentYear - 1).toString(),
          compare_year: currentYear.toString(),
        })
        if (sessionTypesParam) params.set('session_types', sessionTypesParam)
        if (sessionCmId !== undefined) params.set('session_cm_id', sessionCmId.toString())
        const response = await fetchWithAuth(`/api/metrics/retention?${params}`)
        if (!response.ok) throw new Error('Failed to prefetch retention metrics')
        return response.json()
      },
      ...syncDataOptions,
    })

    // Historical (mirrors useHistoricalTrends in useMetrics.ts)
    queryClient.prefetchQuery({
      queryKey: queryKeys.historical(undefined, sessionTypesParam, sessionCmId),
      queryFn: async () => {
        const params = new URLSearchParams()
        if (sessionTypesParam) params.set('session_types', sessionTypesParam)
        if (sessionCmId !== undefined) params.set('session_cm_id', sessionCmId.toString())
        const url = params.toString()
          ? `/api/metrics/historical?${params}`
          : '/api/metrics/historical'
        const response = await fetchWithAuth(url)
        if (!response.ok) throw new Error('Failed to prefetch historical metrics')
        return response.json()
      },
      ...syncDataOptions,
    })
  }, [currentYear, sessionTypesParam, selectedSessionCmId, queryClient, fetchWithAuth])
}
