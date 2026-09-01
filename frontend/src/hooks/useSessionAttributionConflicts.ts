/**
 * Occupancy evidence for the cabin-weekend attribution queue — one read of
 * `GET /api/lodging/attribution/conflicts`, keyed by the queue row each row
 * annotates.
 *
 * §12.8 of the round-2 triage-attack master plan, owner-designed and
 * owner-ruled 2026-08-31. It closes no issue and none is filed, deliberately.
 *
 * ITS OWN HOOK, not a fourth query inside `useSessionAttributionQueue`, for
 * the reason the caching note below gives: this is the only query on this
 * surface that must never be served from cache, and burying that rule inside a
 * hook whose other three queries are ordinary is how it would quietly be
 * "tidied" into `userDataOptions` alongside them.
 *
 * ⚠️ DELIBERATELY UNCACHED — `staleTime: 0`, `gcTime: 0`.
 *
 * `frontend/CLAUDE.md` warns that opting DOWN to a short staleTime to catch
 * external edits is the trap, and it is right about the case it describes:
 * freshness after a write is bought with explicit invalidation in the
 * mutation, not with a TTL. This is the other case. The endpoint is uncached
 * at every layer it passes through, for two reasons the server states in its
 * own docstring — staff flip `is_resolved` straight against PocketBase, and
 * the answer reads LIVE WRITE-INS, which the weekend board writes directly
 * through `lodging_write_service.py`. The board is a different surface with a
 * different query client instance in a different tab; no invalidation this
 * surface performs can reach it. A client TTL would therefore reintroduce
 * exactly what the server refused: a staff member who has just emptied a cabin
 * on the board, then switched to the queue, would be told the cabin is taken
 * and would demote the right weekend on it.
 *
 * The cost is bounded and was checked before choosing it: `build_conflicts`
 * answers an EMPTY QUEUE — the normal state for most of the year — in exactly
 * one read, and reads once per candidate WEEKEND rather than once per queue
 * row, so the eight live 2026 rows cost a handful of session-scoped reads.
 * `gcTime: 0` matters for the board's modal: keeping the answer would show the
 * second open a verdict computed before the first one's confirm.
 *
 * ⚠️ FETCHED WHERE IT IS DRAWN, WHICH IS WHY `enabled` IS A PARAMETER. The
 * board mounts this transitively for the whole session — `CabinWeekendEntry`
 * renders a COUNT and no verdict, and it renders `CabinWeekendModal`
 * unconditionally, toggling `isOpen`. Left on for those two, an uncached
 * refetch-on-focus query would re-pay `build_conflicts` (a read per candidate
 * WEEKEND on top of four year-scoped ones) on every board load and every
 * alt-tab back, for a value nothing on the board reads; and since the endpoint
 * is `bunking.manage`-gated, a viewer without that permission would spend a
 * guaranteed 403 on each one. Both call sites therefore pass `evidence: false`
 * until something is actually going to draw a verdict — which also makes the
 * `gcTime: 0` note above true as written, since the modal's query now really
 * does start clean on each open.
 *
 * DEGRADES, NEVER BLOCKS. A failure here is returned rather than thrown and no
 * caller gates `QueryGuard` on it: the queue tells staff which cabins are
 * waiting, which is useful with no verdicts on it at all, and holding the
 * whole surface on an enrichment would be the strictly worse trade.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import {
  rowEvidenceByIssueId,
  type AttributionRowEvidence,
} from '../components/admin/lodging/attributionEvidence'
import { fetchSessionAttributionConflicts } from '../services/lodgingApi'
import { queryKeys } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'
import { useYear } from './useCurrentYear'

export interface UseSessionAttributionConflictsResult {
  /** Evidence per `lodging_ingest_issues` id. Empty while pending or failed. */
  byIssueId: Map<string, AttributionRowEvidence>
  isLoading: boolean
  error: Error | null
}

/**
 * @param enabled - false for a caller that draws no verdict (see the module
 * doc). The query does not run, and `byIssueId` stays empty — the same
 * degraded shape a pending or failed fetch already produces, so no caller
 * needs a second code path for it.
 */
export function useSessionAttributionConflicts(
  enabled = true
): UseSessionAttributionConflictsResult {
  const currentYear = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  // CurrentYearContext returns the literal 0 until the backend supplies the
  // configured year, and the endpoint rejects it (`ge=2000`), so the query
  // waits rather than spending a 422 on every mount.
  const yearReady = currentYear > 0

  const conflictsQuery = useQuery({
    queryKey: queryKeys.sessionAttributionConflicts(currentYear),
    queryFn: () => fetchSessionAttributionConflicts(fetchWithAuth, currentYear),
    enabled: yearReady && enabled,
    staleTime: 0,
    gcTime: 0,
    // The queue and the board are two surfaces staff move between, and the
    // board is where the write-ins this answer reads get written. Returning to
    // the queue is the moment a stale verdict would be acted on.
    refetchOnWindowFocus: true,
  })

  const { data } = conflictsQuery
  const byIssueId = useMemo(() => rowEvidenceByIssueId(data), [data])

  return { byIssueId, isLoading: conflictsQuery.isLoading, error: conflictsQuery.error }
}
