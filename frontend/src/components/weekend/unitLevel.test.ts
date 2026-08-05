import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow } from '../../types/lodging'
import { coveredCodes, drawnUnits } from './unitLevel'

function u(over: Partial<LodgingUnitRow> & { code: string }): LodgingUnitRow {
  return {
    unit_id: over.code,
    name: over.code,
    area_code: 'A',
    area_name: 'Area',
    sleeps: null,
    bathroom: 'unknown',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    is_confirmed: false,
    is_active: true,
    is_container: false,
    parent_code: '',
    is_combined: false,
    inventory_class: 'family_pool',
    family_available_override: null,
    reason: '',
    is_family_available: true,
    map_x: null,
    map_y: null,
    ...over,
  } as LodgingUnitRow
}

// house -> wing -> two rooms. Mirrors the deepest real tree (3 levels).
const TREE = [
  u({ code: 'house', is_container: true }),
  u({ code: 'wing', is_container: true, parent_code: 'house' }),
  u({ code: 'r1', parent_code: 'wing' }),
  u({ code: 'r2', parent_code: 'wing' }),
]

describe('drawnUnits', () => {
  it('draws leaves when nothing is combined', () => {
    expect(drawnUnits(TREE).map((x) => x.code)).toEqual(['r1', 'r2'])
  })

  it('draws the combined node instead of its children', () => {
    const units = TREE.map((x) => (x.code === 'wing' ? { ...x, is_combined: true } : x))
    expect(drawnUnits(units).map((x) => x.code)).toEqual(['wing'])
  })

  it('takes the HIGHEST combined node when two on one path are set', () => {
    // Reachable: a scenario override can set a node whose ancestor default
    // already holds. Top-down-first-true is what keeps the board total —
    // the same room must never be drawn twice.
    const units = TREE.map((x) =>
      x.code === 'house' || x.code === 'wing' ? { ...x, is_combined: true } : x
    )
    expect(drawnUnits(units).map((x) => x.code)).toEqual(['house'])
  })

  it('leaves a parentless leaf alone', () => {
    expect(drawnUnits([u({ code: 'solo' })]).map((x) => x.code)).toEqual(['solo'])
  })

  it('never draws a container that is not combined', () => {
    expect(drawnUnits(TREE).some((x) => x.is_container)).toBe(false)
  })

  it('terminates on a cycle already in the data, instead of hanging the board', () => {
    // r -> a -> b -> a: a back-edge reachable from a real root (simulating
    // corrupted parent links the server-side guardUnitParentCycle should
    // prevent, but the frontend must not trust blindly). The visited guard
    // must stop the walk rather than loop forever.
    const cyclic = [
      u({ code: 'r' }),
      u({ code: 'a', parent_code: 'r' }),
      u({ code: 'b', parent_code: 'a' }),
      u({ code: 'a', parent_code: 'b' }),
    ]
    expect(() => drawnUnits(cyclic)).not.toThrow()
  })
})

describe('coveredCodes', () => {
  it('returns every leaf beneath a container', () => {
    const house = TREE[0]!
    expect(coveredCodes(house, TREE).toSorted()).toEqual(['r1', 'r2'])
  })

  it('returns a leaf itself', () => {
    expect(coveredCodes(TREE[2]!, TREE)).toEqual(['r1'])
  })
})
