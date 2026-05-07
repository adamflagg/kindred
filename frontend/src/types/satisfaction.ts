/**
 * Satisfaction response types — hand-mirrored from bunking/satisfaction/api_shape.py.
 *
 * #1155 will replace this with codegen from FastAPI's OpenAPI spec. Until
 * then, keep these in sync manually with the Pydantic models. Drift between
 * the two files will cause runtime errors, not type errors.
 */

export type RequestBucket = 'material_parent' | 'immaterial_parent' | 'staff'

export interface PerRequestStatus {
  request_id: string
  bucket: RequestBucket
  satisfied: boolean
  /**
   * Short human-readable explanation suitable for a UI tooltip
   * (e.g. "Same bunk", "Different bunks", "No grade on file").
   * Mirrors bunking/satisfaction/api_shape.py:PerRequestStatus.detail
   * which is `str | None` with `default=None` — older clients that don't
   * send detail are valid; consumers must treat absent / null / undefined
   * as "no tooltip".
   */
  detail?: string | null
}

/**
 * Shared lookup-result shape for per-row satisfaction pills.
 *
 * `satisfied=null` means "no pill" (unknown / unassigned / missing-from-lookup).
 *
 * Consumed by:
 * - `MetPill` component (`BunkRequestRow.tsx`) — render input
 * - `BunkingStatusPanel.getRequestSatisfaction` prop — return type
 * - `CamperDetail` / `CamperDetailsPanel` lookup builders — emitted shape
 */
export interface SatisfactionEntry {
  satisfied: boolean | null
  detail: string | null
}

export interface BucketCount {
  satisfied: number
  total: number
}

export interface SatisfactionFlags {
  parent_min_one_violation: boolean
  staff_unsatisfied_alert: boolean
  has_any_counted_request: boolean
}

export interface CamperSatisfaction {
  person_cm_id: number
  per_request: PerRequestStatus[]
  // Covers COUNTED_BUCKETS only; see top-level `immaterial` for uncounted data.
  counted_totals: { material_parent: BucketCount; staff: BucketCount }
  immaterial: BucketCount
  flags: SatisfactionFlags
}

export interface SatisfactionResponse {
  // keys are JSON-stringified cm_ids; consumers iterating must parseInt
  campers: Record<string, CamperSatisfaction>
  session_cm_id: number
  year: number
  scenario_id: string | null
}

/** Defensive fallback when a person isn't in the response. */
export const emptyCamperSatisfaction = (personCmId: number): CamperSatisfaction => ({
  person_cm_id: personCmId,
  per_request: [],
  counted_totals: {
    material_parent: { satisfied: 0, total: 0 },
    staff: { satisfied: 0, total: 0 },
  },
  immaterial: { satisfied: 0, total: 0 },
  flags: {
    parent_min_one_violation: false,
    staff_unsatisfied_alert: false,
    has_any_counted_request: false,
  },
})
