/**
 * React Query hook for pipeline debug summary (batch list).
 *
 * Fetches ALL rows for a run in a single request (`fetch_all=true`). The
 * queryKey is intentionally stable — only `(runId)` — so the list isn't
 * refetched when the user types in the search box, sorts, or changes a
 * filter. Filtering/sorting/searching happen client-side in
 * `PipelineBatchList`.
 */

import { useQuery } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import { queryKeys, userDataOptions } from '../utils/queryKeys'
import { pipelineDebugService } from '../services/pipelineDebug'

/** Hook to fetch every summary row for a pipeline run. */
export function usePipelineSummary(runId: string | null) {
  const { fetchWithAuth, isAuthenticated } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.pipelineSummary(runId ?? ''),
    queryFn: () => {
      if (!runId) throw new Error('Run ID is required')
      return pipelineDebugService.fetchPipelineSummary(runId, fetchWithAuth)
    },
    enabled: isAuthenticated && !!runId,
    ...userDataOptions,
  })
}
