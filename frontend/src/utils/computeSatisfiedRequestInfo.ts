/**
 * Pure helper used by BunkRequestProvider.getSatisfiedRequestInfo to compute
 * per-camper request satisfaction with Shape A three-slice split (Stage 3a
 * parent-paramount). Lives outside the provider so the binning + filtering
 * logic can be unit-tested without React Query / context setup.
 *
 * Shape A binning (mutually exclusive — each request goes to at most one slice):
 *   - materialParent   ← source_field === 'bunk_with'      (must-have)
 *   - bestEffortParent ← source_field === 'socialize_with' (nice-to-have)
 *   - staff            ← source === 'staff'                (staff request)
 *
 * Derived flags:
 *   - parentMinOneViolation: materialParent.total >= 1 && satisfied === 0
 *   - staffUnsatisfiedAlert: staff.total >= 1 && satisfied === 0
 *
 * Stage 3b.1 refactor: delegates all slice math + source classification to
 * computeSlicesFromPredicate. Public signature preserved — existing callers
 * work unchanged.
 */
import type { BunkRequest } from '../types/app-types'
import type {
  BunkmateInfo,
  RequestSlice,
  SatisfiedRequestInfo,
} from '../contexts/BunkRequestContext'
import {
  computeSlicesFromPredicate,
  type SatisfactionPredicate,
} from './computeSlicesFromPredicate'
import { isAgePreferenceSatisfied } from './agePreferenceSatisfaction'

const EMPTY_SLICE: RequestSlice = Object.freeze({
  total: 0,
  satisfied: 0,
  satisfactionRate: 0,
}) as RequestSlice

// Frozen so the shared reference can't be mutated by any caller.
export const EMPTY_SATISFIED_INFO: SatisfiedRequestInfo = Object.freeze({
  materialParent: EMPTY_SLICE,
  bestEffortParent: EMPTY_SLICE,
  staff: EMPTY_SLICE,
  parentMinOneViolation: false,
  staffUnsatisfiedAlert: false,
}) as SatisfiedRequestInfo

/**
 * Scenario-aware slice computation. Builds an in-memory satisfaction predicate
 * from the bunk roster (personSet) and bunkmate grades, then delegates to the
 * shared aggregator for source classification + slice math.
 */
export function computeSatisfiedRequestInfo(
  personRequests: BunkRequest[],
  personSet: Set<number>,
  bunkmateGrades: number[],
  requesterGrade: number | null
): SatisfiedRequestInfo {
  const isSatisfied: SatisfactionPredicate = (req) => {
    if (req.request_type === 'bunk_with' && req.requestee_id) {
      return personSet.has(req.requestee_id)
    }
    if (req.request_type === 'not_bunk_with' && req.requestee_id) {
      return !personSet.has(req.requestee_id)
    }
    if (req.request_type === 'age_preference' && req.age_preference_target) {
      if (requesterGrade === null || bunkmateGrades.length === 0) return false
      const target = req.age_preference_target as 'older' | 'younger'
      return isAgePreferenceSatisfied(requesterGrade, bunkmateGrades, target).satisfied
    }
    return false
  }

  return computeSlicesFromPredicate(personRequests, isSatisfied)
}

// Re-export BunkmateInfo for tests that import from this module so they don't
// have to round-trip through the context module.
export type { BunkmateInfo }
