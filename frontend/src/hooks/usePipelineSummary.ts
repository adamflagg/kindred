/**
 * React Query hook for pipeline debug summary (batch list).
 */

import { useQuery } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import { queryKeys, userDataOptions } from '../utils/queryKeys'
import { pipelineDebugService } from '../services/pipelineDebug'
import type { PipelineSummaryFilters } from '../components/pipeline-debug/types'

/**
 * Hook to fetch summary rows for a specific pipeline run.
 * Supports PB-native filtering, sorting, and pagination.
 */
export function usePipelineSummary(runId: string | null, filters: PipelineSummaryFilters = {}) {
  const { fetchWithAuth, isAuthenticated } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.pipelineSummary(runId ?? '', filters as Record<string, unknown>),
    queryFn: () => {
      if (!runId) throw new Error('Run ID is required')
      return pipelineDebugService.fetchPipelineSummary(runId, filters, fetchWithAuth)
    },
    enabled: isAuthenticated && !!runId,
    ...userDataOptions,
  })
}
