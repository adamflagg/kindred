/**
 * Sharing a bathroom is SYMMETRIC and `bathroom_group` is a string per unit,
 * so every assertion a staffer makes on one room's form has to land on the
 * other rooms' records too. These cases pin the write set that makes that
 * true — and, above all, the REMOVAL direction, which is the one that can
 * recreate the group-of-one this feature exists to eliminate.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRecord } from '../../../types/lodging'
import {
  resolveShareGroupId,
  sharePeerCandidates,
  sharePeerWrites,
  storedPeerIds,
} from './bathroomShare'

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
    is_weatherized: false,
    has_plumbing: false,
    has_space_heater: false,
    has_lights: false,
    has_heat: false,
    has_pack_play_space: false,
    has_kitchen: false,
    has_living_room: false,
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

/** A container with three rooms under it; the first two already share a bath. */
function house(): LodgingUnitRecord[] {
  return [
    unit({ id: 'house', code: 'hh', name: 'Hall House', is_container: true }),
    unit({ id: 'r1', name: 'Room One', parent_unit: 'house', bathroom_group: 'hh-hall' }),
    unit({ id: 'r2', name: 'Room Two', parent_unit: 'house', bathroom_group: 'hh-hall' }),
    unit({ id: 'r3', name: 'Room Three', parent_unit: 'house' }),
  ]
}

describe('storedPeerIds', () => {
  it('lists the other rooms carrying the same group id', () => {
    const units = house()
    expect(storedPeerIds(units[1], units)).toEqual(['r2'])
  })

  it('is empty for a room in no group, so no chip claims a share nobody made', () => {
    const units = house()
    expect(storedPeerIds(units[3], units)).toEqual([])
  })

  it('is empty on create, when there is no room yet to share from', () => {
    expect(storedPeerIds(undefined, house())).toEqual([])
  })
})

describe('sharePeerCandidates', () => {
  it('offers the other rooms under the same parent that are not already listed', () => {
    const units = house()
    const offered = sharePeerCandidates('r1', 'house', ['r2'], units, 'hh-hall')
    expect(offered.map((u) => u.id)).toEqual(['r3'])
  })

  it('offers nothing once every sibling is listed — the common production shape', () => {
    const units = house()
    expect(sharePeerCandidates('r1', 'house', ['r2', 'r3'], units, 'hh-hall')).toEqual([])
  })

  it('never offers a room that already shares a DIFFERENT bathroom', () => {
    // Adding it would merge two bathrooms into one and orphan whatever is left
    // of the other group. That is a move, not an add, and it is made from the
    // other room's own form.
    const units = house()
    units[3] = { ...units[3], bathroom_group: 'hh-other' } as LodgingUnitRecord
    expect(sharePeerCandidates('r1', 'house', ['r2'], units, 'hh-hall')).toEqual([])
  })

  it('offers nothing for a parentless room, which falls back to the raw id field', () => {
    expect(sharePeerCandidates('r1', '', [], house(), '')).toEqual([])
  })
})

describe('resolveShareGroupId', () => {
  it('keeps the id the room already carries when a room is added', () => {
    const units = house()
    expect(resolveShareGroupId('hh-hall', ['r2', 'r3'], units, units[0])).toBe('hh-hall')
  })

  it('adopts the listed room’s group when this room has none', () => {
    const units = house()
    expect(resolveShareGroupId('', ['r1'], units, units[0])).toBe('hh-hall')
  })

  it('derives a fresh id from the parent when neither room has a group', () => {
    const units = house()
    expect(resolveShareGroupId('', ['r3'], units, units[0])).toBe('hh')
  })

  it('does not collide with a group id already in use under that parent', () => {
    const units = house()
    units[1] = { ...units[1], bathroom_group: 'hh' } as LodgingUnitRecord
    units[2] = { ...units[2], bathroom_group: 'hh' } as LodgingUnitRecord
    expect(resolveShareGroupId('', ['r3'], units, units[0])).toBe('hh-2')
  })

  it('clears the group when the last listed room is removed', () => {
    // Leaving the edited room carrying a group nobody else is in is the
    // group-of-one this whole feature exists to eliminate.
    const units = house()
    expect(resolveShareGroupId('hh-hall', [], units, units[0])).toBe('')
  })
})

describe('sharePeerWrites', () => {
  it('writes nothing when the listed rooms are exactly the stored ones', () => {
    const units = house()
    expect(sharePeerWrites('r1', 'hh-hall', ['r2'], 'hh-hall', units)).toEqual([])
  })

  it('writes the group onto a newly listed room', () => {
    const units = house()
    expect(sharePeerWrites('r1', 'hh-hall', ['r2', 'r3'], 'hh-hall', units)).toEqual([
      { id: 'r3', name: 'Room Three', bathroom_group: 'hh-hall' },
    ])
  })

  it('CLEARS a removed room, rather than only the edited one', () => {
    // The owner ruled removal symmetric. Dropping r2 from r1's list while
    // leaving r2's column set would keep the roster matching families on a
    // share the staffer just said does not exist.
    const units = house()
    expect(sharePeerWrites('r1', 'hh-hall', [], '', units)).toEqual([
      { id: 'r2', name: 'Room Two', bathroom_group: '' },
    ])
  })

  it('leaves the rest of a larger group alone when one room is dropped', () => {
    const units = [...house(), unit({ id: 'r4', name: 'Room Four', parent_unit: 'house' })]
    units[3] = { ...units[3], bathroom_group: 'hh-hall' } as LodgingUnitRecord
    // Group is r1 + r2 + r3; drop r3 only.
    expect(sharePeerWrites('r1', 'hh-hall', ['r2'], 'hh-hall', units)).toEqual([
      { id: 'r3', name: 'Room Three', bathroom_group: '' },
    ])
  })

  it('writes every listed room on create, where there is no stored group to diff against', () => {
    const units = house()
    expect(sharePeerWrites(undefined, '', ['r3'], 'hh', units)).toEqual([
      { id: 'r3', name: 'Room Three', bathroom_group: 'hh' },
    ])
  })

  it('never writes the edited room itself — that is the form’s own payload', () => {
    const units = house()
    const writes = sharePeerWrites('r1', 'hh-hall', ['r2', 'r3'], 'hh-hall', units)
    expect(writes.some((w) => w.id === 'r1')).toBe(false)
  })
})
