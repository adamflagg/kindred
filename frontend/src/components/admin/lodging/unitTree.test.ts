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
import {
  combinedAncestor,
  descendantIds,
  directChildren,
  flattenUnitTree,
  parentCandidates,
  pinAncestor,
} from './unitTree'

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

describe('flattenUnitTree', () => {
  // #2082: the lodging table renders in TREE order — a parent's row
  // immediately followed by its own subtree — so the depth used for the
  // indent has to come from walking `parent_unit`, not from `!== ''`.
  // Measured on production: 79 roots / 21 at depth 1 / 18 at depth 2, and
  // three containers hold container children, so a one-level model would
  // put 18 of 118 rows at the wrong depth.
  it('computes depth from a parent_unit walk, not from merely having a parent', () => {
    const units = [
      unit({ id: 'building', is_container: true }),
      unit({ id: 'room', parent_unit: 'building', is_container: true }),
      unit({ id: 'bunk', parent_unit: 'room' }),
    ]
    const rows = flattenUnitTree(units, { field: 'name', desc: false })
    expect(rows.map((r) => [r.unit.id, r.depth])).toEqual([
      ['building', 0],
      ['room', 1],
      ['bunk', 2],
    ])
  })

  it('sorts a sibling set by the chosen column while it stays under its parent', () => {
    const units = [
      unit({ id: 'building', is_container: true }),
      unit({ id: 'room-b', parent_unit: 'building', sleeps: 2 }),
      unit({ id: 'room-a', parent_unit: 'building', sleeps: 4 }),
    ]
    // Ascending by sleeps: room-b (2) before room-a (4) — the reverse of
    // name order — proving the column, not the name tiebreak, drove this.
    const rows = flattenUnitTree(units, { field: 'sleeps', desc: false })
    expect(rows.map((r) => r.unit.id)).toEqual(['building', 'room-b', 'room-a'])
  })

  // This is the case #2082 rules out shipping without: "indent-plus-
  // unchanged-flat-sort" would let a child whose own sort key ranks ahead of
  // ANOTHER root's row read as indented under that other root — a FALSE
  // PARENT. Tree-order-always means the column only ranks siblings; a root
  // and its whole subtree move together.
  it('keeps a root and its subtree together even when a child would outrank another root by the sorted column', () => {
    const units = [
      unit({ id: 'big-building', is_container: true, sleeps: 20 }),
      unit({ id: 'big-building-room', parent_unit: 'big-building', sleeps: 1 }),
      unit({ id: 'small-building', is_container: true, sleeps: 2 }),
    ]
    const rows = flattenUnitTree(units, { field: 'sleeps', desc: false })
    expect(rows.map((r) => r.unit.id)).toEqual([
      'small-building',
      'big-building',
      'big-building-room',
    ])
  })

  // A unit whose area was deleted lands in `groupUnitsByArea`'s trailing
  // `__unassigned__` bucket (see unitSort.test.ts) alongside units it has no
  // real relationship to — its actual parent, if it has one, is not
  // guaranteed to be in that same bucket. This must render rather than
  // crash the walk on a parent lookup that can't find its target.
  it('renders a unit whose parent is outside this group flat, at depth 0, instead of crashing the walk', () => {
    const units = [unit({ id: 'orphan', parent_unit: 'not-in-this-group' })]
    const rows = flattenUnitTree(units, { field: 'name', desc: false })
    expect(rows).toEqual([{ unit: units[0], depth: 0 }])
  })

  // Same rationale as descendantIds' and combinedAncestor's matching tests
  // above: guardUnitParentCycle (#1899) cannot un-write a cycle already
  // sitting in the database from before it existed, and this walk has no
  // way to know whether the hook ran on any given row. Unlike those two
  // walks, this one starts from ROOTS rather than from a known id — a pure
  // cycle with no unit reachable from an actual root would never be found by
  // a top-down walk at all, so every member has to be picked up afterward
  // rather than silently dropped from the roster.
  it('terminates on already-cyclic stored data and renders every member once, rather than dropping it', () => {
    const units = [
      unit({ id: 'a', parent_unit: 'b', is_container: true }),
      unit({ id: 'b', parent_unit: 'a', is_container: true }),
    ]
    const rows = flattenUnitTree(units, { field: 'name', desc: false })
    expect(rows.map((r) => r.unit.id).sort()).toEqual(['a', 'b'])
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

/**
 * kindred#2440 — which unit's coordinate the map will actually draw this one
 * at, so the admin panel can offer the pin editor to exactly that unit.
 *
 * THE MIRROR OF `mapModel`'s `pinFor`, in ids rather than codes. It lived
 * inline in `LodgingUnitForm` for one commit and disagreed with the map on two
 * shapes — a rho cycle and a self-parent — because it advanced before checking
 * the repeat, and it had no tests at all. It is here beside `combinedAncestor`
 * because that is the id-keyed ancestor walk this file already owns, and it
 * borrows its guard idiom: check the NEXT hop before stepping onto it.
 *
 * "Positioned" is the map's own `hasCoordinates`, imported rather than
 * re-spelled — PocketBase stores an unset number as 0, and a second copy of
 * "both axes zero means unset" is how the (0,0) trap gets back in.
 */
describe('pinAncestor — the unit whose pin the map actually draws (kindred#2440)', () => {
  const HOUSE = [
    unit({ id: 'house', is_container: true, map_x: 0.4, map_y: 0.5 }),
    unit({ id: 'up', is_container: true, parent_unit: 'house', map_x: 0.41, map_y: 0.51 }),
    unit({ id: 'r1', parent_unit: 'up', map_x: 0.42, map_y: 0.52 }),
  ]

  it('returns the ROOT for a room two levels down, not its half', () => {
    expect(pinAncestor('up', HOUSE)?.id).toBe('house')
  })

  it('returns nothing for a parentless unit, which carries its own pin', () => {
    expect(pinAncestor('', HOUSE)).toBeUndefined()
  })

  it('returns nothing when the parent is not in the payload', () => {
    expect(pinAncestor('missing', HOUSE)).toBeUndefined()
  })

  it('skips an UNPOSITIONED root and offers the positioned half instead', () => {
    // A building created in the admin panel starts with no coordinate, so this
    // is ordinary workflow rather than bad data. `pinFor` draws the room at the
    // half here, so the half is what the staffer must be sent to.
    const unpositionedRoot = [
      unit({ id: 'house', is_container: true, map_x: 0, map_y: 0 }),
      unit({ id: 'up', is_container: true, parent_unit: 'house', map_x: 0.41, map_y: 0.51 }),
      unit({ id: 'r1', parent_unit: 'up', map_x: 0.42, map_y: 0.52 }),
    ]
    expect(pinAncestor('up', unpositionedRoot)?.id).toBe('up')
  })

  it('returns nothing when no ancestor is positioned, so the unit keeps its own', () => {
    const noneAbove = [
      unit({ id: 'house', is_container: true, map_x: 0, map_y: 0 }),
      unit({ id: 'up', is_container: true, parent_unit: 'house', map_x: 0, map_y: 0 }),
    ]
    expect(pinAncestor('up', noneAbove)).toBeUndefined()
  })

  it('terminates on a rho cycle entered from outside it', () => {
    // `parent -> a -> b -> c -> b`. The inline version advanced before checking
    // and resolved this differently from `mapBuildingKey`.
    const rho = [
      unit({ id: 'a', is_container: true, parent_unit: 'b', map_x: 0.1, map_y: 0.1 }),
      unit({ id: 'b', is_container: true, parent_unit: 'c', map_x: 0.2, map_y: 0.2 }),
      unit({ id: 'c', is_container: true, parent_unit: 'b', map_x: 0.3, map_y: 0.3 }),
    ]
    expect(pinAncestor('a', rho)?.id).toBe('c')
  })

  it('does not send a self-parented unit to itself', () => {
    // It would otherwise hide the editor and say "Drawn at <itself>'s pin" for
    // the very coordinate the map reads.
    const selfish = [
      unit({ id: 'a', is_container: true, parent_unit: 'a', map_x: 0.1, map_y: 0.1 }),
    ]
    expect(pinAncestor('a', selfish)?.id).toBe('a')
  })
})
