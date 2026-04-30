import { useQuery } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import {
  CSV_UPLOAD_PROXIMITY_MS,
  CSV_UPLOAD_STORAGE_KEY,
  derivePhase,
  fetchLatestDebugRun,
  fetchSyncStatus,
  type PipelinePhase,
} from '../services/csvPipelineStatus'
import { queryKeys } from '../utils/queryKeys'

const ACTIVE_POLL_MS = 2000
const STALE_TIME_MS = 1500

function readCsvUploadMarker(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(CSV_UPLOAD_STORAGE_KEY)
}

// Marker is "recent" while it is still within the attribution proximity window.
// Sharing the same constant as derivePhase prevents the poll window and the
// attribution window from drifting apart.
function uploadMarkerIsRecent(marker: string | null): boolean {
  if (!marker) return false
  const ts = new Date(marker).getTime()
  if (Number.isNaN(ts)) return false
  return Date.now() - ts < CSV_UPLOAD_PROXIMITY_MS
}

export function pollIntervalForPhase(phase: PipelinePhase['phase'] | undefined): number | false {
  if (phase === 'importing' || phase === 'matching') return ACTIVE_POLL_MS
  // Only poll on idle (waiting for the sync to start). Done/error are terminal —
  // continued polling there would burn requests for no benefit and could
  // re-attribute a later cron sync to a stale marker.
  if (phase === 'idle' && uploadMarkerIsRecent(readCsvUploadMarker())) return ACTIVE_POLL_MS
  return false
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
      return derivePhase(syncResult.value, debug, readCsvUploadMarker())
    },
    refetchInterval: (q) => pollIntervalForPhase(q.state.data?.phase),
    staleTime: STALE_TIME_MS,
  })
}
