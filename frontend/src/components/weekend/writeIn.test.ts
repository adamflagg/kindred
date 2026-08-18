/**
 * A write-in is a named occupant of a space — kindred#2078, kindred#2382.
 *
 * The single definition of "is somebody written into this room", and the one
 * the board reads. It exists because #2093's forest open-tint was written
 * against the PROXY `unit.family_available_override === false` under the name
 * `held`, and a rename alone would have left the tint keyed on a spelling
 * rather than on the fact.
 *
 * THAT PROXY IS GONE, which is what these tests now pin. kindred#2382 moved
 * occupancy into its own table and stopped the wire spelling one as
 * `family_available_override === false`; that field answers the staff↔family
 * ROLE and nothing else. Every fixture below that means "somebody is in it"
 * therefore carries a `write_in`, and a bare `false` means "closed by role",
 * which names nobody.
 *
 * Fictional data throughout. Production write-in notes are real family and
 * staff names; nothing here is dumped from any database.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow, WriteInCoverRow } from '../../types/lodging'
import { writeInOccupant, writeInSource } from './writeIn'

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'cedar-1',
    name: 'Cedar 1',
    area_code: 'CG',
    area_name: 'Cedar Grove',
    sleeps: 4,
    bathroom: 'shared',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    is_confirmed: false,
    is_active: true,
    is_container: false,
    inventory_class: 'family_pool',
    family_available_override: null,
    occupant_name: '',
    reason: '',
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

/** The server-resolved cover, which is the ONLY source of "somebody is in it". */
function cover(overrides: Partial<WriteInCoverRow> = {}): WriteInCoverRow {
  return {
    unit_id: 'u1',
    unit_code: 'cedar-1',
    unit_name: 'Cedar 1',
    occupant_name: '',
    note: '',
    ...overrides,
  }
}

describe('writeInOccupant', () => {
  it('names the occupant of a room somebody has been written into', () => {
    expect(
      writeInOccupant(
        unit({
          write_in: cover({ occupant_name: 'Emma Johnson', note: 'Kitchen lead, Fri–Sun' }),
          occupant_name: 'Emma Johnson',
          reason: 'Kitchen lead, Fri–Sun',
          is_family_available: false,
        })
      )
    ).toEqual({ name: 'Emma Johnson', note: 'Kitchen lead, Fri–Sun' })
  })

  it('is null for a room the ROLE closed, which names nobody', () => {
    // kindred#2382. `family_available_override === false` used to BE the
    // write-in — the occupancy and the staff↔family role shared one boolean.
    // With the two apart, a bare `false` is a role decision ("closed this
    // weekend") with no occupant behind it, and reading it as a write-in would
    // have the card report somebody who exists in no row anywhere.
    expect(
      writeInOccupant(unit({ family_available_override: false, is_family_available: false }))
    ).toBeNull()
    expect(
      writeInSource(unit({ family_available_override: false, is_family_available: false }))
    ).toBeNull()
  })

  it('is null for a room nobody has written into', () => {
    // `null` on the override means "no row for this weekend, ask the unit's
    // role" — not "closed". Collapsing the two is the failure `reservationBadge`
    // documents at length, arriving one module over.
    expect(writeInOccupant(unit())).toBeNull()
    expect(writeInOccupant(unit({ family_available_override: null }))).toBeNull()
  })

  it('is null for a staff cabin RELEASED to families', () => {
    // A release opens a room; it names no occupant. `true` and `false` are
    // opposite answers and only one of them is a write-in.
    expect(
      writeInOccupant(
        unit({
          inventory_class: 'staff_default',
          family_available_override: true,
          reason: 'Overflow',
        })
      )
    ).toBeNull()
  })

  it('still reports a write-in whose occupant nobody named', () => {
    // Reachable from a row written before 1500000148, or through the API,
    // which is permissive where the control is not. The room is still closed,
    // so reporting "no write-in" here would hand it back to the open-tint and
    // send staff at the one room they may not fill.
    expect(writeInOccupant(unit({ write_in: cover(), is_family_available: false }))).toEqual({
      name: '',
      note: '',
    })
  })

  it('treats a whitespace-only occupant as unnamed rather than as a name', () => {
    expect(
      writeInOccupant(
        unit({ write_in: cover({ occupant_name: '   ' }), is_family_available: false })
      )
    ).toEqual({ name: '', note: '' })
  })

  it('does not fall back to the note when the occupant is unnamed', () => {
    // 1500000148 MOVED every historical note into `occupant_name` and cleared
    // the column behind it, precisely so one string cannot render twice on one
    // card. A fallback here would restore that double-print by another route.
    expect(
      writeInOccupant(
        unit({
          write_in: cover({ note: 'Back Monday' }),
          reason: 'Back Monday',
          is_family_available: false,
        })
      )
    ).toEqual({ name: '', note: 'Back Monday' })
  })
})

describe('a write-in resolved through the unit tree', () => {
  /*
   * THE ROW NAMES ONE UNIT; IT CLOSES A SPACE. The server resolves which units
   * a write-in covers (`write_in_covers`), because the board draws whichever
   * level the tree resolves to and a merge or split moves that level under
   * staff's feet. Read through this module, both directions arrive as the same
   * fact — which is the whole reason the fact has a name.
   */
  const inherited = unit({
    code: 'house-a',
    write_in: {
      unit_id: 'id-house',
      unit_code: 'house',
      unit_name: 'House',
      occupant_name: 'Liam Garcia',
      note: 'Back Monday',
    },
  })

  it('names the occupant of a room its BUILDING was written into', () => {
    expect(writeInOccupant(inherited)).toEqual({ name: 'Liam Garcia', note: 'Back Monday' })
  })

  it('reports the row it came from, and that it is not this unit’s own', () => {
    expect(writeInSource(inherited)).toEqual({
      unitId: 'id-house',
      unitCode: 'house',
      unitName: 'House',
      isOwn: false,
    })
  })

  it('marks a unit’s OWN row as its own, so the card does not attribute it elsewhere', () => {
    const own = unit({
      code: 'cedar-1',
      write_in: {
        unit_id: 'u1',
        unit_code: 'cedar-1',
        unit_name: 'Cedar 1',
        occupant_name: 'Emma Johnson',
        note: '',
      },
    })

    expect(writeInSource(own)?.isOwn).toBe(true)
  })

  it('reads the cover and never the old proxy, so a role row cannot fake one', () => {
    // THE COMPAT SHIM, retired by kindred#2382 PR 4. This used to synthesise a
    // cover from `family_available_override === false` plus the unit's own
    // `occupant_name`, because the wire had no other way to say "somebody is in
    // it". It has one now — `write_in` is resolved server-side on every unit —
    // and the old spelling means something else entirely, so reading it would
    // report an occupant a role-closed cabin does not have.
    expect(
      writeInOccupant(
        unit({
          family_available_override: false,
          occupant_name: 'Emma Johnson',
          is_family_available: false,
        })
      )
    ).toBeNull()
  })

  it('says nothing when neither a cover nor an own row closes the space', () => {
    expect(writeInOccupant(unit())).toBeNull()
    expect(writeInSource(unit())).toBeNull()
  })
})
