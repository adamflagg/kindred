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
import { combinedAncestor, descendantIds, directChildren, parentCandidates } from './unitTree'

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

describe('combinedAncestor', () => {
  it('finds a combined direct parent', () => {
    const units = [
      unit({ id: 'a', is_container: true, default_combined: true }),
      unit({ id: 'b', parent_unit: 'a', is_container: true }),
    ]
    expect(combinedAncestor('a', units)?.id).toBe('a')
  })

  it('finds a combined grandparent through an uncombined intermediate', () => {
    const units = [
      unit({ id: 'a', is_container: true, default_combined: true }),
      unit({ id: 'b', parent_unit: 'a', is_container: true }),
      unit({ id: 'c', parent_unit: 'b', is_container: true }),
    ]
    expect(combinedAncestor('b', units)?.id).toBe('a')
  })

  it('returns undefined when no ancestor is combined', () => {
    const units = [
      unit({ id: 'a', is_container: true }),
      unit({ id: 'b', parent_unit: 'a', is_container: true }),
    ]
    expect(combinedAncestor('a', units)).toBeUndefined()
  })

  // Same shape as descendantIds' matching test above, and for the same
  // reason: guardUnitParentCycle (#1899) blocks a NEW cycle from being
  // written but cannot un-write one already sitting in the database from
  // before that hook existed, and this walk has no way to know whether the
  // hook ran on any given row. The `seen` guard is what stops a cycle
  // already in the data from hanging the admin form — a refactor that
  // dropped it would hang UnitIdentityFields on mount, not fail a test with
  // a readable diff.
  it('terminates on already-cyclic stored data', () => {
    const units = [
      unit({ id: 'a', parent_unit: 'b', is_container: true }),
      unit({ id: 'b', parent_unit: 'a', is_container: true }),
    ]
    expect(combinedAncestor('a', units)).toBeUndefined()
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
    const ids = parentCandidates('a', units, '').map((u) => u.id)
    expect(ids).not.toContain('a')
    expect(ids).toEqual(['b'])
  })

  it('excludes non-container units — a room may not be a parent', () => {
    const units = [unit({ id: 'a', is_container: true }), unit({ id: 'b', is_container: false })]
    expect(parentCandidates('a', units, '')).toEqual([])
  })

  it('excludes a direct child, which would create a cycle', () => {
    const units = [
      unit({ id: 'a', is_container: true }),
      unit({ id: 'b', parent_unit: 'a', is_container: true }),
    ]
    expect(parentCandidates('a', units, '').map((u) => u.id)).not.toContain('b')
  })

  it('excludes a grandchild, not just a direct child', () => {
    const units = [
      unit({ id: 'a', is_container: true }),
      unit({ id: 'b', parent_unit: 'a', is_container: true }),
      unit({ id: 'c', parent_unit: 'b', is_container: true }),
    ]
    const ids = parentCandidates('a', units, '').map((u) => u.id)
    expect(ids).not.toContain('b')
    expect(ids).not.toContain('c')
  })

  it('offers every container on create, since there is no self or descendant yet', () => {
    const units = [unit({ id: 'a', is_container: true }), unit({ id: 'b', is_container: true })]
    expect(parentCandidates(undefined, units, '').map((u) => u.id)).toEqual(['a', 'b'])
  })
})

describe('parentCandidates — scoped to the area', () => {
  const NORTH = 'area_north'
  const SOUTH = 'area_south'

  it('offers only containers in the same area', () => {
    // A room's building is on the same patch of ground as the room. Every one
    // of the 28 parent/child pairs on site is same-area, so an out-of-area
    // container in the picker is never the answer — it is only a chance to
    // parent a cabin to a building across camp by mis-clicking.
    const units = [
      unit({ id: 'child', area: NORTH }),
      unit({ id: 'near', area: NORTH, is_container: true }),
      unit({ id: 'far', area: SOUTH, is_container: true }),
    ]

    const ids = parentCandidates('child', units, '', NORTH).map((u) => u.id)
    expect(ids).toEqual(['near'])
  })

  it('keeps the parent a unit already has, even from another area', () => {
    // Filtering a stored parent out of its own picker would leave the select
    // with no matching option: it would fall to the first entry, and the next
    // save would silently REPARENT the unit the staffer only meant to rename.
    // The caller passes the CURRENT parent explicitly (#2065) — on initial
    // load that's the stored value, `unit.parent_unit`, but this function no
    // longer looks it up itself.
    const units = [
      unit({ id: 'child', area: NORTH, parent_unit: 'far' }),
      unit({ id: 'near', area: NORTH, is_container: true }),
      unit({ id: 'far', area: SOUTH, is_container: true }),
    ]

    const ids = parentCandidates('child', units, 'far', NORTH).map((u) => u.id)
    expect(ids).toContain('far')
    expect(ids).toContain('near')
  })

  it('offers every container when no area is given', () => {
    const units = [
      unit({ id: 'near', area: NORTH, is_container: true }),
      unit({ id: 'far', area: SOUTH, is_container: true }),
    ]

    expect(parentCandidates(undefined, units, '').map((u) => u.id)).toEqual(['near', 'far'])
  })
})

describe('parentCandidates — scoped to how the unit is used', () => {
  const A = 'area_1'

  it('hides staff housing from a guest room', () => {
    // A guest room is never a room inside staff housing — no unit on site is.
    // Both buildings stand in the same area, so the area filter alone still
    // offers the wrong one.
    const units = [
      unit({ id: 'guest-room', area: A, inventory_class: 'family_pool' }),
      unit({ id: 'guest-bldg', area: A, is_container: true, inventory_class: 'family_pool' }),
      unit({ id: 'staff-bldg', area: A, is_container: true, inventory_class: 'staff_default' }),
    ]

    const ids = parentCandidates('guest-room', units, '', A, 'family_pool').map((u) => u.id)
    expect(ids).toEqual(['guest-bldg'])
  })

  it('offers a staff room BOTH, because staff rooms do sit in guest buildings', () => {
    // The rule is deliberately asymmetric. One building on site is a guest
    // building holding two guest rooms and one staff room, so a symmetric
    // "classes must match" would deny a new staff room there its real parent.
    const units = [
      unit({ id: 'staff-room', area: A, inventory_class: 'staff_default' }),
      unit({ id: 'guest-bldg', area: A, is_container: true, inventory_class: 'family_pool' }),
      unit({ id: 'staff-bldg', area: A, is_container: true, inventory_class: 'staff_default' }),
    ]

    const ids = parentCandidates('staff-room', units, '', A, 'staff_default').map((u) => u.id)
    expect(ids).toEqual(['guest-bldg', 'staff-bldg'])
  })

  it('keeps a parent a guest unit already has inside staff housing', () => {
    // No such pair exists today, and the escape is why one appearing later
    // does not get silently reparented on the next unrelated save.
    const units = [
      unit({
        id: 'guest-room',
        area: A,
        inventory_class: 'family_pool',
        parent_unit: 'staff-bldg',
      }),
      unit({ id: 'staff-bldg', area: A, is_container: true, inventory_class: 'staff_default' }),
    ]

    expect(
      parentCandidates('guest-room', units, 'staff-bldg', A, 'family_pool').map((u) => u.id)
    ).toContain('staff-bldg')
  })

  // #2065: `parentCandidates` used to spare the STORED parent
  // (`units.find((u) => u.id === unitId)?.parent_unit`) rather than the LIVE
  // selection the caller is about to render. This reproduces the narrowing
  // direction the widening test above's sibling (#2051) never covered: a
  // guest room picks a staff parent while Allocation is briefly "staff",
  // then Allocation flips back to "guest" — the stored record was never
  // saved, so a stored-parent lookup would still return '', but the LIVE,
  // not-yet-saved selection is the staff building.
  it('spares the LIVE selection when narrowing, not the stale stored parent', () => {
    const units = [
      unit({ id: 'guest-room', area: A, inventory_class: 'family_pool' }), // stored parent_unit: ''
      unit({ id: 'guest-bldg', area: A, is_container: true, inventory_class: 'family_pool' }),
      unit({ id: 'staff-bldg', area: A, is_container: true, inventory_class: 'staff_default' }),
    ]

    // Live selection is staff-bldg even though the stored record's
    // parent_unit is still ''.
    const ids = parentCandidates('guest-room', units, 'staff-bldg', A, 'family_pool').map(
      (u) => u.id
    )
    expect(ids).toContain('staff-bldg')
  })
})
