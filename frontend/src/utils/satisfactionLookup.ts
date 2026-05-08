/**
 * Build a per-row satisfaction lookup from `/api/satisfaction`'s per_request
 * array. Used by `CamperDetail` and `CamperDetailsPanel` Path 2 (persisted
 * state) to surface tooltip strings on the Met/Unmet pill without re-running
 * the predicate client-side.
 *
 * Surfaces backend-supplied detail for every row that the API returned —
 * including the unassigned-camper case, where every row reads as
 * `(satisfied=false, detail="Requester not assigned")`. Earlier inline
 * implementations in CamperDetail / CamperDetailsPanel short-circuited to
 * `{satisfied: null, detail: null}` whenever the camper had no assignment,
 * which suppressed these legitimate API-provided strings.
 */

import type { PerRequestStatus, RequestBucket, SatisfactionEntry } from '../types/satisfaction'
import { isAgePreferenceSatisfied } from './agePreferenceSatisfaction'
import { formatGradeOrdinal } from './gradeUtils'
import { safeSourceFromField } from './sourceFromField'
import type { EnhancedBunkRequest } from '../hooks/camper/useAllBunkRequests'

export function buildSatisfactionLookup(
  perRequest: PerRequestStatus[]
): (id: string) => SatisfactionEntry {
  const byId = new Map(perRequest.map((p) => [p.request_id, p]))
  return (id: string) => {
    const entry = byId.get(id)
    if (!entry) return { satisfied: null, detail: null }
    return { satisfied: entry.satisfied, detail: entry.detail ?? null }
  }
}

/**
 * Per-request satisfaction predicate — TypeScript counterpart of
 * `bunking.satisfaction.predicate.evaluate_request`.
 *
 * Used only by the drag-preview path (`CamperDetailsPanel` Path 1), which
 * needs synchronous client-local evaluation against an in-memory bunk
 * assignment that has not been persisted yet. The persisted-state path
 * (`/api/satisfaction`) does not call this function.
 *
 * Drift between this implementation and the Python counterpart is guarded
 * by `satisfactionLookup.parity.test.ts` + `test_predicate_parity.py`,
 * which both load `bunking/satisfaction/test_fixtures/predicate_cases.json`.
 *
 * The 4-state `SatisfactionStatus` enum is intentional: `'unknown'` lets the
 * call-site adapter render no pill (drag preview) for cases the persisted
 * path would render as a red pill (`/api/satisfaction` returns
 * `satisfied=false, detail="Requester not assigned"`). See the call site at
 * `CamperDetailsPanel.tsx` for the adapter.
 *
 * Detail-string parity caveats (see fixture top-of-file comment):
 * - bunk_with / not_bunk_with: detail strings match Python exactly.
 * - age_preference: TS prefixes detail with a bunk-grade breakdown
 *   ("Bunk: 5th: 2 | 6th: 1 — ...") for the drag-preview tooltip; Python
 *   returns the raw `is_age_preference_satisfied` detail. The parity
 *   fixture asserts only `satisfied` for age_preference cases.
 */

export type SatisfactionStatus = 'satisfied' | 'not_satisfied' | 'checking' | 'unknown'

export interface SatisfactionResult {
  status: SatisfactionStatus
  detail?: string
}

export interface BunkmateInfo {
  cmId: number
  grade: number | null
}

export interface EvaluateRequestInputs {
  request: EnhancedBunkRequest
  /** Requester's bunk in the active view; null = unassigned */
  requesterBunkCmId: number | null
  /** Roster of the requester's bunk, EXCLUDING the requester themselves */
  requesterBunkmates: BunkmateInfo[]
  /**
   * Target's bunk in the active view; null = unassigned. Only consulted for
   * `bunk_with` / `not_bunk_with`. Caller resolves the lookup before calling.
   */
  targetBunkCmId: number | null
  requesterGrade: number | null
}

export function evaluateRequest({
  request,
  requesterBunkCmId,
  requesterBunkmates,
  targetBunkCmId,
  requesterGrade,
}: EvaluateRequestInputs): SatisfactionResult {
  if (requesterBunkCmId == null) {
    return { status: 'unknown', detail: 'Requester not assigned' }
  }

  if (request.request_type === 'bunk_with' && request.requestee_id && request.requestee_id > 0) {
    if (targetBunkCmId == null) {
      return { status: 'not_satisfied', detail: 'Target not assigned' }
    }
    const sameBunk = targetBunkCmId === requesterBunkCmId
    return sameBunk
      ? { status: 'satisfied', detail: 'Same bunk' }
      : { status: 'not_satisfied', detail: 'Different bunks' }
  }

  if (
    request.request_type === 'not_bunk_with' &&
    request.requestee_id &&
    request.requestee_id > 0
  ) {
    if (targetBunkCmId == null) {
      return { status: 'satisfied', detail: 'Target not assigned' }
    }
    const sameBunk = targetBunkCmId === requesterBunkCmId
    return sameBunk
      ? { status: 'not_satisfied', detail: 'Same bunk (conflict!)' }
      : { status: 'satisfied', detail: 'Different bunks' }
  }

  if (request.request_type === 'age_preference' && request.age_preference_target) {
    if (requesterGrade == null) {
      return { status: 'unknown', detail: 'No grade on file' }
    }
    const bunkmateGrades = requesterBunkmates
      .map((b) => b.grade)
      .filter((g): g is number => g != null)
    if (bunkmateGrades.length === 0) {
      return { status: 'not_satisfied', detail: 'No bunkmates assigned yet' }
    }
    const preference = request.age_preference_target as 'older' | 'younger'
    const { satisfied, detail } = isAgePreferenceSatisfied(
      requesterGrade,
      bunkmateGrades,
      preference
    )
    const gradeCounts = new Map<number, number>()
    for (const g of bunkmateGrades) {
      gradeCounts.set(g, (gradeCounts.get(g) ?? 0) + 1)
    }
    const breakdown = Array.from(gradeCounts.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([g, c]) => `${formatGradeOrdinal(g)}: ${c}`)
      .join(' | ')
    return {
      status: satisfied ? 'satisfied' : 'not_satisfied',
      detail: `Bunk: ${breakdown} — ${detail}`,
    }
  }

  return { status: 'unknown' }
}

/**
 * Resolve the P/S age-preference badge state for a request row (#1172).
 *
 * The centralized aggregator (`CamperSatisfaction.per_request[i].bucket`) is
 * the source of truth when present — that's what #1158/#1159 consolidated.
 * When the aggregator is unavailable (`/api/satisfaction` 500, empty response,
 * loading state), bucket is `undefined` and the badge silently disappears
 * unless we fall back to the row's own `source_field`/`source` — which is
 * what drove the badge pre-#1158 and cannot fail.
 *
 * Centralized bucket wins; row-level fields are ONLY consulted when the
 * centralized map has no entry for this row.
 */
export function resolveBadgeBucket(
  bucket: RequestBucket | undefined,
  req: { source_field?: string | null; request_type?: string | null }
): { isMaterialAgePref: boolean; isStaffBadge: boolean } {
  if (bucket === 'material_parent') return { isMaterialAgePref: true, isStaffBadge: false }
  if (bucket === 'staff') return { isMaterialAgePref: false, isStaffBadge: true }
  if (bucket === undefined) {
    return {
      isMaterialAgePref: req.request_type === 'age_preference' && req.source_field === 'bunk_with',
      isStaffBadge: safeSourceFromField(req.source_field) === 'staff',
    }
  }
  return { isMaterialAgePref: false, isStaffBadge: false }
}
