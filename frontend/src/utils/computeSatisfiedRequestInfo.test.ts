import { describe, it, expect } from 'vitest'
import { computeSatisfiedRequestInfo } from './computeSatisfiedRequestInfo'
import type { BunkRequest } from '../types/app-types'

const baseReq = (overrides: Partial<BunkRequest>): BunkRequest =>
  ({
    id: 'r1',
    requester_id: 1001,
    requestee_id: 1002,
    request_type: 'bunk_with',
    source: 'family',
    source_field: 'bunk_with',
    status: 'resolved',
    priority: 4,
    year: 2026,
    session_id: 999,
    confidence_score: 0.95,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    ...overrides,
  }) as BunkRequest

describe('computeSatisfiedRequestInfo Shape A', () => {
  const personSet = new Set([1001, 1002])

  it('returns three slices and derived flags', () => {
    const result = computeSatisfiedRequestInfo([baseReq({})], 1001, personSet, [], 6)
    expect(result.materialParent.total).toBe(1)
    expect(result.materialParent.satisfied).toBe(1)
    expect(result.materialParent.satisfactionRate).toBe(1.0)
    expect(result.bestEffortParent.total).toBe(0)
    expect(result.staff.total).toBe(0)
    expect(result.parentMinOneViolation).toBe(false)
    expect(result.staffUnsatisfiedAlert).toBe(false)
  })

  it('source_field=bunk_with bins to materialParent', () => {
    const result = computeSatisfiedRequestInfo(
      [baseReq({ source_field: 'bunk_with' })],
      1001,
      personSet,
      [],
      6
    )
    expect(result.materialParent.total).toBe(1)
    expect(result.bestEffortParent.total).toBe(0)
  })

  it('source_field=socialize_with bins to bestEffortParent', () => {
    const result = computeSatisfiedRequestInfo(
      [
        baseReq({
          source_field: 'socialize_with',
          request_type: 'age_preference',
          age_preference_target: 'older',
        }),
      ],
      1001,
      personSet,
      [7, 7],
      6
    )
    expect(result.bestEffortParent.total).toBe(1)
    expect(result.bestEffortParent.satisfied).toBe(1)
    expect(result.materialParent.total).toBe(0)
  })

  it('source=staff bins to staff slice', () => {
    const result = computeSatisfiedRequestInfo(
      [
        baseReq({
          source: 'staff',
          source_field: 'not_bunk_with',
          request_type: 'not_bunk_with',
        }),
      ],
      1001,
      new Set([1001]), // requestee NOT in same bunk → not_bunk_with satisfied
      [],
      6
    )
    expect(result.staff.total).toBe(1)
    expect(result.staff.satisfied).toBe(1)
  })

  it('parentMinOneViolation true only when material parent unsatisfied', () => {
    const unsatBunkWith = baseReq({ source_field: 'bunk_with', requestee_id: 9999 })
    const result = computeSatisfiedRequestInfo([unsatBunkWith], 1001, personSet, [], 6)
    expect(result.materialParent.satisfied).toBe(0)
    expect(result.parentMinOneViolation).toBe(true)
  })

  it('best-effort-only camper never trips parentMinOneViolation', () => {
    const unsatSocialize = baseReq({
      source_field: 'socialize_with',
      request_type: 'age_preference',
      age_preference_target: 'older',
      requestee_id: null,
    })
    const result = computeSatisfiedRequestInfo([unsatSocialize], 1001, new Set([1001]), [], 6)
    expect(result.materialParent.total).toBe(0)
    expect(result.bestEffortParent.satisfied).toBe(0)
    expect(result.parentMinOneViolation).toBe(false)
  })

  it('skips non-resolved rows (pending/declined) across all three slices', () => {
    // Only status === 'resolved' rows are evaluated.
    // Regression: SAME_AGE-target age_preference rows land as status=pending
    // for staff review and were leaking into materialParent unsatisfied counts.
    const pendingMaterial = baseReq({
      id: 'r-pending-material',
      source_field: 'bunk_with',
      requestee_id: 9999, // would be UNsatisfied if evaluated
      status: 'pending',
    })
    const declinedBestEffort = baseReq({
      id: 'r-declined-best',
      source_field: 'socialize_with',
      requestee_id: 9998,
      status: 'declined',
    })
    const pendingStaff = baseReq({
      id: 'r-pending-staff',
      source: 'staff',
      source_field: 'not_bunk_with',
      request_type: 'not_bunk_with',
      requestee_id: 1002, // would be UNsatisfied
      status: 'pending',
    })
    const result = computeSatisfiedRequestInfo(
      [pendingMaterial, declinedBestEffort, pendingStaff],
      1001,
      personSet,
      [],
      6
    )
    expect(result.materialParent.total).toBe(0)
    expect(result.bestEffortParent.total).toBe(0)
    expect(result.staff.total).toBe(0)
    expect(result.parentMinOneViolation).toBe(false)
    expect(result.staffUnsatisfiedAlert).toBe(false)
  })

  it('staffUnsatisfiedAlert when staff total > 0 and zero satisfied', () => {
    const result = computeSatisfiedRequestInfo(
      [
        baseReq({
          source: 'staff',
          source_field: 'not_bunk_with',
          request_type: 'not_bunk_with',
          requestee_id: 1002,
        }),
      ],
      1001,
      personSet, // requestee IS in same bunk → not_bunk_with UNsatisfied
      [],
      6
    )
    expect(result.staff.total).toBe(1)
    expect(result.staff.satisfied).toBe(0)
    expect(result.staffUnsatisfiedAlert).toBe(true)
  })
})

describe('Stage 3b.1 bug fix — request_type=not_bunk_with with source_field=bunk_with', () => {
  it('routes to materialParent, not staff (was buggy pre-3b.1)', () => {
    const personRequests = [
      {
        id: 'bug-fix-case',
        requester_id: 1000001,
        requestee_id: 1000002,
        request_type: 'not_bunk_with',
        source_field: 'bunk_with',
        source: 'family',
        status: 'resolved',
        priority: 1,
      } as BunkRequest,
    ]
    const personSet = new Set<number>() // requestee NOT in bunk → not_bunk_with satisfied
    const result = computeSatisfiedRequestInfo(personRequests, 1000001, personSet, [], null)
    expect(result.materialParent).toEqual({ total: 1, satisfied: 1, satisfactionRate: 1 })
    expect(result.staff.total).toBe(0)
  })

  it('parent bunk_with-derived not_bunk_with with target IN bunk → materialParent unsatisfied', () => {
    const personRequests = [
      {
        id: 'unsatisfied-case',
        requester_id: 1000001,
        requestee_id: 1000002,
        request_type: 'not_bunk_with',
        source_field: 'bunk_with',
        source: 'family',
        status: 'resolved',
        priority: 1,
      } as BunkRequest,
    ]
    const personSet = new Set<number>([1000002]) // requestee IS in bunk → not_bunk_with violated
    const result = computeSatisfiedRequestInfo(personRequests, 1000001, personSet, [], null)
    expect(result.materialParent).toEqual({ total: 1, satisfied: 0, satisfactionRate: 0 })
    expect(result.parentMinOneViolation).toBe(true)
  })
})
