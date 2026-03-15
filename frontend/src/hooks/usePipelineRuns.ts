/**
 * React Query hooks for pipeline debug runs.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import { queryKeys, userDataOptions } from '../utils/queryKeys'
import { pipelineDebugService } from '../services/pipelineDebug'

/**
 * Hook to fetch the list of pipeline debug runs.
 */
export function usePipelineRuns() {
  const { fetchWithAuth, isAuthenticated } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.pipelineRuns(),
    queryFn: () => pipelineDebugService.fetchPipelineRuns(fetchWithAuth),
    enabled: isAuthenticated,
    ...userDataOptions,
  })
}

/**
 * Hook to toggle the pinned state of a pipeline run.
 * Invalidates the runs list on success.
 */
export function useToggleRunPin() {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (runId: string) => pipelineDebugService.toggleRunPin(runId, fetchWithAuth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pipelineRuns() })
    },
  })
}
