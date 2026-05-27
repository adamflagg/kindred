import { useQuery } from '@tanstack/react-query'
import { useApiWithAuth } from '../useApiWithAuth'
import {
  fetchLatestUploadRun,
  countsFromStatusBreakdown,
  type UploadCounts,
} from '../../services/csvPipelineStatus'
import { queryKeys } from '../../utils/queryKeys'

export interface LastUploadSummary {
  runId: string | null
  finishedAt: string | null
  global: UploadCounts | null
  session: UploadCounts | null
}

/**
 * Returns the latest CSV-upload run's global + per-session "what's new" counts.
 *
 * The bunks page aggregates a session WITH its related AG (all-gender) sessions,
 * which have distinct `session_cm_id`s — so this hook sums the viewed session's
 * cm_id PLUS its AG session cm_ids out of `session_breakdown`.
 *
 * Returns `session: null` when none of those keys are present or the summed
 * total is 0 (this drives "hide the chip when nothing new").
 */
export function useLastUploadSummary(
  sessionCmId: number | undefined,
  agSessionCmIds: number[] = []
): LastUploadSummary {
  const { fetchWithAuth } = useApiWithAuth()
  const { data } = useQuery({
    queryKey: queryKeys.lastUploadSummary(),
    queryFn: () => fetchLatestUploadRun(fetchWithAuth),
    staleTime: 30_000,
  })

  if (!data) return { runId: null, finishedAt: null, global: null, session: null }

  const global = countsFromStatusBreakdown(data.status_breakdown)

  const keys = [sessionCmId, ...agSessionCmIds].filter((k): k is number => typeof k === 'number')
  const sb = data.session_breakdown ?? {}
  const acc = { resolved: 0, pending: 0, declined: 0 }
  let hit = false
  for (const k of keys) {
    const slice = sb[String(k)]
    if (slice) {
      hit = true
      acc.resolved += slice.resolved
      acc.pending += slice.pending
      acc.declined += slice.declined
    }
  }
  const sessionCounts = countsFromStatusBreakdown(acc)
  const session = hit && sessionCounts.total > 0 ? sessionCounts : null

  return { runId: data.run_id, finishedAt: data.created, global, session }
}
