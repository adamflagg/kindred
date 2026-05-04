// frontend/src/utils/computeSlicesFromPredicate.test.ts
import { describe, it, expect } from 'vitest'
import { computeSlicesFromPredicate } from './computeSlicesFromPredicate'
import type { BunkRequest } from '../types/app-types'

function makeReq(overrides: Partial<BunkRequest> = {}): BunkRequest {
  return {
    id: 'r1',
    requester_id: 1000001,
    requestee_id: 1000002,
    request_type: 'bunk_with',
    source_field: 'bunk_with',
    source: 'family',
    status: 'resolved',
    priority: 1,
    year: 2026,
    session_id: 9999,
    ...overrides,
  } as BunkRequest
}

describe('computeSlicesFromPredicate — source classification truth table', () => {
  const allSatisfied = () => true

  it('bunk_with × bunk_with × family → materialParent', () => {
    const req = makeReq({
      request_type: 'bunk_with',
      source_field: 'bunk_with',
      source: 'family',
    })
    const slices = computeSlicesFromPredicate([req], allSatisfied)
    expect(slices.materialParent).toEqual({ total: 1, satisfied: 1, satisfactionRate: 1 })
    expect(slices.bestEffortParent.total).toBe(0)
    expect(slices.staff.total).toBe(0)
  })

  it('bunk_with × bunking_notes × staff → staff', () => {
    const req = makeReq({
      request_type: 'bunk_with',
      source_field: 'bunking_notes',
      source: 'staff',
    })
    const slices = computeSlicesFromPredicate([req], allSatisfied)
    expect(slices.staff).toEqual({ total: 1, satisfied: 1, satisfactionRate: 1 })
    expect(slices.materialParent.total).toBe(0)
  })

  it('bunk_with × internal_notes × staff → staff', () => {
    const req = makeReq({
      request_type: 'bunk_with',
      source_field: 'internal_notes',
      source: 'staff',
    })
    const slices = computeSlicesFromPredicate([req], allSatisfied)
    expect(slices.staff).toEqual({ total: 1, satisfied: 1, satisfactionRate: 1 })
  })

  // BUG-FIX CASE — pre-fix this row landed in `staff` due to the
  // `request_type === 'not_bunk_with'` short-circuit. Post-fix it's `materialParent`.
  it('not_bunk_with × bunk_with × family → materialParent (Stage 3b.1 bug fix)', () => {
    const req = makeReq({
      request_type: 'not_bunk_with',
      source_field: 'bunk_with',
      source: 'family',
    })
    const slices = computeSlicesFromPredicate([req], allSatisfied)
    expect(slices.materialParent).toEqual({ total: 1, satisfied: 1, satisfactionRate: 1 })
    expect(slices.staff.total).toBe(0)
  })

  it('not_bunk_with × not_bunk_with × staff → staff', () => {
    const req = makeReq({
      request_type: 'not_bunk_with',
      source_field: 'not_bunk_with',
      source: 'staff',
    })
    const slices = computeSlicesFromPredicate([req], allSatisfied)
    expect(slices.staff).toEqual({ total: 1, satisfied: 1, satisfactionRate: 1 })
  })

  it('not_bunk_with × bunking_notes × staff → staff', () => {
    const req = makeReq({
      request_type: 'not_bunk_with',
      source_field: 'bunking_notes',
      source: 'staff',
    })
    const slices = computeSlicesFromPredicate([req], allSatisfied)
    expect(slices.staff).toEqual({ total: 1, satisfied: 1, satisfactionRate: 1 })
  })

  it('not_bunk_with × internal_notes × staff → staff', () => {
    const req = makeReq({
      request_type: 'not_bunk_with',
      source_field: 'internal_notes',
      source: 'staff',
    })
    const slices = computeSlicesFromPredicate([req], allSatisfied)
    expect(slices.staff).toEqual({ total: 1, satisfied: 1, satisfactionRate: 1 })
  })

  it('age_preference × bunk_with × family → materialParent', () => {
    const req = makeReq({
      request_type: 'age_preference',
      source_field: 'bunk_with',
      source: 'family',
      age_preference_target: 'older',
    })
    const slices = computeSlicesFromPredicate([req], allSatisfied)
    expect(slices.materialParent).toEqual({ total: 1, satisfied: 1, satisfactionRate: 1 })
  })

  it('age_preference × socialize_with × family → bestEffortParent', () => {
    const req = makeReq({
      request_type: 'age_preference',
      source_field: 'socialize_with',
      source: 'family',
      age_preference_target: 'younger',
    })
    const slices = computeSlicesFromPredicate([req], allSatisfied)
    expect(slices.bestEffortParent).toEqual({ total: 1, satisfied: 1, satisfactionRate: 1 })
    expect(slices.materialParent.total).toBe(0)
  })

  it('age_preference × null × family → not binned (#1086 fallback removed)', () => {
    // After removing the legacy fallback (issue #1086), a resolved age_preference
    // row with no source_field falls through all branches and is not counted.
    const req = makeReq({
      request_type: 'age_preference',
      source_field: null as any, // null as any: tsconfig has exactOptionalPropertyTypes; null models real DB null state
      source: 'family',
      age_preference_target: 'older',
    })
    const slices = computeSlicesFromPredicate([req], allSatisfied)
    expect(slices.bestEffortParent.total).toBe(0)
    expect(slices.materialParent.total).toBe(0)
    expect(slices.staff.total).toBe(0)
  })

  it('age_preference × bunking_notes × staff → staff', () => {
    const req = makeReq({
      request_type: 'age_preference',
      source_field: 'bunking_notes',
      source: 'staff',
      age_preference_target: 'older',
    })
    const slices = computeSlicesFromPredicate([req], allSatisfied)
    expect(slices.staff).toEqual({ total: 1, satisfied: 1, satisfactionRate: 1 })
  })

  it('age_preference × internal_notes × staff → staff', () => {
    const req = makeReq({
      request_type: 'age_preference',
      source_field: 'internal_notes',
      source: 'staff',
      age_preference_target: 'younger',
    })
    const slices = computeSlicesFromPredicate([req], allSatisfied)
    expect(slices.staff).toEqual({ total: 1, satisfied: 1, satisfactionRate: 1 })
  })

  it('bunk_with × null × family (malformed legacy) → not binned', () => {
    const req = makeReq({
      request_type: 'bunk_with',
      source_field: null as unknown as string,
      source: 'family',
    })
    const slices = computeSlicesFromPredicate([req], allSatisfied)
    expect(slices.materialParent.total).toBe(0)
    expect(slices.bestEffortParent.total).toBe(0)
    expect(slices.staff.total).toBe(0)
  })

  // NOTE: The test for 'notes' source value was removed in #1102 because
  // 'notes' is no longer a valid schema value — the type system now prevents it.
  // The openai_provider maps incoming 'notes' → 'staff' before write, and
  // the PB migration 1500000099 removed 'notes' from the select enum.
})

describe('computeSlicesFromPredicate — flag derivation', () => {
  const noneSatisfied = () => false

  it('parentMinOneViolation true when material total > 0 but none satisfied', () => {
    const req = makeReq({ request_type: 'bunk_with', source_field: 'bunk_with', source: 'family' })
    const slices = computeSlicesFromPredicate([req], noneSatisfied)
    expect(slices.parentMinOneViolation).toBe(true)
  })

  it('parentMinOneViolation false when at least one material satisfied', () => {
    const req = makeReq({ request_type: 'bunk_with', source_field: 'bunk_with', source: 'family' })
    const slices = computeSlicesFromPredicate([req], () => true)
    expect(slices.parentMinOneViolation).toBe(false)
  })

  it('parentMinOneViolation false when no material requests at all', () => {
    const req = makeReq({
      request_type: 'not_bunk_with',
      source_field: 'not_bunk_with',
      source: 'staff',
    })
    const slices = computeSlicesFromPredicate([req], noneSatisfied)
    expect(slices.parentMinOneViolation).toBe(false)
  })

  it('staffUnsatisfiedAlert true when staff total > 0 but none satisfied', () => {
    const req = makeReq({
      request_type: 'not_bunk_with',
      source_field: 'not_bunk_with',
      source: 'staff',
    })
    const slices = computeSlicesFromPredicate([req], noneSatisfied)
    expect(slices.staffUnsatisfiedAlert).toBe(true)
  })

  it('staffUnsatisfiedAlert false when at least one staff satisfied', () => {
    const req = makeReq({
      request_type: 'not_bunk_with',
      source_field: 'not_bunk_with',
      source: 'staff',
    })
    const slices = computeSlicesFromPredicate([req], () => true)
    expect(slices.staffUnsatisfiedAlert).toBe(false)
  })

  it('skips non-resolved requests entirely', () => {
    const req = makeReq({
      request_type: 'bunk_with',
      source_field: 'bunk_with',
      source: 'family',
      status: 'pending',
    })
    const slices = computeSlicesFromPredicate([req], () => true)
    expect(slices.materialParent.total).toBe(0)
    expect(slices.staff.total).toBe(0)
  })
})
