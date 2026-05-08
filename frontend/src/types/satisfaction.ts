/**
 * Satisfaction response types — re-exported from codegen.
 *
 * Source of truth: `bunking/satisfaction/api_shape.py` (Pydantic models)
 * → `frontend/src/types/api-generated/types.gen.ts` (@hey-api/openapi-ts output)
 * → this file (semantic aliases for ergonomic imports).
 *
 * Drift between Python and TS is now caught at codegen time, not at runtime.
 *
 * `SatisfactionEntry` and `emptyCamperSatisfaction` are consumer-side helpers
 * that don't exist in the API shape — they live here because consumer code
 * expects them at this import path.
 */
import type {
  BucketCount as BucketCountGen,
  CamperSatisfaction as CamperSatisfactionGen,
  PerRequestStatus as PerRequestStatusGen,
  RequestBucket as RequestBucketGen,
  SatisfactionFlags as SatisfactionFlagsGen,
  SatisfactionResponse as SatisfactionResponseGen,
} from './api-generated'

export type RequestBucket = RequestBucketGen
export type PerRequestStatus = PerRequestStatusGen
export type BucketCount = BucketCountGen
export type SatisfactionFlags = SatisfactionFlagsGen

/**
 * Counted-bucket totals — the Pydantic model enforces that exactly
 * `material_parent` and `staff` are present at runtime
 * (`bunking/satisfaction/api_shape.py:CamperSatisfaction`).
 */
export interface CountedTotals {
  material_parent: BucketCount
  staff: BucketCount
}

/**
 * Codegen lowers Python's `dict[RequestBucket, BucketCount]` to an open index
 * signature, which makes every key access `T | undefined`. Narrow
 * `counted_totals` here so consumers don't have to defend against the loose
 * codegen shape on every access.
 */
export interface CamperSatisfaction extends Omit<CamperSatisfactionGen, 'counted_totals'> {
  counted_totals: CountedTotals
}

export interface SatisfactionResponse extends Omit<SatisfactionResponseGen, 'campers'> {
  campers: Record<string, CamperSatisfaction>
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
