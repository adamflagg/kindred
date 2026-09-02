import { describe, it, expect } from 'vitest'
import {
  getEffectivelyUnassignedCampers,
  isCamperEffectivelyUnassigned,
} from './bunkingBoardHelpers'
import type { Bunk, Camper } from '../types/app-types'

const camper = (overrides: Partial<Camper>): Camper =>
  ({ id: 'p1:s1', person_cm_id: 1, ...overrides }) as Camper

const bunk = (id: string): Bunk => ({ id }) as Bunk

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

describe('getEffectivelyUnassignedCampers', () => {
  const bunks = [bunk('bunkA'), bunk('bunkB')]

  it('returns campers with no bunk and campers stranded off-plan', () => {
    const { assigned_bunk: _omit, ...noBunk } = camper({ assigned_bunk: 'bunkA' })
    void _omit
    const stranded = camper({ id: 'p2:s1', assigned_bunk: 'bunkGONE' })
    const assigned = camper({ id: 'p3:s1', assigned_bunk: 'bunkB' })

    const result = getEffectivelyUnassignedCampers([noBunk, stranded, assigned], bunks)

    expect(result).toEqual([noBunk, stranded])
  })

  it('does not flag assigned campers while bunks are still loading (empty list)', () => {
    // bunks and campers are fed by independent React Query hooks, so bunks can
    // be [] while campers has resolved. Falling through to the stranded check
    // with an empty bunk set would flag every assigned camper. Guard: an empty
    // bunks list falls back to the plain "no bunk" check.
    const assigned = camper({ assigned_bunk: 'bunkA' })
    const { assigned_bunk: _omit, ...noBunk } = camper({ id: 'p2:s1', assigned_bunk: 'bunkA' })
    void _omit

    const result = getEffectivelyUnassignedCampers([assigned, noBunk], [])

    expect(result).toEqual([noBunk])
  })
})
