import { describe, it, expect } from 'vitest'
import { deriveSlicesFromSatisfactionMap } from './deriveSlicesFromSatisfactionMap'
import type { BunkRequest } from '../types/app-types'
import type { SatisfactionMap } from '../hooks/camper/types'

function makeReq(id: string, overrides: Partial<BunkRequest> = {}): BunkRequest {
  return {
    id,
    requester_id: 1000001,
    requestee_id: 1000002,
    request_type: 'bunk_with',
    source_field: 'bunk_with',
    source: 'family',
    status: 'resolved',
    priority: 1,
    ...overrides,
  } as BunkRequest
}

describe('deriveSlicesFromSatisfactionMap', () => {
  it('counts a row as satisfied when map entry is "satisfied"', () => {
    const reqs = [makeReq('r1')]
    const map: SatisfactionMap = { r1: { status: 'satisfied', detail: '' } }
    const slices = deriveSlicesFromSatisfactionMap(reqs, map)
    expect(slices.materialParent.satisfied).toBe(1)
  })

  it('does NOT count "not_satisfied"', () => {
    const reqs = [makeReq('r1')]
    const map: SatisfactionMap = { r1: { status: 'not_satisfied', detail: '' } }
    const slices = deriveSlicesFromSatisfactionMap(reqs, map)
    expect(slices.materialParent.total).toBe(1)
    expect(slices.materialParent.satisfied).toBe(0)
  })

  it('does NOT count "unknown"', () => {
    const reqs = [makeReq('r1')]
    const map: SatisfactionMap = { r1: { status: 'unknown', detail: '' } }
    const slices = deriveSlicesFromSatisfactionMap(reqs, map)
    expect(slices.materialParent.satisfied).toBe(0)
  })

  it('does NOT count "checking"', () => {
    const reqs = [makeReq('r1')]
    const map: SatisfactionMap = { r1: { status: 'checking', detail: '' } }
    const slices = deriveSlicesFromSatisfactionMap(reqs, map)
    expect(slices.materialParent.satisfied).toBe(0)
  })

  it('does NOT count rows missing from the map (treats as unsatisfied)', () => {
    const reqs = [makeReq('r1')]
    const map: SatisfactionMap = {}
    const slices = deriveSlicesFromSatisfactionMap(reqs, map)
    expect(slices.materialParent.total).toBe(1)
    expect(slices.materialParent.satisfied).toBe(0)
  })

  it('classifies multiple rows correctly across slices', () => {
    const reqs = [
      makeReq('r-mat', { source_field: 'bunk_with' }),
      makeReq('r-best', {
        request_type: 'age_preference',
        source_field: 'socialize_with',
        age_preference_target: 'older',
      }),
      makeReq('r-staff', {
        request_type: 'not_bunk_with',
        source_field: 'not_bunk_with',
        source: 'staff',
      }),
    ]
    const map: SatisfactionMap = {
      'r-mat': { status: 'satisfied', detail: '' },
      'r-best': { status: 'not_satisfied', detail: '' },
      'r-staff': { status: 'satisfied', detail: '' },
    }
    const slices = deriveSlicesFromSatisfactionMap(reqs, map)
    expect(slices.materialParent).toEqual({ total: 1, satisfied: 1, satisfactionRate: 1 })
    expect(slices.bestEffortParent).toEqual({ total: 1, satisfied: 0, satisfactionRate: 0 })
    expect(slices.staff).toEqual({ total: 1, satisfied: 1, satisfactionRate: 1 })
  })
})
