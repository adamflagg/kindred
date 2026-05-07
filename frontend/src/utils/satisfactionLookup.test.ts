import { describe, it, expect } from 'vitest'
import { buildSatisfactionLookup } from './satisfactionLookup'
import type { PerRequestStatus } from '../types/satisfaction'

describe('buildSatisfactionLookup', () => {
  it('returns satisfied + detail for a known request_id', () => {
    const perRequest: PerRequestStatus[] = [
      { request_id: 'r1', bucket: 'material_parent', satisfied: true, detail: 'Same bunk' },
    ]
    const lookup = buildSatisfactionLookup(perRequest)
    expect(lookup('r1')).toEqual({ satisfied: true, detail: 'Same bunk' })
  })

  it('returns {satisfied: null, detail: null} for an unknown request_id', () => {
    const lookup = buildSatisfactionLookup([])
    expect(lookup('missing')).toEqual({ satisfied: null, detail: null })
  })

  it('coerces undefined detail to null', () => {
    const perRequest: PerRequestStatus[] = [
      { request_id: 'r1', bucket: 'material_parent', satisfied: false },
    ]
    const lookup = buildSatisfactionLookup(perRequest)
    expect(lookup('r1')).toEqual({ satisfied: false, detail: null })
  })

  it('surfaces backend "Requester not assigned" detail (regression: do NOT suppress for unassigned campers)', () => {
    // When a camper is unassigned, the backend evaluates every request as
    // (False, "Requester not assigned"). The lookup MUST surface this — earlier
    // behavior in CamperDetail / CamperDetailsPanel short-circuited to
    // {satisfied: null, detail: null} when assigned_bunk_cm_id was null,
    // suppressing legitimate API-provided detail strings.
    const perRequest: PerRequestStatus[] = [
      {
        request_id: 'r1',
        bucket: 'material_parent',
        satisfied: false,
        detail: 'Requester not assigned',
      },
    ]
    const lookup = buildSatisfactionLookup(perRequest)
    expect(lookup('r1')).toEqual({
      satisfied: false,
      detail: 'Requester not assigned',
    })
  })
})
