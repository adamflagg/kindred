/**
 * Pure helper used by BunkRequestProvider.getSatisfiedRequestInfo to compute
 * per-camper request satisfaction with parent/staff splits (Stage 2
 * parent-paramount). Lives outside the provider so the binning + filtering
 * logic can be unit-tested without React Query / context setup.
 *
 * Source taxonomy (matches backend RequestSource enum):
 *   - Parent (FAMILY): bunk_with, socialize_with — drive parentTotal/parentSatisfied
 *   - Staff (STAFF):   not_bunk_with, bunking_notes, internal_notes — drive staffTotal/staffSatisfied
 *   - Anything else (source==='notes' or unset): counted only in totalRequests/satisfiedCount
 */
import type { BunkRequest } from '../types/app-types'
import type { BunkmateInfo } from '../contexts/BunkRequestContext'
import type { SatisfiedRequestInfo } from '../contexts/BunkRequestContext'
import { isAgePreferenceSatisfied } from './agePreferenceSatisfaction'

const EMPTY_INFO: SatisfiedRequestInfo = {
  totalRequests: 0,
  satisfiedCount: 0,
  topPrioritySatisfied: false,
  priorityLevels: [],
  hasLockedPriority: false,
  parentTotal: 0,
  parentSatisfied: 0,
  staffTotal: 0,
  staffSatisfied: 0,
}

export function computeSatisfiedRequestInfo(
  personRequests: BunkRequest[],
  personCmId: number,
  personSet: Set<number>,
  bunkmateGrades: number[],
  requesterGrade: number | null
): SatisfiedRequestInfo {
  if (personRequests.length === 0) {
    return EMPTY_INFO
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

  let parentTotal = 0
  let parentSatisfied = 0
  let staffTotal = 0
  let staffSatisfied = 0
  const satisfiedRequests: BunkRequest[] = []

  for (const req of personRequests) {
    const sat = isSatisfied(req)
    if (sat) satisfiedRequests.push(req)
    if (req.source === 'family') {
      parentTotal += 1
      if (sat) parentSatisfied += 1
    } else if (req.source === 'staff') {
      staffTotal += 1
      if (sat) staffSatisfied += 1
    }
  }

  const sortedSatisfied = [...satisfiedRequests].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
  )
  const topPriority = personRequests.reduce((max, req) => Math.max(max, req.priority ?? 0), 0)
  const topPrioritySatisfied = sortedSatisfied.some((req) => (req.priority ?? 0) === topPriority)
  const priorityLevels = [...new Set(sortedSatisfied.map((r) => r.priority ?? 0))].sort(
    (a, b) => b - a
  )
  const hasLockedPriority = satisfiedRequests.some((req) => req.priority_locked)

  // Surface personCmId so future tests can confirm wiring without breaking
  // existing callers (param is otherwise unused — kept so the call shape mirrors
  // the provider's getSatisfiedRequestInfo and so renaming/refactoring is local).
  void personCmId

  return {
    totalRequests: personRequests.length,
    satisfiedCount: satisfiedRequests.length,
    topPrioritySatisfied,
    priorityLevels,
    hasLockedPriority,
    parentTotal,
    parentSatisfied,
    staffTotal,
    staffSatisfied,
  }
}

// Re-export BunkmateInfo for tests that import from this module so they don't
// have to round-trip through the context module.
export type { BunkmateInfo }
