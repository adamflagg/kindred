import { describe, it, expect } from 'vitest'
import { isCamperEffectivelyUnassigned } from './BunkingBoardByArea'
import type { Camper } from '../types/app-types'

const camper = (overrides: Partial<Camper>): Camper =>
  ({ id: 'p1:s1', person_cm_id: 1, ...overrides }) as Camper

describe('isCamperEffectivelyUnassigned', () => {
  const validBunkIds = new Set(['bunkA', 'bunkB'])

  it('treats a camper with no bunk as unassigned', () => {
    // omit assigned_bunk entirely to avoid exactOptionalPropertyTypes constraint
    const { assigned_bunk: _, ...rest } = camper({ assigned_bunk: 'bunkA' })
    void _
    expect(isCamperEffectivelyUnassigned(rest as Camper, validBunkIds)).toBe(true)
  })

  it('treats a camper assigned to a displayed bunk as assigned', () => {
    expect(isCamperEffectivelyUnassigned(camper({ assigned_bunk: 'bunkA' }), validBunkIds)).toBe(
      false
    )
  })

  it('treats a camper assigned to a bunk NOT in the session plan as unassigned', () => {
    // The stranded case: bunk record exists but has no bunk_plan for this session.
    expect(isCamperEffectivelyUnassigned(camper({ assigned_bunk: 'bunkGONE' }), validBunkIds)).toBe(
      true
    )
  })
})
