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

// r -> a -> b -> a: a back-edge reachable from a real root (simulating
// corrupted parent links the server-side guardUnitParentCycle should
// prevent, but the frontend must not trust blindly). The duplicate `code:
// 'a'` entry is the only way to construct a graph cycle reachable from a
// genuine root — a mutual pair with no path from a root is excluded from
// the walk before the guard is ever exercised. Shared by the drawnUnits and
// coveredCodes cycle tests below: both functions carry the same
// Set<string>-keyed visited guard over the same children-by-parent map.
//
// EVERY node here is `is_container: true`. Leaf-ness (Task 6) now gates
// descent: a leaf draws immediately and its kids are never queued, so a
// leaf anywhere on r -> a -> b would stop the walk before it ever reached
// the back-edge and the guard would never be exercised. Only a container
// gets its children queued at all, which is what lets the walk actually
// reach the repeated `a` and put the visited guard to work. u()'s
// `is_container: false` default made this fixture inert the moment
// leaf-ness stopped being `kids.length === 0` — every node became a leaf
// and `drawnUnits`/`coveredCodes` returned after `r` alone, never
// descending far enough to revisit anything.
const CYCLIC = [
  u({ code: 'r', is_container: true }),
  u({ code: 'a', parent_code: 'r', is_container: true }),
  u({ code: 'b', parent_code: 'a', is_container: true }),
  u({ code: 'a', parent_code: 'b', is_container: true }),
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
    // The visited guard must stop the walk rather than loop forever.
    expect(() => drawnUnits(CYCLIC)).not.toThrow()
  })

  it('treats a unit whose parent_code names an absent unit as a root, not a dropped orphan', () => {
    // A caller can pass a subset of units — e.g. a session-filtered array —
    // where a room's parent_code points at a container excluded from that
    // subset. The room must still be treated as a root and drawn: a dropped
    // unit here is a room that vanishes from the board, which the brief
    // names as the one failure mode this function must never produce.
    const filtered = [u({ code: 'room', parent_code: 'missing-container' })]
    expect(drawnUnits(filtered).map((x) => x.code)).toEqual(['room'])
  })

  it('never draws a container even when its children are all absent from the array', () => {
    // Leaf-ness reads the `is_container` FLAG, not child count. A container
    // never gets a card unless combined — its halves already carry the beds,
    // and drawing the building on top double-counts them (408 against a true
    // 389, owner-confirmed in boardLayout.ts). A childless container is a
    // momentary state, not license to treat it as bookable: inferring
    // "this is a leaf" from an empty child list infers from missing data,
    // which is exactly what the flag exists to prevent. (This inverts what
    // this test asserted before fix round 1 — pinning kids.length === 0 as
    // leaf-like was the wrong call.)
    const lonelyContainer = u({ code: 'lone-container', is_container: true })
    expect(drawnUnits([lonelyContainer])).toEqual([])
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

  it('terminates on a cycle already in the data, instead of hanging the board', () => {
    // Mirrors the drawnUnits cycle test above with the same CYCLIC fixture
    // and the same visited-guard shape, starting the walk from the root.
    const r = CYCLIC[0]!
    expect(() => coveredCodes(r, CYCLIC)).not.toThrow()
  })

  it('returns nothing beneath a childless container, rather than treating it as its own leaf', () => {
    // Mirrors the drawnUnits inversion above (fix round 1): a container with
    // no children in the array is not a bookable leaf, so fan-down onto it
    // must yield `[]` — which boardLayout.ts routes a naming party to
    // `offBoard` — never `[unit.code]`, which would fabricate a card.
    const lonelyContainer = u({ code: 'lone-container', is_container: true })
    expect(coveredCodes(lonelyContainer, [lonelyContainer])).toEqual([])
  })
})
