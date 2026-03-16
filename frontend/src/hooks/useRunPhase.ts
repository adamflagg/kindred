/**
 * React Query mutation hooks for on-demand pipeline phase execution.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import { queryKeys } from '../utils/queryKeys'
import { pipelineDebugService } from '../services/pipelineDebug'
import type {
  PipelinePhase,
  RunFromPhaseRequest,
  RunFullTraceRequest,
} from '../components/pipeline-debug/types'

/**
 * Hook to cascade from a specified phase through all remaining phases.
 * Creates a new trace with fresh data from the starting phase onward.
 * Invalidates pipeline queries on success.
 */
export function useRunFromPhase() {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ phase, request }: { phase: PipelinePhase; request: RunFromPhaseRequest }) =>
      pipelineDebugService.runFromPhase(phase, request, fetchWithAuth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pipelineTracePrefix, exact: false })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pipelineSummaryPrefix,
        exact: false,
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.pipelineRuns() })
    },
  })
}

/**
 * Hook to run the full pipeline for a single record with tracing enabled.
 * Returns the new trace ID for navigation to the drill-down view.
 * Invalidates all pipeline queries on success.
 */
export function useRunFullTrace() {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: RunFullTraceRequest) =>
      pipelineDebugService.runFullTrace(request, fetchWithAuth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pipelineTracePrefix, exact: false })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pipelineSummaryPrefix,
        exact: false,
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.pipelineRuns() })
    },
  })
}
