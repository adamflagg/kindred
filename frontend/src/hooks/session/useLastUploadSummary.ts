import { useQuery } from '@tanstack/react-query'
import { useApiWithAuth } from '../useApiWithAuth'
import {
  fetchLatestUploadRun,
  countsFromStatusBreakdown,
  type UploadCounts,
} from '../../services/csvPipelineStatus'
import {
  fetchSessionUploadChanges,
  countsFromUploadChangeRows,
} from '../../services/sessionUploadChanges'
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
 * which have distinct `session_cm_id`s — so this hook queries the viewed
 * session's cm_id PLUS its AG session cm_ids together.
 *
 * `global` stays trace-grain (`status_breakdown`) — unchanged by kindred#1713
 * Part 1, which is scoped to the per-session chip that disagreed with the
 * "what's new" modal. `session` is now request-grain (kindred#1713 Part 1):
 * it counts the same `debug_pipeline_summary` rows the modal lists
 * (`fetchSessionUploadChanges`, cached under the same
 * `queryKeys.sessionUploadChanges` key the modal uses), instead of the trace
 * counts in `session_breakdown`. A trace is one form-field row on one camper
 * and can expand into several final `bunk_requests`, which is exactly what
 * made the old trace-grain count an undercount — chip and modal now cannot
 * disagree, because they read the same rows.
 *
 * Returns `session: null` when the session-changes query has no rows for
 * these keys (this drives "hide the chip when nothing new").
 */
export function useLastUploadSummary(
  sessionCmId: number | undefined,
  agSessionCmIds: number[] = []
): LastUploadSummary {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()
  const { data } = useQuery({
    queryKey: queryKeys.lastUploadSummary(),
    queryFn: () => fetchLatestUploadRun(fetchWithAuth),
    staleTime: 30_000,
    enabled: !isAuthLoading,
  })

  const runId = data?.run_id ?? null
  const keys = [sessionCmId, ...agSessionCmIds].filter((k): k is number => typeof k === 'number')

  const { data: changeRows } = useQuery({
    queryKey: queryKeys.sessionUploadChanges(runId ?? '', keys),
    queryFn: () => fetchSessionUploadChanges(runId ?? '', keys, fetchWithAuth),
    // Gated on a resolved runId so this never fires with an empty-string
    // placeholder while fetchLatestUploadRun is still loading.
    enabled: !isAuthLoading && runId !== null && keys.length > 0,
  })

  if (!data) return { runId: null, finishedAt: null, global: null, session: null }

  const global = countsFromStatusBreakdown(data.status_breakdown)

  const sessionCounts = countsFromUploadChangeRows(changeRows ?? [])
  const session = sessionCounts.total > 0 ? sessionCounts : null

  return { runId: data.run_id, finishedAt: data.created, global, session }
}
