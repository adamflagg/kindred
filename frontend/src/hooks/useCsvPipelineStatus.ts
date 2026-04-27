import { useQuery } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import {
  derivePhase,
  fetchLatestDebugRun,
  fetchSyncStatus,
  type PipelinePhase,
} from '../services/csvPipelineStatus'
import { queryKeys } from '../utils/queryKeys'

const ACTIVE_POLL_MS = 2000
const STALE_TIME_MS = 1500

export function useCsvPipelineStatus() {
  const { fetchWithAuth } = useApiWithAuth()

  return useQuery<PipelinePhase>({
    queryKey: queryKeys.csvPipelineStatus(),
    queryFn: async () => {
      const [sync, debug] = await Promise.all([
        fetchSyncStatus(fetchWithAuth),
        fetchLatestDebugRun(fetchWithAuth),
      ])
      return derivePhase(sync, debug)
    },
    refetchInterval: (q) => {
      const phase = q.state.data?.phase
      return phase === 'importing' || phase === 'matching' ? ACTIVE_POLL_MS : false
    },
    staleTime: STALE_TIME_MS,
  })
}
