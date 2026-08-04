/**
 * One of the parent picker's integrity guards. The other, `guardUnitParentCycle`
 * (#1899), lives server-side and blocks a NEW cycle from being written, but
 * cannot un-write one already sitting in the database from before it existed
 * (see the header comment in ./unitTree). These cases are the ones the final
 * review proved reachable through the picker: a direct child, a grandchild,
 * and the unit itself.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRecord } from '../../../types/lodging'
import { descendantIds, directChildren, parentCandidates } from './unitTree'

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
    max_beds: null,
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
    is_confirmed: false,
    is_active: true,
    is_container: false,
    notes: '',
    ...over,
  }
}

describe('descendantIds', () => {
  it('finds a direct child', () => {
    const units = [unit({ id: 'a', is_container: true }), unit({ id: 'b', parent_unit: 'a' })]
    expect(descendantIds('a', units)).toEqual(new Set(['b']))
  })

  it('finds a grandchild through an intermediate container', () => {
    const units = [
      unit({ id: 'a', is_container: true }),
      unit({ id: 'b', parent_unit: 'a', is_container: true }),
      unit({ id: 'c', parent_unit: 'b' }),
    ]
    expect(descendantIds('a', units)).toEqual(new Set(['b', 'c']))
  })

  it('returns an empty set for a leaf with no children', () => {
    const units = [unit({ id: 'a', is_container: true }), unit({ id: 'b', parent_unit: 'a' })]
    expect(descendantIds('b', units)).toEqual(new Set())
  })

  // guardUnitParentCycle (#1899) now blocks a NEW cycle from being written,
  // but it cannot un-write one already sitting in the database from before
  // that hook existed, and this function has no way to know whether the hook
  // ran on any given row. So the `result.has` guard is still load-bearing
  // against data that predates it, and a refactor that dropped it would hang
  // the units panel rather than fail a test.
  it('terminates on already-cyclic stored data', () => {
    const units = [
      unit({ id: 'a', parent_unit: 'b', is_container: true }),
      unit({ id: 'b', parent_unit: 'a', is_container: true }),
    ]
    expect(descendantIds('a', units)).toEqual(new Set(['b', 'a']))
  })
})

describe('directChildren', () => {
  it('returns only direct children, not grandchildren', () => {
    const units = [
      unit({ id: 'a', is_container: true }),
      unit({ id: 'b', parent_unit: 'a', is_container: true }),
      unit({ id: 'c', parent_unit: 'b' }),
    ]
    expect(directChildren('a', units).map((u) => u.id)).toEqual(['b'])
  })

  it('returns nothing for a unit nobody names as a parent', () => {
    const units = [unit({ id: 'a', is_container: true }), unit({ id: 'b' })]
    expect(directChildren('a', units)).toEqual([])
  })
})

describe('parentCandidates', () => {
  it('excludes the unit itself', () => {
    const units = [unit({ id: 'a', is_container: true }), unit({ id: 'b', is_container: true })]
    const ids = parentCandidates('a', units).map((u) => u.id)
    expect(ids).not.toContain('a')
    expect(ids).toEqual(['b'])
  })

  it('excludes non-container units — a room may not be a parent', () => {
    const units = [unit({ id: 'a', is_container: true }), unit({ id: 'b', is_container: false })]
    expect(parentCandidates('a', units)).toEqual([])
  })

  it('excludes a direct child, which would create a cycle', () => {
    const units = [
      unit({ id: 'a', is_container: true }),
      unit({ id: 'b', parent_unit: 'a', is_container: true }),
    ]
    expect(parentCandidates('a', units).map((u) => u.id)).not.toContain('b')
  })

  it('excludes a grandchild, not just a direct child', () => {
    const units = [
      unit({ id: 'a', is_container: true }),
      unit({ id: 'b', parent_unit: 'a', is_container: true }),
      unit({ id: 'c', parent_unit: 'b', is_container: true }),
    ]
    const ids = parentCandidates('a', units).map((u) => u.id)
    expect(ids).not.toContain('b')
    expect(ids).not.toContain('c')
  })

  it('offers every container on create, since there is no self or descendant yet', () => {
    const units = [unit({ id: 'a', is_container: true }), unit({ id: 'b', is_container: true })]
    expect(parentCandidates(undefined, units).map((u) => u.id)).toEqual(['a', 'b'])
  })
})
