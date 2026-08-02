/**
 * The board's layout is a pure function over the roster payload, so the
 * decisions that matter — which units get a card, where each party lands,
 * what raises the consent flag — are testable without rendering anything.
 *
 * Fictional data throughout.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { AREA_HUES, buildBoard, countBoardSlots } from './boardLayout'

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'cedar-1',
    name: 'Cedar 1',
    area_code: 'CG',
    area_name: 'Cedar Grove',
    sleeps: 5,
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
    allocation_default: 'family_pool',
    reservation_state: null,
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 101,
    display_name: 'Johnson',
    adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
    children: [{ person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 }],
    party_size: 3,
    unit_code: '',
    unit_name: '',
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    ...overrides,
  }
}

describe('buildBoard — which units get a card', () => {
  it('gives every leaf unit a card', () => {
    const board = buildBoard(
      [],
      [unit(), unit({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })]
    )
    const slots = board.areas.flatMap((area) => area.slots)
    expect(slots.map((slot) => slot.unit.code)).toEqual(['cedar-1', 'cedar-2'])
  })

  it('never gives a container a card, because its halves already carry the beds', () => {
    const board = buildBoard(
      [],
      [unit(), unit({ unit_id: 'u2', code: 'cedar-3', name: 'Cedar 3', is_container: true })]
    )
    const slots = board.areas.flatMap((area) => area.slots)
    expect(slots.map((slot) => slot.unit.code)).toEqual(['cedar-1'])
  })

  it('drops a deactivated unit that nobody is in', () => {
    const board = buildBoard(
      [],
      [unit(), unit({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2', is_active: false })]
    )
    const slots = board.areas.flatMap((area) => area.slots)
    expect(slots.map((slot) => slot.unit.code)).toEqual(['cedar-1'])
  })

  it('keeps a deactivated unit that still holds a party, so nobody vanishes', () => {
    const board = buildBoard(
      [party({ unit_code: 'cedar-2', unit_name: 'Cedar 2' })],
      [unit(), unit({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2', is_active: false })]
    )
    const slots = board.areas.flatMap((area) => area.slots)
    expect(slots.map((slot) => slot.unit.code)).toEqual(['cedar-1', 'cedar-2'])
    expect(board.offBoard).toHaveLength(0)
  })
})

describe('countBoardSlots — the tab count is the card count', () => {
  it('agrees with the board about a plain weekend', () => {
    const units = [unit(), unit({ unit_id: 'u2', code: 'cedar-2', is_container: true })]
    expect(countBoardSlots([], units)).toBe(
      buildBoard([], units).areas.flatMap((a) => a.slots).length
    )
  })

  it('agrees with the board about a deactivated room that still holds a party', () => {
    // The two predicates have to be the same one, or the tab promises a
    // number of cards the board does not draw.
    const units = [unit(), unit({ unit_id: 'u2', code: 'cedar-2', is_active: false })]
    const parties = [party({ unit_code: 'cedar-2', unit_name: 'Cedar 2' })]
    expect(countBoardSlots(parties, units)).toBe(
      buildBoard(parties, units).areas.flatMap((a) => a.slots).length
    )
    expect(countBoardSlots(parties, units)).toBe(2)
  })
})

describe('buildBoard — where each party lands', () => {
  it('puts a placed party on its own unit', () => {
    const board = buildBoard([party({ unit_code: 'cedar-1', unit_name: 'Cedar 1' })], [unit()])
    const slot = board.areas[0]?.slots[0]
    expect(slot?.parties.map((p) => p.display_name)).toEqual(['Johnson'])
    expect(board.unplaced).toHaveLength(0)
  })

  it('puts an unplaced party on the rail', () => {
    const board = buildBoard([party()], [unit()])
    expect(board.unplaced.map((p) => p.display_name)).toEqual(['Johnson'])
    expect(board.areas[0]?.slots[0]?.parties).toHaveLength(0)
  })

  it('holds two sharing parties in one slot', () => {
    const board = buildBoard(
      [
        party({ unit_code: 'cedar-1', unit_name: 'Cedar 1' }),
        party({
          household_cm_id: 102,
          display_name: 'Garcia',
          unit_code: 'cedar-1',
          unit_name: 'Cedar 1',
        }),
      ],
      [unit()]
    )
    expect(board.areas[0]?.slots[0]?.parties.map((p) => p.display_name)).toEqual([
      'Johnson',
      'Garcia',
    ])
  })

  it('accounts for a party on a merged slot rather than dropping it', () => {
    // A merge carries no unit_code (the API sends the merge display name
    // instead), so there is no card to put it on. It is PLACED, though, so
    // the rail would be a lie.
    const board = buildBoard(
      [party({ unit_code: '', unit_name: 'Cedar 3 + Cedar 4', is_merged_slot: true })],
      [unit()]
    )
    expect(board.unplaced).toHaveLength(0)
    expect(board.offBoard.map((p) => p.display_name)).toEqual(['Johnson'])
  })

  it('accounts for a party assigned straight to a container', () => {
    const board = buildBoard(
      [party({ unit_code: 'cedar-block', unit_name: 'Cedar Block' })],
      [
        unit(),
        unit({ unit_id: 'u2', code: 'cedar-block', name: 'Cedar Block', is_container: true }),
      ]
    )
    expect(board.unplaced).toHaveLength(0)
    expect(board.offBoard.map((p) => p.display_name)).toEqual(['Johnson'])
  })

  it('accounts for a party whose unit code is not in the payload', () => {
    const board = buildBoard([party({ unit_code: 'gone', unit_name: 'Gone' })], [unit()])
    expect(board.offBoard.map((p) => p.display_name)).toEqual(['Johnson'])
  })

  it('loses nobody: every party is on a slot, the rail or the off-board list', () => {
    const parties = [
      party({ unit_code: 'cedar-1', unit_name: 'Cedar 1' }),
      party({ household_cm_id: 102, display_name: 'Garcia' }),
      party({
        household_cm_id: 103,
        display_name: 'Chen',
        unit_name: 'A merge',
        is_merged_slot: true,
      }),
    ]
    const board = buildBoard(parties, [unit()])
    const placed = board.areas.flatMap((area) => area.slots).flatMap((slot) => slot.parties)
    expect(placed.length + board.unplaced.length + board.offBoard.length).toBe(parties.length)
  })
})

describe('buildBoard — the unplaced rail ranks on the one signal it has', () => {
  it('lifts a mandatory accommodation to the top', () => {
    const board = buildBoard(
      [
        party({ display_name: 'Adams' }),
        party({
          household_cm_id: 102,
          display_name: 'Zhang',
          flags: { accommodation_is_mandatory: true, needs_accommodation: true },
        }),
      ],
      [unit()]
    )
    expect(board.unplaced.map((p) => p.display_name)).toEqual(['Zhang', 'Adams'])
  })

  it('falls back to name order, since the partner leg is uncomputable', () => {
    const board = buildBoard(
      [party({ display_name: 'Zhang' }), party({ household_cm_id: 102, display_name: 'Adams' })],
      [unit()]
    )
    expect(board.unplaced.map((p) => p.display_name)).toEqual(['Adams', 'Zhang'])
  })
})

describe('buildBoard — consent flagging (spec §11)', () => {
  function shared(gates: Array<'no_share' | 'maybe_mutual' | 'yes_share' | 'unknown'>) {
    return buildBoard(
      gates.map((preference, index) =>
        party({
          household_cm_id: 200 + index,
          display_name: `H${String(index)}`,
          unit_code: 'cedar-1',
          unit_name: 'Cedar 1',
          share: { preference, proximity: [], request_text: '', needs_resolution: false },
        })
      ),
      [unit()]
    )
  }

  it('flags a shared unit where one party said no', () => {
    const slot = shared(['no_share', 'yes_share']).areas[0]?.slots[0]
    expect(slot?.consent).not.toBeNull()
    expect(slot?.consent?.declinedCount).toBe(1)
  })

  it('does not flag two parties who both agreed', () => {
    expect(shared(['maybe_mutual', 'yes_share']).areas[0]?.slots[0]?.consent).toBeNull()
  })

  it('does not flag a blank gate — that is deferred to C2, and C1 flags only on an explicit no', () => {
    expect(shared(['unknown', 'yes_share']).areas[0]?.slots[0]?.consent).toBeNull()
  })

  it('does not flag maybe + maybe — also deferred to C2', () => {
    expect(shared(['maybe_mutual', 'maybe_mutual']).areas[0]?.slots[0]?.consent).toBeNull()
  })

  it('does not flag a party who declined sharing and got a room to itself', () => {
    // Declining is the normal answer. It only contradicts anything when
    // somebody else is in the room.
    expect(shared(['no_share']).areas[0]?.slots[0]?.consent).toBeNull()
  })

  it('counts both when two parties in one room each said no', () => {
    expect(shared(['no_share', 'no_share']).areas[0]?.slots[0]?.consent?.declinedCount).toBe(2)
  })

  it('reports how many slots are flagged across the whole board', () => {
    expect(shared(['no_share', 'yes_share']).flaggedCount).toBe(1)
    expect(shared(['yes_share', 'yes_share']).flaggedCount).toBe(0)
  })
})

describe('buildBoard — area grouping and colour', () => {
  it('groups units into one section per area', () => {
    const board = buildBoard(
      [],
      [
        unit(),
        unit({
          unit_id: 'u2',
          code: 'ridge-1',
          name: 'Ridge 1',
          area_code: 'NR',
          area_name: 'North Ridge',
        }),
        unit({ unit_id: 'u3', code: 'cedar-2', name: 'Cedar 2' }),
      ]
    )
    expect(board.areas.map((area) => area.name)).toEqual(['Cedar Grove', 'North Ridge'])
    expect(board.areas[0]?.slots).toHaveLength(2)
  })

  it('keeps two areas apart when they share a blank code but not a name', () => {
    // The API sends `area_code: ""` for anything it cannot resolve, so
    // bucketing on the code alone silently merges them.
    const board = buildBoard(
      [],
      [
        unit({ area_code: '', area_name: 'Cedar Grove' }),
        unit({ unit_id: 'u2', code: 'ridge-1', area_code: '', area_name: 'North Ridge' }),
      ]
    )
    expect(board.areas.map((area) => area.name)).toEqual(['Cedar Grove', 'North Ridge'])
  })

  it('gives each area a distinct hue, and the same one every time', () => {
    const units = [
      unit(),
      unit({ unit_id: 'u2', code: 'ridge-1', area_code: 'NR', area_name: 'North Ridge' }),
      unit({ unit_id: 'u3', code: 'bend-1', area_code: 'RB', area_name: 'River Bend' }),
    ]
    const first = buildBoard([], units)
    const again = buildBoard([], [...units].reverse())
    const hues = first.areas.map((area) => area.hue)
    expect(new Set(hues).size).toBe(3)
    expect(again.areas.map((area) => area.hue)).toEqual(hues)
  })

  it('never runs out of hues', () => {
    const units = Array.from({ length: AREA_HUES.length + 3 }, (_, index) =>
      unit({
        unit_id: `u${String(index)}`,
        code: `c${String(index)}`,
        area_code: `A${String(index)}`,
        area_name: `Area ${String(index).padStart(2, '0')}`,
      })
    )
    const board = buildBoard([], units)
    expect(board.areas).toHaveLength(AREA_HUES.length + 3)
    expect(board.areas.every((area) => area.hue.length > 0)).toBe(true)
  })

  it('counts the parties in each area', () => {
    const board = buildBoard(
      [
        party({ unit_code: 'cedar-1', unit_name: 'Cedar 1' }),
        party({
          household_cm_id: 102,
          display_name: 'Garcia',
          unit_code: 'cedar-1',
          unit_name: 'Cedar 1',
        }),
      ],
      [unit(), unit({ unit_id: 'u2', code: 'ridge-1', area_code: 'NR', area_name: 'North Ridge' })]
    )
    expect(board.areas.map((area) => area.partyCount)).toEqual([2, 0])
  })
})
