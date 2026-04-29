import { describe, it, expect } from 'vitest'
import { computeSatisfiedRequestInfo } from './computeSatisfiedRequestInfo'
import type { BunkRequest } from '../types/app-types'

function req(overrides: Partial<BunkRequest>): BunkRequest {
  return {
    id: 'r-x',
    requester_id: 1,
    requestee_id: 2,
    request_type: 'bunk_with',
    priority: 4,
    year: 2026,
    session_id: 999,
    status: 'resolved',
    confidence_score: 0.95,
    source: 'family',
    ...overrides,
  } as BunkRequest
}

describe('computeSatisfiedRequestInfo — parent/staff splits', () => {
  it('returns zeroed splits when person has no requests', () => {
    const info = computeSatisfiedRequestInfo([], 1, new Set(), [], 8)
    expect(info.parentTotal).toBe(0)
    expect(info.parentSatisfied).toBe(0)
    expect(info.staffTotal).toBe(0)
    expect(info.staffSatisfied).toBe(0)
  })

  it('bins parent and staff bunk_with separately', () => {
    const requests = [
      req({ id: 'p1', requester_id: 1, requestee_id: 2, source: 'family' }),
      req({ id: 's1', requester_id: 1, requestee_id: 3, source: 'staff' }),
    ]
    const personSet = new Set([1, 2, 3])
    const info = computeSatisfiedRequestInfo(requests, 1, personSet, [8, 8], 8)
    expect(info.parentTotal).toBe(1)
    expect(info.parentSatisfied).toBe(1)
    expect(info.staffTotal).toBe(1)
    expect(info.staffSatisfied).toBe(1)
    expect(info.totalRequests).toBe(2)
    expect(info.satisfiedCount).toBe(2)
  })

  it('parent satisfied and staff unsatisfied evaluate independently', () => {
    const requests = [
      req({ id: 'p1', requester_id: 1, requestee_id: 2, source: 'family' }),
      req({
        id: 's1',
        requester_id: 1,
        requestee_id: 99,
        source: 'staff',
        request_type: 'bunk_with',
      }),
    ]
    const personSet = new Set([1, 2])
    const info = computeSatisfiedRequestInfo(requests, 1, personSet, [8], 8)
    expect(info.parentTotal).toBe(1)
    expect(info.parentSatisfied).toBe(1)
    expect(info.staffTotal).toBe(1)
    expect(info.staffSatisfied).toBe(0)
  })

  it('not_bunk_with staff request is satisfied when target is NOT in bunk', () => {
    const requests = [
      req({
        id: 's1',
        requester_id: 1,
        requestee_id: 99,
        source: 'staff',
        request_type: 'not_bunk_with',
      }),
    ]
    const personSet = new Set([1, 2])
    const info = computeSatisfiedRequestInfo(requests, 1, personSet, [8], 8)
    expect(info.staffTotal).toBe(1)
    expect(info.staffSatisfied).toBe(1)
  })

  it('source==="notes" or unset falls through both splits but counts in aggregate', () => {
    const notesReq = req({ id: 'n1', requester_id: 1, requestee_id: 2, source: 'notes' })
    const unsetReq = { ...req({ id: 'u1', requester_id: 1, requestee_id: 3 }) }
    delete (unsetReq as { source?: unknown }).source
    const requests = [notesReq, unsetReq as BunkRequest]
    const personSet = new Set([1, 2, 3])
    const info = computeSatisfiedRequestInfo(requests, 1, personSet, [8, 8], 8)
    expect(info.parentTotal).toBe(0)
    expect(info.staffTotal).toBe(0)
    expect(info.totalRequests).toBe(2)
    expect(info.satisfiedCount).toBe(2)
  })

  it('age_preference parent request bins as parent', () => {
    const requests = [
      req({
        id: 'p1',
        requester_id: 1,
        requestee_id: null,
        source: 'family',
        request_type: 'age_preference',
        age_preference_target: 'older',
      }),
    ]
    // Requester is grade 5; bunkmate is grade 7 → older preference satisfied.
    const info = computeSatisfiedRequestInfo(requests, 1, new Set([1, 2]), [7], 5)
    expect(info.parentTotal).toBe(1)
    expect(info.parentSatisfied).toBe(1)
  })
})
