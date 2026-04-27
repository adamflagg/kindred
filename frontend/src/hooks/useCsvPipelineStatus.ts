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

export function pollIntervalForPhase(phase: PipelinePhase['phase'] | undefined): number | false {
  return phase === 'importing' || phase === 'matching' ? ACTIVE_POLL_MS : false
}

export function useCsvPipelineStatus() {
  const { fetchWithAuth } = useApiWithAuth()

  return useQuery<PipelinePhase>({
    queryKey: queryKeys.csvPipelineStatus(),
    queryFn: async () => {
      const [syncResult, debugResult] = await Promise.allSettled([
        fetchSyncStatus(fetchWithAuth),
        fetchLatestDebugRun(fetchWithAuth),
      ])
      if (syncResult.status === 'rejected') throw syncResult.reason
      const debug = debugResult.status === 'fulfilled' ? debugResult.value : null
      return derivePhase(syncResult.value, debug)
    },
    refetchInterval: (q) => pollIntervalForPhase(q.state.data?.phase),
    staleTime: STALE_TIME_MS,
  })
}
