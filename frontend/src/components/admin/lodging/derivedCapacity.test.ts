/**
 * `_effective_sleeps`'s arithmetic, mirrored for the admin form.
 *
 * Every case here is measured against the production shapes in kindred#2079:
 * a two-level container over plain rooms, and the three-level grandparent
 * whose intermediate children are themselves containers with `sleeps = 0`
 * (`gt-tioga`, `gt-tenaya`, `hc-health-center`) — summing immediate children
 * gets that second shape wrong, refusing on exactly the whole-building
 * rollups most worth showing.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRecord } from '../../../types/lodging'
import { activeLeavesUnder, derivedWholeHouseSleeps } from './derivedCapacity'

function unit(over: Partial<LodgingUnitRecord> & { id: string }): LodgingUnitRecord {
  return {
    area: 'area_1',
    name: over.id,
    code: over.id,
    parent_unit: '',
    map_x: 0,
    map_y: 0,
    sleeps: 0,
    beds: null,
    bathroom: 'none',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    has_tub: false,
    has_kitchenette: false,
    has_crib: false,
    has_changing_table: false,
    has_shared_fridge: false,
    inventory_class: 'family_pool',
    shareability: '',
    is_confirmed: false,
    is_active: true,
    is_container: false,
    default_combined: false,
    notes: '',
    ...over,
  }
}

describe('derivedWholeHouseSleeps', () => {
  it('derives delta + Σ(leaves) for a two-level container, not Σ(immediate children)', () => {
    const units = [
      unit({ id: 'house', is_container: true }),
      unit({ id: 'room-1', parent_unit: 'house', sleeps: 4 }),
      unit({ id: 'room-2', parent_unit: 'house', sleeps: 5 }),
    ]
    expect(derivedWholeHouseSleeps('house', 0, units)).toBe(9)
  })

  it('derives the full leaf total through a three-level grandparent whose intermediate children are unmeasured containers', () => {
    // Mirrors gt-tioga: two container halves, each sleeps=0, each holding two
    // measured leaves. Summing immediate children would see two zeros and
    // refuse; the leaf walk must not.
    const units = [
      unit({ id: 'gt-tioga', is_container: true }),
      unit({ id: 'gt-tioga-upstairs', parent_unit: 'gt-tioga', is_container: true, sleeps: 0 }),
      unit({ id: 'gt-tioga-1', parent_unit: 'gt-tioga-upstairs', sleeps: 4 }),
      unit({ id: 'gt-tioga-2', parent_unit: 'gt-tioga-upstairs', sleeps: 4 }),
      unit({ id: 'gt-tioga-downstairs', parent_unit: 'gt-tioga', is_container: true, sleeps: 0 }),
      unit({ id: 'gt-tioga-3', parent_unit: 'gt-tioga-downstairs', sleeps: 4 }),
      unit({ id: 'gt-tioga-4', parent_unit: 'gt-tioga-downstairs', sleeps: 5 }),
    ]
    expect(derivedWholeHouseSleeps('gt-tioga', 0, units)).toBe(17)
  })

  it('adds a non-zero own delta to Σ(leaves) rather than replacing it (the double-count guard)', () => {
    // gt-clouds-rest: the one production container with a real own delta — a
    // landing futon nothing else in the registry records.
    const units = [
      unit({ id: 'house', is_container: true }),
      unit({ id: 'room-1', parent_unit: 'house', sleeps: 4 }),
      unit({ id: 'room-2', parent_unit: 'house', sleeps: 5 }),
    ]
    // Writing Σ(rooms) = 9 into the delta field would make this 18, not 10.
    expect(derivedWholeHouseSleeps('house', 1, units)).toBe(10)
  })

  it('refuses when any leaf beneath the container is unmeasured', () => {
    const units = [
      unit({ id: 'house', is_container: true }),
      unit({ id: 'room-1', parent_unit: 'house', sleeps: 4 }),
      unit({ id: 'room-2', parent_unit: 'house', sleeps: 0 }), // unmeasured
    ]
    expect(derivedWholeHouseSleeps('house', 0, units)).toBeNull()
  })

  it('refuses when any leaf is unmeasured even under an intermediate container', () => {
    const units = [
      unit({ id: 'house', is_container: true }),
      unit({ id: 'wing', parent_unit: 'house', is_container: true }),
      unit({ id: 'room-1', parent_unit: 'wing', sleeps: 4 }),
      unit({ id: 'room-2', parent_unit: 'wing', sleeps: 0 }), // unmeasured
    ]
    expect(derivedWholeHouseSleeps('house', 0, units)).toBeNull()
  })

  it('skips a retired leaf entirely — neither counted nor blocking the total', () => {
    const units = [
      unit({ id: 'house', is_container: true }),
      unit({ id: 'room-1', parent_unit: 'house', sleeps: 4 }),
      unit({ id: 'room-2', parent_unit: 'house', sleeps: 0, is_active: false }),
    ]
    expect(derivedWholeHouseSleeps('house', 0, units)).toBe(4)
  })

  it('returns null for the degenerate case: no own delta and no rooms', () => {
    // Summing an absent delta over an empty room list would otherwise yield
    // 0 — the confident claim "this house sleeps nobody" rather than "nobody
    // has measured this house".
    const units = [unit({ id: 'house', is_container: true })]
    expect(derivedWholeHouseSleeps('house', 0, units)).toBeNull()
  })

  it('a childless container with a real own delta still derives that delta', () => {
    const units = [unit({ id: 'house', is_container: true })]
    expect(derivedWholeHouseSleeps('house', 1, units)).toBe(1)
  })
})

describe('activeLeavesUnder', () => {
  it('returns leaves through an intermediate container, excluding the containers themselves', () => {
    const units = [
      unit({ id: 'house', is_container: true }),
      unit({ id: 'wing', parent_unit: 'house', is_container: true }),
      unit({ id: 'room-1', parent_unit: 'wing', sleeps: 4 }),
    ]
    expect(activeLeavesUnder('house', units).map((leaf) => leaf.id)).toEqual(['room-1'])
  })

  it('excludes a retired leaf', () => {
    const units = [
      unit({ id: 'house', is_container: true }),
      unit({ id: 'room-1', parent_unit: 'house', sleeps: 4, is_active: false }),
    ]
    expect(activeLeavesUnder('house', units)).toEqual([])
  })

  it('returns nothing for a childless container', () => {
    const units = [unit({ id: 'house', is_container: true })]
    expect(activeLeavesUnder('house', units)).toEqual([])
  })
})
