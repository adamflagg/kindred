/**
 * A write-in is a named global occupant — kindred#2078.
 *
 * The single definition of "is somebody written into this room", and the one
 * the board reads. It exists because #2093's forest open-tint was written
 * against the PROXY `unit.family_available_override === false` under the name
 * `held`, and a rename alone would have left the tint keyed on a spelling
 * rather than on the fact.
 *
 * Fictional data throughout. Production write-in notes are real family and
 * staff names; nothing here is dumped from any database.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow } from '../../types/lodging'
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

describe('writeInOccupant', () => {
  it('names the occupant of a room somebody has been written into', () => {
    expect(
      writeInOccupant(
        unit({
          family_available_override: false,
          occupant_name: 'Emma Johnson',
          reason: 'Kitchen lead, Fri–Sun',
          is_family_available: false,
        })
      )
    ).toEqual({ name: 'Emma Johnson', note: 'Kitchen lead, Fri–Sun' })
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
    expect(
      writeInOccupant(unit({ family_available_override: false, is_family_available: false }))
    ).toEqual({ name: '', note: '' })
  })

  it('treats a whitespace-only occupant as unnamed rather than as a name', () => {
    expect(
      writeInOccupant(
        unit({ family_available_override: false, occupant_name: '   ', is_family_available: false })
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
          family_available_override: false,
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
      family_available_override: false,
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

  it('falls back to the unit’s own row when the payload carries no cover at all', () => {
    // A payload from a server older than the resolution pass has no `write_in`
    // — Pydantic fields with a default render OPTIONAL in TypeScript. The only
    // wrong answer to give there is a PERMISSIVE one: reading the absence as
    // "nobody is in it" would re-open a closed cabin and invite a drop into an
    // occupied room, which is the exact failure the cover exists to prevent.
    expect(
      writeInOccupant(unit({ family_available_override: false, occupant_name: 'Emma Johnson' }))
    ).toEqual({ name: 'Emma Johnson', note: '' })
  })

  it('says nothing when neither a cover nor an own row closes the space', () => {
    expect(writeInOccupant(unit())).toBeNull()
    expect(writeInSource(unit())).toBeNull()
  })
})
