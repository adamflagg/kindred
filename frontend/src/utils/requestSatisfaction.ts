/**
 * Per-request satisfaction — frontend decision tree.
 *
 * @deprecated TODO(#1155) — eliminate after OpenAPI codegen lands.
 *
 * Sole remaining consumer of `computeRequestSatisfaction`:
 * `CamperDetailsPanel.tsx` Path 1 (`hasClientView` draft drag preview),
 * which needs synchronous predicate evaluation against an in-memory bunk
 * assignment map that has not been persisted to PB yet.
 *
 * Path 2 (persisted state) was migrated to `/api/satisfaction` via
 * `BunkRequestProvider.getSatisfiedRequestInfo` (PR #1158/#1160). The
 * `useSatisfactionData` hook that previously called this util is gone.
 *
 * A server-side `POST /api/satisfaction/preview` endpoint was considered
 * during the #1160 brainstorm but rejected: a network round-trip per drag
 * interaction would be a real UX regression for what is today a 0ms
 * client-local computation.
 *
 * When #1155 (OpenAPI codegen) lands, re-evaluate: either (a) generate a
 * matching TS predicate from `bunking.satisfaction.predicate.evaluate_request`
 * to keep the synchronous local path, or (b) revisit the server-preview
 * endpoint approach.
 *
 * The canonical Python implementation is
 * `bunking.satisfaction.predicate.evaluate_request` (returns
 * `(satisfied, detail)`). The bool projection
 * `is_request_satisfied` is preserved for the solver hot path.
 *
 * Keep this in sync with the Python implementation manually until #1155
 * (FastAPI OpenAPI codegen) replaces both with generated types and a
 * single authoritative call path.
 *
 * The decision tree here MUST match `BunkRequestProvider.getSatisfiedRequestInfo`'s
 * implicit per-request logic so the orange-triangle alert on the bunking-board
 * card and the Met/Unmet pill in the modal never disagree.
 */
import { isAgePreferenceSatisfied } from './agePreferenceSatisfaction'
import { formatGradeOrdinal } from './gradeUtils'
import { safeSourceFromField } from './sourceFromField'
import type { EnhancedBunkRequest } from '../hooks/camper/useAllBunkRequests'
import type { SatisfactionResult } from '../hooks/camper/types'
import type { RequestBucket } from '../types/satisfaction'

export interface BunkmateInfo {
  cmId: number
  grade: number | null
}

export interface ComputeRequestSatisfactionInputs {
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

export function computeRequestSatisfaction({
  request,
  requesterBunkCmId,
  requesterBunkmates,
  targetBunkCmId,
  requesterGrade,
}: ComputeRequestSatisfactionInputs): SatisfactionResult {
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
  req: { source_field?: string | null; source?: string | null; request_type?: string | null }
): { isMaterialAgePref: boolean; isStaffBadge: boolean } {
  if (bucket === 'material_parent') return { isMaterialAgePref: true, isStaffBadge: false }
  if (bucket === 'staff') return { isMaterialAgePref: false, isStaffBadge: true }
  if (bucket === undefined) {
    // The P badge is for parent age preferences only — a regular bunk_with row also
    // has source_field='bunk_with' but isn't a parent badge. Restrict the fallback
    // to age_preference rows, matching the pre-#1158 inline logic.
    const derived = safeSourceFromField(req.source_field)
    return {
      isMaterialAgePref: req.request_type === 'age_preference' && req.source_field === 'bunk_with',
      isStaffBadge: derived !== null ? derived === 'staff' : req.source === 'staff',
    }
  }
  // bucket === 'immaterial_parent' → no badges (best-effort socialize_with).
  return { isMaterialAgePref: false, isStaffBadge: false }
}
