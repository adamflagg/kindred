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
  /** Present and true only on EMPTY_CAMPER_SATISFACTION fallback values. */
  _is_empty?: true
}

export interface SatisfactionResponse {
  campers: Record<number, CamperSatisfaction>
  session_cm_id: number
  year: number
  scenario_id: string | null
}

/** Defensive fallback when a person isn't in the response. */
export const EMPTY_CAMPER_SATISFACTION = (personCmId: number): CamperSatisfaction => ({
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
  _is_empty: true,
})
