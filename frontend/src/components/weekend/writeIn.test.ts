/**
 * A write-in is a named occupant of a space — kindred#2078, kindred#2382, kindred#2381.
 *
 * The single definition of "who is written into this space", and the one the
 * board reads. It exists because #2093's forest open-tint was written against
 * the PROXY `unit.family_available_override === false` under the name `held`,
 * and a rename alone would have left the tint keyed on a spelling rather than
 * on the fact.
 *
 * THAT PROXY IS GONE, which is what these tests pin. kindred#2382 moved
 * occupancy into its own table and stopped the wire spelling one as
 * `family_available_override === false`; that field answers the staff↔family
 * ROLE and nothing else. Every fixture below that means "somebody is in it"
 * therefore carries a `write_ins` entry, and a bare `false` means "closed by
 * role", which names nobody.
 *
 * PLURAL since kindred#2381. A merged container draws in place of its rooms,
 * so a card can cover several written-into rooms at once and every one of them
 * has to reach the screen.
 *
 * Fictional data throughout. Production write-in notes are real family and
 * staff names; nothing here is dumped from any database.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow, WriteInCoverRow } from '../../types/lodging'
import { hasWriteIn, writeInEntries } from './writeIn'

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

describe('writeInEntries', () => {
  it('names the occupant of a room somebody has been written into', () => {
    expect(
      writeInEntries(
        unit({
          write_ins: [cover({ occupant_name: 'Emma Johnson', note: 'Kitchen lead, Fri–Sun' })],
          occupant_name: 'Emma Johnson',
          reason: 'Kitchen lead, Fri–Sun',
          is_family_available: false,
        })
      ).map((entry) => entry.occupant)
    ).toEqual([{ name: 'Emma Johnson', note: 'Kitchen lead, Fri–Sun' }])
  })

  it('is empty for a room the ROLE closed, which names nobody', () => {
    // kindred#2382. `family_available_override === false` used to BE the
    // write-in — the occupancy and the staff↔family role shared one boolean.
    // With the two apart, a bare `false` is a role decision ("closed this
    // weekend") with no occupant behind it, and reading it as a write-in would
    // have the card report somebody who exists in no row anywhere.
    const roleClosed = unit({ family_available_override: false, is_family_available: false })
    expect(writeInEntries(roleClosed)).toEqual([])
    expect(hasWriteIn(roleClosed)).toBe(false)
  })

  it('is empty for a room nobody has written into', () => {
    // `null` on the override means "no row for this weekend, ask the unit's
    // role" — not "closed". Collapsing the two is the failure `reservationBadge`
    // documents at length, arriving one module over.
    expect(writeInEntries(unit())).toEqual([])
    expect(writeInEntries(unit({ family_available_override: null }))).toEqual([])
  })

  it('is empty for a staff cabin RELEASED to families', () => {
    // A release opens a room; it names no occupant. `true` and `false` are
    // opposite answers and only one of them is a write-in.
    expect(
      writeInEntries(
        unit({
          inventory_class: 'staff_default',
          family_available_override: true,
          reason: 'Overflow',
        })
      )
    ).toEqual([])
  })

  it('still reports a write-in whose occupant nobody named', () => {
    // Reachable from a row written before 1500000148, or through the API,
    // which is permissive where the control is not. The room is still closed,
    // so reporting "no write-in" here would hand it back to the open-tint and
    // send staff at the one room they may not fill.
    const entries = writeInEntries(unit({ write_ins: [cover()], is_family_available: false }))
    expect(entries.map((entry) => entry.occupant)).toEqual([{ name: '', note: '' }])
  })

  it('treats a whitespace-only occupant as unnamed rather than as a name', () => {
    expect(
      writeInEntries(
        unit({ write_ins: [cover({ occupant_name: '   ' })], is_family_available: false })
      ).map((entry) => entry.occupant)
    ).toEqual([{ name: '', note: '' }])
  })

  it('does not fall back to the note when the occupant is unnamed', () => {
    // 1500000148 MOVED every historical note into `occupant_name` and cleared
    // the column behind it, precisely so one string cannot render twice on one
    // card. A fallback here would restore that double-print by another route.
    expect(
      writeInEntries(
        unit({
          write_ins: [cover({ note: 'Back Monday' })],
          reason: 'Back Monday',
          is_family_available: false,
        })
      ).map((entry) => entry.occupant)
    ).toEqual([{ name: '', note: 'Back Monday' }])
  })

  it('treats a payload with no write_ins key at all as uncovered', () => {
    // The field is OPTIONAL on the wire, so an older or partial payload omits
    // it entirely. `undefined` is "no cover", never a crash on `.length`.
    const bare = unit()
    delete (bare as { write_ins?: unknown }).write_ins
    expect(writeInEntries(bare)).toEqual([])
    expect(hasWriteIn(bare)).toBe(false)
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
    write_ins: [
      {
        unit_id: 'id-house',
        unit_code: 'house',
        unit_name: 'House',
        occupant_name: 'Liam Garcia',
        note: 'Back Monday',
      },
    ],
  })

  it('names the occupant of a room its BUILDING was written into', () => {
    expect(writeInEntries(inherited).map((entry) => entry.occupant)).toEqual([
      { name: 'Liam Garcia', note: 'Back Monday' },
    ])
  })

  it('reports the row it came from, and that it is not this unit’s own', () => {
    expect(writeInEntries(inherited).map((entry) => entry.source)).toEqual([
      { unitId: 'id-house', unitCode: 'house', unitName: 'House', isOwn: false },
    ])
  })

  it('marks a unit’s OWN row as its own, so the card does not attribute it elsewhere', () => {
    const own = unit({
      code: 'cedar-1',
      write_ins: [
        {
          unit_id: 'u1',
          unit_code: 'cedar-1',
          unit_name: 'Cedar 1',
          occupant_name: 'Emma Johnson',
          note: '',
        },
      ],
    })

    expect(writeInEntries(own)[0]?.source.isOwn).toBe(true)
  })

  it('reads the cover and never the old proxy, so a role row cannot fake one', () => {
    // THE COMPAT SHIM, retired by kindred#2382 PR 4. This used to synthesise a
    // cover from `family_available_override === false` plus the unit's own
    // `occupant_name`, because the wire had no other way to say "somebody is in
    // it". It has one now — `write_ins` is resolved server-side on every unit —
    // and the old spelling means something else entirely, so reading it would
    // report an occupant a role-closed cabin does not have.
    expect(
      writeInEntries(
        unit({
          family_available_override: false,
          occupant_name: 'Emma Johnson',
          is_family_available: false,
        })
      )
    ).toEqual([])
  })

  it('says nothing when neither a cover nor an own row closes the space', () => {
    expect(writeInEntries(unit())).toEqual([])
    expect(hasWriteIn(unit())).toBe(false)
  })
})

describe('a merged container over several written-into rooms', () => {
  /*
   * THE REPORTED CASE — kindred#2381. A container that draws combined stands in
   * for its rooms, so all four of its written-into leaves resolve onto its one
   * card. Returning one of them hid three occupants and made each clear look
   * like a failed click as the card re-populated with the next name.
   */
  const merged = unit({
    unit_id: 'id-house',
    code: 'house',
    name: 'House',
    is_container: true,
    is_combined: true,
    write_ins: [
      cover({
        unit_id: 'id-back',
        unit_code: 'house-back',
        unit_name: 'House Back',
        occupant_name: 'Emma Johnson',
      }),
      cover({
        unit_id: 'id-loft',
        unit_code: 'house-loft',
        unit_name: 'House Loft',
        occupant_name: 'Liam Garcia',
      }),
      cover({
        unit_id: 'id-side',
        unit_code: 'house-side',
        unit_name: 'House Side',
        occupant_name: 'Olivia Martinez',
      }),
    ],
  })

  it('names every occupant the card covers, in the order the server sent them', () => {
    expect(writeInEntries(merged).map((entry) => entry.occupant.name)).toEqual([
      'Emma Johnson',
      'Liam Garcia',
      'Olivia Martinez',
    ])
  })

  it('pairs each occupant with the row that holds it, so a removal targets that row', () => {
    // The pairing is the point of one entry rather than two parallel arrays:
    // an X drawn on the third card must delete the THIRD row, and index
    // alignment maintained by hand is exactly the invariant that rots.
    expect(writeInEntries(merged).map((entry) => entry.source.unitId)).toEqual([
      'id-back',
      'id-loft',
      'id-side',
    ])
    expect(writeInEntries(merged).every((entry) => !entry.source.isOwn)).toBe(true)
  })

  it('reports the space as covered', () => {
    expect(hasWriteIn(merged)).toBe(true)
  })
})
