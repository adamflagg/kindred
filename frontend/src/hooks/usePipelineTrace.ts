/**
 * React Query hooks for pipeline debug traces.
 */

import { useQuery } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'
import { pipelineDebugService } from '../services/pipelineDebug'

/**
 * Hook to fetch a single pipeline trace by ID (for drill-down view).
 */
export function usePipelineTrace(traceId: string | null) {
  const { fetchWithAuth, isAuthenticated } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.pipelineTrace(traceId ?? ''),
    queryFn: () => {
      if (!traceId) throw new Error('Trace ID is required')
      return pipelineDebugService.fetchPipelineTrace(traceId, fetchWithAuth)
    },
    enabled: isAuthenticated && !!traceId,
    ...syncDataOptions, // Traces are write-once, safe to cache long
  })
}

/**
 * Hook to fetch all traces for a specific camper across all runs.
 */
export function usePipelineTracesByCamper(cmId: number | null) {
  const { fetchWithAuth, isAuthenticated } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.pipelineTracesByCamper(cmId ?? 0),
    queryFn: () => {
      if (!cmId) throw new Error('CampMinder ID is required')
      return pipelineDebugService.fetchTracesByCamper(cmId, fetchWithAuth)
    },
    enabled: isAuthenticated && !!cmId,
    ...syncDataOptions, // Traces are write-once, safe to cache long
  })
}
