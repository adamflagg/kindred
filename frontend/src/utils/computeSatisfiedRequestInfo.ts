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
 */
import type { BunkRequest } from '../types/app-types'
import type {
  BunkmateInfo,
  RequestSlice,
  SatisfiedRequestInfo,
} from '../contexts/BunkRequestContext'
import { isAgePreferenceSatisfied } from './agePreferenceSatisfaction'

const EMPTY_SLICE: RequestSlice = Object.freeze({
  total: 0,
  satisfied: 0,
  satisfactionRate: 0,
}) as RequestSlice

// Frozen so the shared reference can't be mutated by any caller — the
// `priorityLevels` array would otherwise alias across every empty return.
export const EMPTY_SATISFIED_INFO: SatisfiedRequestInfo = Object.freeze({
  materialParent: EMPTY_SLICE,
  bestEffortParent: EMPTY_SLICE,
  staff: EMPTY_SLICE,
  parentMinOneViolation: false,
  staffUnsatisfiedAlert: false,
  topPrioritySatisfied: false,
  priorityLevels: Object.freeze([]) as readonly number[] as number[],
}) as SatisfiedRequestInfo

export function computeSatisfiedRequestInfo(
  personRequests: BunkRequest[],
  personCmId: number,
  personSet: Set<number>,
  bunkmateGrades: number[],
  requesterGrade: number | null
): SatisfiedRequestInfo {
  if (personRequests.length === 0) {
    return EMPTY_SATISFIED_INFO
  }

  const isSatisfied = (req: BunkRequest): boolean => {
    if (req.request_type === 'bunk_with' && req.requestee_id) {
      return personSet.has(req.requestee_id)
    }
    if (req.request_type === 'not_bunk_with' && req.requestee_id) {
      return !personSet.has(req.requestee_id)
    }
    if (req.request_type === 'age_preference' && req.age_preference_target) {
      if (requesterGrade === null || bunkmateGrades.length === 0) return false
      const preference = req.age_preference_target as 'older' | 'younger'
      return isAgePreferenceSatisfied(requesterGrade, bunkmateGrades, preference).satisfied
    }
    return false
  }

  let materialTotal = 0
  let materialSat = 0
  let bestTotal = 0
  let bestSat = 0
  let staffTotal = 0
  let staffSat = 0
  const satisfiedRequests: BunkRequest[] = []

  for (const req of personRequests) {
    // Spec §2.1: only resolved rows count toward satisfaction stats.
    // Pending (e.g. SAME_AGE staff-review path) and declined must not leak
    // into any of the three slices.
    if (req.status !== 'resolved') continue
    const sat = isSatisfied(req)
    if (sat) satisfiedRequests.push(req)
    // scan-it 2026-04-30 #5: classify defensively. A row with request_type
    // `not_bunk_with` belongs in the staff bucket by definition (the type
    // IS the staff classification — see RequestSource enum, `not_bunk_with`
    // → STAFF). The earlier implementation used `req.source === 'staff'` as
    // the only staff predicate and would silently drop a FAMILY-source
    // not_bunk_with from every slice. Mirror the graph builder, which now
    // classifies on request_type as the authoritative bucket key.
    if (req.request_type === 'not_bunk_with') {
      staffTotal += 1
      if (sat) staffSat += 1
    } else if (req.source_field === 'bunk_with') {
      materialTotal += 1
      if (sat) materialSat += 1
    } else if (req.source_field === 'socialize_with') {
      bestTotal += 1
      if (sat) bestSat += 1
    } else if (req.source === 'staff') {
      staffTotal += 1
      if (sat) staffSat += 1
    }
  }

  const slice = (total: number, satisfied: number): RequestSlice => ({
    total,
    satisfied,
    satisfactionRate: total === 0 ? 0 : satisfied / total,
  })

  const sortedSatisfied = [...satisfiedRequests].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
  )
  const topPriority = personRequests.reduce((max, req) => Math.max(max, req.priority ?? 0), 0)
  const topPrioritySatisfied = sortedSatisfied.some((req) => (req.priority ?? 0) === topPriority)
  const priorityLevels = [...new Set(sortedSatisfied.map((r) => r.priority ?? 0))].sort(
    (a, b) => b - a
  )

  // Surface personCmId so future tests can confirm wiring without breaking
  // existing callers (param is otherwise unused — kept so the call shape mirrors
  // the provider's getSatisfiedRequestInfo and so renaming/refactoring is local).
  void personCmId

  return {
    materialParent: slice(materialTotal, materialSat),
    bestEffortParent: slice(bestTotal, bestSat),
    staff: slice(staffTotal, staffSat),
    parentMinOneViolation: materialTotal >= 1 && materialSat === 0,
    staffUnsatisfiedAlert: staffTotal >= 1 && staffSat === 0,
    topPrioritySatisfied,
    priorityLevels,
  }
}

// Re-export BunkmateInfo for tests that import from this module so they don't
// have to round-trip through the context module.
export type { BunkmateInfo }
