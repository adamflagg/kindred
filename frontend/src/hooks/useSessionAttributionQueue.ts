/**
 * The cabin-weekend attribution queue (kindred#2648 UI half) — one fetch of
 * `lodging_ingest_issues` filtered to `kind = "ambiguous_session"`, enriched
 * with alias-resolved unit names and labeled candidate weekends, plus the
 * one-time confirm mutation.
 *
 * Extracted because it has TWO consumers per the approved design: the admin
 * queue tab (always-accessible home) and the board's stats-bar chip modal.
 * Both need the same rows, the same alias resolution and the same confirm
 * write — see `frontend/CLAUDE.md`'s "extract once a query has 2+ consumers"
 * rule.
 *
 * THREE queries compose here. Only the primary queue query gates
 * `isLoading`/`error` for `QueryGuard` purposes; a failed alias or session
 * fetch degrades the RENDER (no resolved unit name, a numeric weekend label)
 * rather than blocking it — mirroring `UnresolvedAliasQueue`'s own units-query
 * degradation, since knowing which raw values are waiting is useful even when
 * the enrichment failed.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import toast from 'react-hot-toast'

import {
  confirmSessionAttribution as confirmSessionAttributionCrud,
  listAmbiguousSessionIssues,
  listLodgingAliases,
} from '../services/lodgingCrud'
import { fetchWeekendSessions } from '../services/lodgingApi'
import {
  computeStaleQueueIds,
  resolveCabinAlias,
} from '../components/weekend/sessionAttributionMatch'
import type { LodgingIngestIssueRecord, WeekendSessionList } from '../types/lodging'
import { invalidateLodgingRegistryQueries, queryKeys, userDataOptions } from '../utils/queryKeys'
import { shortWeekendName } from '../components/weekend/weekendNames'
import { formatSessionDates } from '../components/weekend/sessionDates'
import { useApiWithAuth } from './useApiWithAuth'
import { useYear } from './useCurrentYear'

/** One weekend this row's household or person could belong to. */
export interface SessionAttributionCandidate {
  sessionCmId: number
  /** `shortWeekendName`, or `#<cm_id>` when the id isn't in the fetched session list. */
  short: string
  dateRange: string
  /**
   * True for the candidate the backend's `AttributeSession` timing heuristic
   * (`suggested_session`) points at. Pre-selects in the confirm UI; per the
   * approved design it never auto-commits.
   */
  isSuggested: boolean
}

/** One enriched row of the attribution queue. */
export interface SessionAttributionQueueItem {
  id: string
  rawValue: string
  sourceField: string
  householdCmId: number
  personCmId: number
  occurrences: number
  firstSeen: string
  lastSeen: string
  /** Alias-resolved unit name(s) `rawValue` denotes. `[]` if unrecognized. */
  resolvedUnitNames: string[]
  candidates: SessionAttributionCandidate[]
  /** See `computeStaleQueueIds` — hidden by default in the queue UI. */
  isStale: boolean
}

export interface UseSessionAttributionQueueResult {
  isLoading: boolean
  error: Error | null
  /** `undefined` until the primary queue query settles — for `QueryGuard`. */
  data: SessionAttributionQueueItem[] | undefined
  /** `data ?? []` — the coercion every render site would otherwise repeat. */
  items: SessionAttributionQueueItem[]
  /**
   * Confirm `item` for `sessionCmId`. `sessionCmId` MUST be one of the row's
   * own `candidates` — the backend refuses anything else and leaves the row
   * unplaced and re-opened, so this is never called with an arbitrary id.
   */
  confirm: (item: SessionAttributionQueueItem, sessionCmId: number) => void
  isConfirming: boolean
}

function buildItem(
  row: LodgingIngestIssueRecord,
  aliases: Awaited<ReturnType<typeof listLodgingAliases>>,
  sessions: WeekendSessionList | undefined,
  staleIds: Set<string>
): SessionAttributionQueueItem {
  const suggestedCmId = sessions?.sessions?.find(
    (s) => s.session_id === row.suggested_session
  )?.session_cm_id

  const candidates: SessionAttributionCandidate[] = row.candidate_session_cm_ids.map((cmId) => {
    const session = sessions?.sessions?.find((s) => s.session_cm_id === cmId)
    return {
      sessionCmId: cmId,
      short: session ? shortWeekendName(session.name) : `#${String(cmId)}`,
      dateRange: session ? formatSessionDates(session.start_date, session.end_date) : '',
      isSuggested: suggestedCmId !== undefined && suggestedCmId === cmId,
    }
  })

  return {
    id: row.id,
    rawValue: row.raw_value,
    sourceField: row.source_field,
    householdCmId: row.household_cm_id,
    personCmId: row.person_cm_id,
    occurrences: row.occurrences,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    resolvedUnitNames: resolveCabinAlias(row.raw_value, aliases),
    candidates,
    isStale: staleIds.has(row.id),
  }
}

export function useSessionAttributionQueue(): UseSessionAttributionQueueResult {
  const currentYear = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  // CurrentYearContext returns the literal 0 until the backend supplies the
  // configured year; PocketBase answers `year = 0` with a successful `200 []`
  // rather than an error, so every query below is gated on this.
  const yearReady = currentYear > 0

  const queueQuery = useQuery({
    queryKey: queryKeys.sessionAttributionQueue(currentYear),
    ...userDataOptions,
    queryFn: () => listAmbiguousSessionIssues(currentYear),
    enabled: yearReady,
  })

  const aliasesQuery = useQuery({
    queryKey: queryKeys.lodgingAliases(),
    ...userDataOptions,
    queryFn: listLodgingAliases,
    enabled: yearReady,
  })

  const sessionsQuery = useQuery({
    queryKey: queryKeys.weekendSessions(currentYear),
    queryFn: () => fetchWeekendSessions(fetchWithAuth, currentYear),
    enabled: yearReady,
  })

  // Only the PRIMARY query's pending state blocks rendering — see module doc.
  // aliasesQuery/sessionsQuery are deliberately excluded: their own pending
  // or failed state degrades the RENDER (buildItem's fallbacks below), it
  // must not hold QueryGuard on a spinner once the queue's own rows are in.
  const isLoading = queueQuery.isLoading || !yearReady

  const rows = queueQuery.data
  const aliases = aliasesQuery.data ?? []
  const staleIds = rows ? computeStaleQueueIds(rows) : new Set<string>()
  const data = rows?.map((row) => buildItem(row, aliases, sessionsQuery.data, staleIds))

  interface ConfirmVars {
    id: string
    sessionCmId: number
    /** The candidate's own label, so the success toast names the weekend. */
    short: string
  }

  const confirmMutation = useMutation({
    mutationFn: ({ id, sessionCmId }: ConfirmVars) =>
      confirmSessionAttributionCrud(id, sessionCmId),
    onSuccess: (_result, vars: ConfirmVars) => {
      toast.success(`Confirmed — placed for ${vars.short}`)
      invalidateLodgingRegistryQueries(queryClient)
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const { mutate } = confirmMutation
  const confirm = useCallback(
    (item: SessionAttributionQueueItem, sessionCmId: number) => {
      const candidate = item.candidates.find((c) => c.sessionCmId === sessionCmId)
      mutate({ id: item.id, sessionCmId, short: candidate?.short ?? `#${String(sessionCmId)}` })
    },
    [mutate]
  )

  return {
    isLoading,
    error: queueQuery.error,
    data,
    items: data ?? [],
    confirm,
    isConfirming: confirmMutation.isPending,
  }
}
