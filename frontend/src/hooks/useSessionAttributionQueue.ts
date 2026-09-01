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
 * FOUR queries compose here. Only the primary queue query gates
 * `isLoading`/`error` for `QueryGuard` purposes; a failed alias, session or
 * occupancy-evidence fetch degrades the RENDER (no resolved unit name, a
 * numeric weekend label, no conflict verdicts) rather than blocking it —
 * mirroring `UnresolvedAliasQueue`'s own units-query degradation, since
 * knowing which raw values are waiting is useful even when the enrichment
 * failed.
 *
 * The fourth is the occupancy evidence of §12.8 (`useSessionAttributionConflicts`),
 * which answers the question `AttributeSession`'s timestamp cannot: is the
 * cabin already occupied in each candidate weekend, and by whom. It is the
 * only one of the four that is never cached.
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
import type {
  AttributionVerdictValue,
  LodgingIngestIssueRecord,
  WeekendSessionList,
} from '../types/lodging'
import type {
  AttributionRowEvidence,
  SessionAttributionOccupant,
} from '../components/admin/lodging/attributionEvidence'
import { invalidateLodgingRegistryQueries, queryKeys, userDataOptions } from '../utils/queryKeys'
import { shortWeekendName } from '../components/weekend/weekendNames'
import { formatSessionDates } from '../components/weekend/sessionDates'
import { useApiWithAuth } from './useApiWithAuth'
import { useSessionAttributionConflicts } from './useSessionAttributionConflicts'
import { useYear } from './useCurrentYear'

/** One weekend this row's household or person could belong to. */
export interface SessionAttributionCandidate {
  sessionCmId: number
  /** `shortWeekendName`, or `#<cm_id>` when the id isn't in the fetched session list. */
  short: string
  dateRange: string
  /**
   * True for the row's best guess. Pre-marks it in the confirm UI; per the
   * approved design it never auto-commits.
   *
   * ⭐ THIS IS A BOARD COMPARISON NOW, not only a date. #2650 shipped this
   * field pointing at `AttributeSession`'s `last_updated` heuristic alone, and
   * deliberately hedged the copy around it because that signal has no
   * per-household resolution: the 2026 snapshot's 136 cabin values carry seven
   * distinct `last_updated` days, 83% of them on two, so the timestamp records
   * when staff did a bulk pass over a whole weekend rather than when one
   * household's cabin was set. §12.8 supplies the signal that was missing —
   * whether the cabin is ALREADY OCCUPIED in each candidate weekend, read off
   * the live board — and this field now follows the conflict-aware answer
   * whenever that evidence has loaded, falling back to the stored timestamp
   * pick when it has not.
   *
   * Nobody is marked when every candidate conflicts: the alarm says no weekend
   * is a safe guess, and a "best guess" pill beside it would contradict it.
   */
  isSuggested: boolean
  /**
   * This weekend's occupancy verdict, `undefined` until (or unless) the
   * conflicts endpoint answers. Undefined is the DEGRADED render — the queue
   * is useful without verdicts and must not wait on them.
   */
  verdict?: AttributionVerdictValue | undefined
  /**
   * Who the board already has in the cabin that weekend. Non-empty on a `free`
   * verdict too — a shareable leaf with room left holds another party without
   * conflicting.
   */
  occupants?: SessionAttributionOccupant[] | undefined
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
  /**
   * Every candidate weekend conflicts. DEMOTES NOTHING (§12.8.3): it is an
   * alarm about the cabin VALUE, since moving the guess would move it onto a
   * weekend the rule has just called wrong. `undefined` until the evidence
   * loads.
   */
  conflictInEveryCandidate?: boolean | undefined
  /**
   * Set only when a conflict moved the best guess off the date heuristic's
   * pick, carrying BOTH weekends' labels — which is why the endpoint publishes
   * both suggestions rather than only the one it prefers. Without the "from"
   * half the row would silently disagree with the `suggested_session`
   * PocketBase still stores.
   */
  demotion?: { fromShort: string; toShort: string } | undefined
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
  staleIds: Set<string>,
  evidence: AttributionRowEvidence | undefined
): SessionAttributionQueueItem {
  const suggestedCmId = sessions?.sessions?.find(
    (s) => s.session_id === row.suggested_session
  )?.session_cm_id

  // THE CONFLICT-AWARE PICK WINS once the evidence has loaded — occupancy
  // outranks the timestamp (owner ruling 1), and it is the same
  // `AttributeSession` rule run over the weekends that survive the conflict
  // check rather than a second heuristic. Falls back to the stored pick while
  // the evidence is pending or failed, so the row never loses its best guess
  // waiting on an enrichment.
  //
  // NOBODY is the best guess when every candidate conflicts: that case demotes
  // nothing (§12.8.3) and raises an alarm saying no weekend is a safe guess —
  // a "best guess" pill beside that would contradict it.
  const bestGuessCmId = evidence
    ? evidence.conflictInEveryCandidate
      ? undefined
      : evidence.suggestedSessionCmId
    : suggestedCmId

  const candidates: SessionAttributionCandidate[] = row.candidate_session_cm_ids.map((cmId) => {
    const session = sessions?.sessions?.find((s) => s.session_cm_id === cmId)
    const candidateEvidence = evidence?.byCandidate.get(cmId)
    return {
      sessionCmId: cmId,
      short: session ? shortWeekendName(session.name) : `#${String(cmId)}`,
      dateRange: session ? formatSessionDates(session.start_date, session.end_date) : '',
      isSuggested: bestGuessCmId !== undefined && bestGuessCmId === cmId,
      // Spread rather than assigned undefined: `exactOptionalPropertyTypes` is
      // on, and "no evidence yet" is the ABSENCE of the key, not a key holding
      // undefined.
      ...(candidateEvidence === undefined
        ? {}
        : { verdict: candidateEvidence.verdict, occupants: candidateEvidence.occupants }),
    }
  })

  const shortOf = (cmId: number): string =>
    candidates.find((candidate) => candidate.sessionCmId === cmId)?.short ?? `#${String(cmId)}`

  // BOTH weekends, which is why the endpoint publishes both suggestions. The
  // `from` half is the `suggested_session` PocketBase still stores unchanged;
  // without naming it the row would silently disagree with its own record.
  const demotion =
    evidence?.demotionApplied === true &&
    evidence.suggestedSessionCmId !== undefined &&
    evidence.timestampSessionCmId !== undefined
      ? {
          fromShort: shortOf(evidence.timestampSessionCmId),
          toShort: shortOf(evidence.suggestedSessionCmId),
        }
      : undefined

  return {
    conflictInEveryCandidate: evidence?.conflictInEveryCandidate,
    demotion,
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

  // The FOURTH query, and the only uncached one — see
  // `useSessionAttributionConflicts` for why it may never be served from
  // cache. Like the two above it, its pending or failed state degrades the
  // RENDER (no verdicts, no banners) rather than blocking it.
  const { byIssueId: evidenceByIssueId } = useSessionAttributionConflicts()

  // Only the PRIMARY query's pending state blocks rendering — see module doc.
  // aliasesQuery/sessionsQuery are deliberately excluded: their own pending
  // or failed state degrades the RENDER (buildItem's fallbacks below), it
  // must not hold QueryGuard on a spinner once the queue's own rows are in.
  const isLoading = queueQuery.isLoading || !yearReady

  const rows = queueQuery.data
  const aliases = aliasesQuery.data ?? []
  const staleIds = rows ? computeStaleQueueIds(rows) : new Set<string>()
  const data = rows?.map((row) =>
    buildItem(row, aliases, sessionsQuery.data, staleIds, evidenceByIssueId.get(row.id))
  )

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
