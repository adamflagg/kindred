/**
 * The board's layout is a pure function over the roster payload, so the
 * decisions that matter — which units get a card, where each party lands,
 * what raises the consent flag — are testable without rendering anything.
 *
 * Fictional data throughout.
 */
import { describe, expect, it } from 'vitest'

import type {
  LodgingUnitRow,
  RosterPartyRow,
  ShareEligibilityValue,
  SharePreferenceValue,
  ShareRequest,
} from '../../types/lodging'
import {
  answersConflictDetail,
  AREA_HUES,
  areaTokens,
  buildBoard,
  countBoardSlots,
  overlappingPartyKeys,
  partySize,
  SHARE_WORDING,
  slotOccupancy,
  wholeBuildingHolders,
} from './boardLayout'
import { partyHeadcount } from './householdIdentity'
import { partyKey } from './partyKey'

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'cedar-1',
    name: 'Cedar 1',
    area_code: 'CG',
    area_name: 'Cedar Grove',
    area_sort_order: 0,
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
    parent_code: '',
    is_combined: false,
    inventory_class: 'family_pool',
    family_available_override: null,
    reason: '',
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

/**
 * Permanent full-time staff housing — held for staff and therefore not
 * family-available. 21 of the property's 102 leaf units are these.
 */
function staffUnit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return unit({ inventory_class: 'staff_default', is_family_available: false, ...overrides })
}

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 1000001,
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

describe('partySize — BEDS, never the headcount', () => {
  /*
   * THE TWO NUMBERS MUST NOT CONVERGE.
   *
   * `partySize` is the BED number the fit check runs on; `partyHeadcount` is
   * the PEOPLE number a badge prints next to the names. Since #2046 the
   * server discounts a child under 18 months at session start, so for the 24
   * households with an infant the bed figure is deliberately one BELOW the
   * names. kindred#2152 exists because a badge reached for the wrong one, and
   * collapsing this function into `partyHeadcount` would re-create it while
   * looking like a tidy-up.
   */
  it('is the bed number for an infant household, one below the headcount', () => {
    const infantHousehold = party({
      // Server-reported: 1 adult + 1 school-age child. The infant is discounted.
      party_size: 2,
      adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
      children: [
        { person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 },
        { person_cm_id: 9002, display_name: 'Ava Johnson', age: 0.11, grade: 0 },
      ],
    })
    expect(partySize(infantHousehold)).toBe(2)
    expect(partyHeadcount(infantHousehold)).toBe(3)
  })

  /*
   * The FALLBACK arm — and only the fallback arm — is `partyHeadcount`. A
   * reported 0 means NOT STATED, so there is no bed figure to honour and the
   * client cannot re-derive the infant discount (`PartyChild.age` is
   * CampMinder's `yy.mm`, the field #2046 forbids thresholding). Counting the
   * bodies over-states, the safe direction on this surface.
   */
  it('falls back to the headcount when no bed count was reported', () => {
    const unreported = party({
      party_size: 0,
      adults: [
        { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
        // Still live in `adults` until #1946's cleanup resyncs — the fallback
        // applies the server's own predicate rather than re-inflating.
        { adult_number: 2, display_name: 'NA', relationship: '' },
      ],
      children: [{ person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 }],
    })
    expect(partySize(unreported)).toBe(partyHeadcount(unreported))
    expect(partySize(unreported)).toBe(2)
  })
})

describe('slotOccupancy — how many people the card can account for', () => {
  /*
   * The corner figure was CAPACITY, so a card looked identical whether the
   * room was empty or full. This is the numerator that fixes that.
   *
   * THE NUMERATOR IS BEDS, not bodies, since #1925 and #2046. It used to
   * count the household's LISTED adults — blank and placeholder
   * `family_camp_adults` slots included — and every child, infants among
   * them. Both terms are now filtered server-side, so a room reading full is
   * worth the trust that summing onto a room asks for.
   *
   * There were never "one place that computes it" — three copies read
   * `party_size`, and this file's own doc comment claiming otherwise is what
   * made #2046 re-sweep the tree. See `boardLayout.partySize`.
   *
   * SPANNING is the other half. Since #2010 a party holding several rooms is
   * drawn on each of them, and #2040 deliberately left that rule alone. When
   * a party occupies leaves this card does not draw, the room-level count is
   * not knowable — there is no per-room breakdown to divide, and inventing
   * one is what `sleeps: null` renders an em dash to avoid. So the count
   * stands as an upper bound and the OVER-CAPACITY VERDICT is withheld:
   * a number with a marker is context, "over capacity" is a claim.
   *
   * Measured on the 2026 registry after #2040: zero parties span cards, down
   * from one. Combining is what removed it, and prod will combine more. This
   * is a guard on a reachable-but-empty state, which is exactly the kind that
   * rots undetected — hence tested.
   */
  it('sums the parties in the room', () => {
    const slot = {
      unit: unit(),
      parties: [party({ party_size: 3 }), party({ party_size: 2 })],
      consent: null,
    }
    expect(slotOccupancy(slot, [unit()])).toEqual({ occupants: 5, spanWidth: 0 })
  })

  it('counts an empty room as nobody, not as unknown', () => {
    expect(slotOccupancy({ unit: unit(), parties: [], consent: null }, [unit()])).toEqual({
      occupants: 0,
      spanWidth: 0,
    })
  })

  it('falls back to the named people when party_size is unset', () => {
    // One adult and one child in the fixture. A `party_size` of 0 is "not
    // stated", not "nobody" — the same reading `FamilyCard` has always used.
    const slot = { unit: unit(), parties: [party({ party_size: 0 })], consent: null }
    expect(slotOccupancy(slot, [unit()]).occupants).toBe(2)
  })

  it('does not recount a placeholder adult in that fallback', () => {
    // The fallback runs the SAME adult predicate the server counts by
    // (`householdIdentity.namedAdults`), or a household whose only adult slot
    // holds "NA" would be discounted server-side and silently re-inflated
    // here — the exact drift #1925 step 5 exists to close.
    const slot = {
      unit: unit(),
      parties: [
        party({
          party_size: 0,
          adults: [
            { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
            { adult_number: 2, display_name: 'NA', relationship: '' },
            { adult_number: 3, display_name: '', relationship: '' },
          ],
        }),
      ],
      consent: null,
    }
    expect(slotOccupancy(slot, [unit()]).occupants).toBe(2)
  })

  it('counts a party that named a room beneath this combined card', () => {
    // The card is the building; the placement named a room in it. Covered, so
    // nothing spans — this is the case #2040 made the common one.
    const house = unit({
      code: 'house',
      name: 'Aspen House',
      is_container: true,
      is_combined: true,
      sleeps: 7,
    })
    const r1 = unit({ code: 'r1', unit_id: 'u2', name: 'Aspen 1', parent_code: 'house', sleeps: 3 })
    const r2 = unit({ code: 'r2', unit_id: 'u3', name: 'Aspen 2', parent_code: 'house', sleeps: 3 })
    const slot = {
      unit: house,
      parties: [party({ party_size: 6, unit_code: 'r1' })],
      consent: null,
    }
    expect(slotOccupancy(slot, [house, r1, r2])).toEqual({ occupants: 6, spanWidth: 0 })
  })

  it('marks the card when a party also holds a room it does not draw', () => {
    // The building is drawn SPLIT and one household holds both rooms, so it
    // is drawn on each. Six people against this room's three beds is not a
    // verdict anyone can support; `spanWidth` is what withholds it.
    const house = unit({ code: 'house', name: 'Aspen House', is_container: true, sleeps: 7 })
    const r1 = unit({ code: 'r1', unit_id: 'u2', name: 'Aspen 1', parent_code: 'house', sleeps: 3 })
    const r2 = unit({ code: 'r2', unit_id: 'u3', name: 'Aspen 2', parent_code: 'house', sleeps: 3 })
    const spanning = party({ party_size: 6, unit_code: '', unit_codes: ['r1', 'r2'] })
    expect(
      slotOccupancy({ unit: r1, parties: [spanning], consent: null }, [house, r1, r2])
    ).toEqual({
      occupants: 6,
      spanWidth: 2,
    })
  })

  it('marks the card when a container placement fans down onto it', () => {
    // A placement naming the building, with the building drawn split. #2040
    // fans it onto every drawn descendant, so the same six people appear on
    // both rooms.
    const house = unit({ code: 'house', name: 'Aspen House', is_container: true, sleeps: 7 })
    const r1 = unit({ code: 'r1', unit_id: 'u2', name: 'Aspen 1', parent_code: 'house', sleeps: 3 })
    const r2 = unit({ code: 'r2', unit_id: 'u3', name: 'Aspen 2', parent_code: 'house', sleeps: 3 })
    const onBuilding = party({ party_size: 6, unit_code: 'house' })
    expect(
      slotOccupancy({ unit: r1, parties: [onBuilding], consent: null }, [house, r1, r2]).spanWidth
    ).toBe(2)
  })

  it('degrades to raw codes when the registry is not supplied', () => {
    // `LodgingUnitCard` defaults `units` to `[]`. A leaf card whose party
    // names that leaf must still be covered, or every card would look as
    // though it spanned.
    const slot = { unit: unit(), parties: [party({ unit_code: 'cedar-1' })], consent: null }
    expect(slotOccupancy(slot, []).spanWidth).toBe(0)
  })
})

describe('areaTokens — the URL shorthand for each area', () => {
  /*
   * Collapse state lives in the query string, so each area needs a short token
   * for it. `BoardArea.key` cannot serve: it is `code::name`, which needs
   * escaping and puts the camp's area names in a URL that gets pasted around.
   *
   * The registry's own `area_code` cannot serve either, and that was the first
   * attempt. It is hand-entered and ragged -- two letters for some areas, four
   * for others -- so the URL read as though the codes meant different things.
   * Generating the shorthand makes every area two characters and removes a
   * dependency on a field nothing else in the board reads.
   *
   * TWO CHARACTERS IS NOT ALWAYS ENOUGH, which is the whole reason this takes
   * the full set rather than one area at a time. On the 2026 registry
   * "Ridge Side" and "River Side" both reduce to RS. No pure function of a
   * single name can separate them, so the colliding pair -- and only that pair
   * -- deepens until it is distinct.
   */
  function areasNamed(...names: string[]) {
    return names.map((name, index) => ({ key: `A${String(index)}::${name}`, name }))
  }

  it('takes the initials of a two-word area', () => {
    const tokens = areaTokens(areasNamed('Cedar Grove'))
    expect(tokens.get('A0::Cedar Grove')).toBe('CG')
  })

  it('takes the first two letters of a one-word area', () => {
    const tokens = areaTokens(areasNamed('Manzanitas'))
    expect(tokens.get('A0::Manzanitas')).toBe('MA')
  })

  it('deepens a colliding pair until the two are distinct', () => {
    // Both are R + S, and both first words start "Ri", so it takes three
    // letters of the first word to tell them apart.
    const tokens = areaTokens(areasNamed('Ridge Side', 'River Side'))
    expect(tokens.get('A0::Ridge Side')).toBe('RIDS')
    expect(tokens.get('A1::River Side')).toBe('RIVS')
  })

  it('leaves every other area on two characters when one pair collides', () => {
    // The deepening is scoped to the group that clashed. An area that was
    // never ambiguous must not have its links broken by an unrelated one.
    const tokens = areaTokens(
      areasNamed('Ridge Side', 'River Side', 'Ridge Yurts', 'Health Center')
    )
    expect(tokens.get('A2::Ridge Yurts')).toBe('RY')
    expect(tokens.get('A3::Health Center')).toBe('HC')
  })

  it('gives every area on the real registry shape a distinct token', () => {
    const names = [
      'Golden Triangle',
      'Health Center',
      'Manzanitas',
      'Ridge Side',
      'Ridge Yurts',
      'River Side',
      'Forest Village',
      'Tuolumne Heights',
    ]
    const tokens = areaTokens(areasNamed(...names))
    expect(tokens.size).toBe(names.length)
    expect(new Set(tokens.values()).size).toBe(names.length)
  })

  it('still yields a token for an area with no usable name', () => {
    // `areaName` labels this one "Unassigned area" before it gets here, but a
    // token generator that can return an empty string would drop the area out
    // of the URL entirely.
    const tokens = areaTokens(areasNamed(''))
    expect(tokens.get('A0::')).toBeTruthy()
  })
})

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

  it('drops staff housing nobody is in, because it was never planning inventory', () => {
    // Staff housing is occupied by full-time staff who are not enrolled per
    // session and never appear on a roster, so the card would always be
    // empty. Since drag placement shipped every drawn card is an enabled
    // drop target, so an empty card reads as a room to drop a family into.
    const board = buildBoard([], [unit(), staffUnit({ unit_id: 'u2', code: 'aspen-lodge' })])
    const slots = board.areas.flatMap((area) => area.slots)
    expect(slots.map((slot) => slot.unit.code)).toEqual(['cedar-1'])
  })

  it('keeps staff housing that still holds a party, so nobody vanishes', () => {
    // This file's second invariant. A mis-ingested alias or a hand-edited row
    // can put a party somewhere a display rule would otherwise hide, and no
    // party may disappear because of a display rule.
    const board = buildBoard(
      [party({ unit_code: 'aspen-lodge', unit_name: 'Aspen Lodge' })],
      [unit(), staffUnit({ unit_id: 'u2', code: 'aspen-lodge', name: 'Aspen Lodge' })]
    )
    const slots = board.areas.flatMap((area) => area.slots)
    // Both fall in the same default area, so they now sort alphabetically by
    // name (kindred#2514) — "Aspen Lodge" before "Cedar 1". The membership
    // this test is actually about is unaffected: staff housing that still
    // holds a party never disappears.
    expect(slots.map((slot) => slot.unit.code)).toEqual(['aspen-lodge', 'cedar-1'])
    expect(board.offBoard).toHaveLength(0)
    expect(board.unplaced).toHaveLength(0)
  })

  it('keeps a staff cabin released to families for this weekend', () => {
    // Releasing a staff cabin exists so a family can be housed in it, and
    // `unitBadges` gives it a "Released" badge to say so. Hiding the cabin
    // staff just released would make the capability useless, so the
    // exclusion reads resolved availability, not the standing role alone.
    const board = buildBoard(
      [],
      [
        unit(),
        staffUnit({
          unit_id: 'u2',
          code: 'aspen-lodge',
          is_family_available: true,
          family_available_override: true,
        }),
      ]
    )
    const slots = board.areas.flatMap((area) => area.slots)
    expect(slots.map((slot) => slot.unit.code)).toEqual(['cedar-1', 'aspen-lodge'])
  })

  it('keeps a family cabin held back this weekend, because held rooms are badged not hidden', () => {
    // A burst pipe takes a room out of service for the weekend; it is still
    // planning inventory, and `unitBadges` renders "Held" for exactly this
    // row. Staff reason about adjacency, so hiding it makes the site look
    // smaller than it is.
    const board = buildBoard(
      [],
      [
        unit(),
        unit({
          unit_id: 'u2',
          code: 'cedar-2',
          is_family_available: false,
          family_available_override: false,
          reason: 'Burst pipe',
        }),
      ]
    )
    const slots = board.areas.flatMap((area) => area.slots)
    expect(slots.map((slot) => slot.unit.code)).toEqual(['cedar-1', 'cedar-2'])
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

  it('agrees with the board about staff housing nobody is in', () => {
    const units = [unit(), staffUnit({ unit_id: 'u2', code: 'aspen-lodge' })]
    expect(countBoardSlots([], units)).toBe(
      buildBoard([], units).areas.flatMap((a) => a.slots).length
    )
    expect(countBoardSlots([], units)).toBe(1)
  })

  it('agrees with the board about staff housing that still holds a party', () => {
    const units = [unit(), staffUnit({ unit_id: 'u2', code: 'aspen-lodge' })]
    const parties = [party({ unit_code: 'aspen-lodge', unit_name: 'Aspen Lodge' })]
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

  it('puts an unplaced party in the corner queue', () => {
    const board = buildBoard([party()], [unit()])
    expect(board.unplaced.map((p) => p.display_name)).toEqual(['Johnson'])
    expect(board.areas[0]?.slots[0]?.parties).toHaveLength(0)
  })

  it('holds two sharing parties in one slot', () => {
    const board = buildBoard(
      [
        party({ unit_code: 'cedar-1', unit_name: 'Cedar 1' }),
        party({
          household_cm_id: 1000002,
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
      party({ household_cm_id: 1000002, display_name: 'Garcia' }),
      party({
        household_cm_id: 1000003,
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

describe('buildBoard — a party across several rooms', () => {
  /** Two rooms of one building, same area, both drawable. */
  const twoRooms = [unit(), unit({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })]

  /**
   * `unit_codes` is the authority on a multi-room placement — `unit_code` is
   * deliberately `''` there, so it is the only field that survives the merge.
   * Same definition `occupiedCodes` uses in `dragPlacement.ts`.
   */
  function merged(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
    return party({
      unit_code: '',
      unit_name: 'Cedar 1 + Cedar 2',
      unit_codes: ['cedar-1', 'cedar-2'],
      is_merged_slot: true,
      ...overrides,
    })
  }

  it('draws the party on every room it holds, not on the off-board rail', () => {
    const board = buildBoard([merged()], twoRooms)

    expect(board.offBoard).toHaveLength(0)
    expect(board.areas[0]?.slots.map((slot) => slot.parties.map((p) => p.display_name))).toEqual([
      ['Johnson'],
      ['Johnson'],
    ])
  })

  it('counts a family holding four rooms as one family, not four', () => {
    const fourRooms = [
      unit(),
      unit({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' }),
      unit({ unit_id: 'u3', code: 'cedar-3', name: 'Cedar 3' }),
      unit({ unit_id: 'u4', code: 'cedar-4', name: 'Cedar 4' }),
    ]
    const board = buildBoard(
      [merged({ unit_codes: ['cedar-1', 'cedar-2', 'cedar-3', 'cedar-4'] })],
      fourRooms
    )

    // The header reads "N rooms · M families". Four rooms, one family.
    expect(board.areas[0]?.slots).toHaveLength(4)
    expect(board.areas[0]?.partyCount).toBe(1)
  })

  it('prefers unit_codes over a stale unit_code', () => {
    const board = buildBoard([merged({ unit_code: 'cedar-1' })], twoRooms)

    const drawnOn = board.areas[0]?.slots
      .filter((slot) => slot.parties.length > 0)
      .map((slot) => slot.unit.code)
    expect(drawnOn).toEqual(['cedar-1', 'cedar-2'])
  })

  it('keeps a party on the rooms that resolve when one code is missing', () => {
    // Hiding a placed family because one room fell out of the payload is
    // strictly worse than drawing it in the rooms we do know about.
    const board = buildBoard([merged({ unit_codes: ['cedar-1', 'gone'] })], twoRooms)

    expect(board.offBoard).toHaveLength(0)
    expect(board.areas[0]?.slots.filter((slot) => slot.parties.length > 0)).toHaveLength(1)
  })

  it('still rails a merge that resolves to no room at all', () => {
    const board = buildBoard([merged({ unit_codes: [] })], twoRooms)

    expect(board.unplaced).toHaveLength(0)
    expect(board.offBoard.map((p) => p.display_name)).toEqual(['Johnson'])
  })

  it('does not flag a family alone in its own rooms as a shared cabin', () => {
    // `consentFlag` needs two parties in one slot. One family across two rooms
    // is one party in each, and nothing to ask staff about.
    expect(buildBoard([merged()], twoRooms).flaggedCount).toBe(0)
  })

  it('loses nobody, and counts each party once however many rooms it holds', () => {
    const parties = [
      merged(),
      party({ household_cm_id: 1000002, display_name: 'Garcia' }),
      party({
        household_cm_id: 1000003,
        display_name: 'Chen',
        unit_code: 'cedar-2',
        unit_name: 'Cedar 2',
      }),
    ]
    const board = buildBoard(parties, twoRooms)

    const placed = new Set(
      board.areas
        .flatMap((area) => area.slots)
        .flatMap((slot) => slot.parties)
        .map((p) => p.display_name)
    )
    const railed = [...board.unplaced, ...board.offBoard].map((p) => p.display_name)
    expect(placed.size + railed.length).toBe(parties.length)
  })
})

describe('buildBoard — consent flagging on ELIGIBILITY, not the gate', () => {
  /** A shared unit whose parties carry the given resolved eligibilities. */
  function shared(
    values: ShareEligibilityValue[],
    gate: SharePreferenceValue = 'unknown',
    conflicts: boolean[] = []
  ) {
    return buildBoard(
      values.map((eligibility, index) =>
        party({
          household_cm_id: 200 + index,
          display_name: `H${String(index)}`,
          unit_code: 'cedar-1',
          unit_name: 'Cedar 1',
          share: {
            preference: gate,
            proximity: [],
            request_text: '',
            needs_resolution: false,
            eligibility,
            eligibility_source: 'form',
            answers_conflict: conflicts[index] ?? false,
          },
        })
      ),
      [unit()]
    )
  }

  it('flags a shared unit where one party declined', () => {
    const slot = shared(['declined', 'open']).areas[0]?.slots[0]
    expect(slot?.consent).not.toBeNull()
    expect(slot?.consent?.declinedCount).toBe(1)
  })

  it('does not flag two parties who are both open to a staff match', () => {
    expect(shared(['open', 'open']).areas[0]?.slots[0]?.consent).toBeNull()
  })

  it('does not flag two NAMED parties — mutuality is unverifiable, so the panel shows the names', () => {
    // Resolving request names to households is spec §7.3 and unbuilt. Flagging
    // every named pair would fire on the legitimate case, which is the majority
    // of eligible households (35 of 41 for 2026).
    expect(shared(['named', 'named']).areas[0]?.slots[0]?.consent).toBeNull()
  })

  it('flags an UNANSWERED party separately from one that declined', () => {
    // Same placement default, different fact and different staff action:
    // chase the form vs respect the answer. Reporting a refusal about a family
    // that answered nothing is a claim staff cannot defend to that family.
    const slot = shared(['unknown', 'open']).areas[0]?.slots[0]
    expect(slot?.consent).not.toBeNull()
    expect(slot?.consent?.unansweredCount).toBe(1)
    expect(slot?.consent?.declinedCount).toBe(0)
    expect(slot?.consent?.reason).toMatch(/(hasn't|haven't) answered/)
    expect(slot?.consent?.reason).not.toContain('request sharing')
  })

  it('never claims a family REFUSED, because the form has no refusal option', () => {
    // The four live options are NEAR / "No requests" / WITH-named /
    // WITH-similar. There is no "we do not want to share", so `declined` is
    // always the ABSENCE of a WITH token -- and 106 of 165 form-declined
    // households for 2026 had actually asked to be housed NEAR someone.
    // Telling staff they "declined" is a claim those families did not make.
    const reason = shared(['declined', 'open']).areas[0]?.slots[0]?.consent?.reason ?? ''
    expect(reason).toContain('did not request sharing')
    expect(reason).not.toMatch(/declined|said no|refused/i)
  })

  it('flags a recorded ANSWER CONFLICT, so the 16 households carrying one are visible', () => {
    // The two forms point opposite ways. Not a placement rule -- a
    // staff-review signal -- so it flags even when everyone is shareable.
    const slot = shared(['named', 'named'], 'no_share', [true, false]).areas[0]?.slots[0]
    expect(slot?.consent).not.toBeNull()
    expect(slot?.consent?.conflictCount).toBe(1)
    expect(slot?.consent?.declinedCount).toBe(0)
    expect(slot?.consent?.reason).toContain('disagree')
  })

  it('does not flag a shared unit whose parties are all consenting and consistent', () => {
    expect(shared(['open', 'named'], 'yes_share').areas[0]?.slots[0]?.consent).toBeNull()
  })

  it('does NOT judge an adult-weekend unit — there is no share question to judge', () => {
    // Adult weekends have no share fields at all (partition ["Camper"], no
    // Adult-Share field), and _build_person_parties attaches no share data. A
    // null here means NOT CHECKED, not "nothing found".
    const board = buildBoard(
      [
        party({
          grain: 'person',
          person_cm_id: 501,
          household_cm_id: 0,
          unit_code: 'cedar-1',
          unit_name: 'Cedar 1',
        }),
        party({
          grain: 'person',
          person_cm_id: 502,
          household_cm_id: 0,
          unit_code: 'cedar-1',
          unit_name: 'Cedar 1',
        }),
      ],
      [unit()]
    )
    expect(board.areas[0]?.slots[0]?.consent).toBeNull()
    expect(board.flaggedCount).toBe(0)
  })

  it('does not flag a party who declined and got a room to itself', () => {
    // Declining is the ordinary answer. It contradicts nothing until somebody
    // else is in the room.
    expect(shared(['declined']).areas[0]?.slots[0]?.consent).toBeNull()
  })

  it('counts both when two parties in one room each declined', () => {
    expect(shared(['declined', 'declined']).areas[0]?.slots[0]?.consent?.declinedCount).toBe(2)
  })

  it('counts only the parties that actually share a room, not everyone on a merged card', () => {
    // The third level of the bug `overlappingPartyKeys` was written to kill.
    // A combined house rolls every room's party onto ONE slot, so a family
    // alone in its own room lands beside a pair genuinely sharing another.
    // Gating the flag on overlap fixed WHETHER it fires; the counts inside it
    // were still per-slot, so the pair's flag named the soloist too.
    //
    // `docs/architecture/lodging-occupancy.md`: "An extended family spanning
    // two or more registrations may occupy one house together, each
    // registration in its own room. This is not sharing a unit." A family the
    // flag must not describe must not be counted by it either.
    const house = unit({
      unit_id: 'uh',
      code: 'house',
      name: 'House',
      is_container: true,
      is_combined: true,
    })
    const r1 = unit({ unit_id: 'ur1', code: 'r1', name: 'Room 1', parent_code: 'house' })
    const r2 = unit({ unit_id: 'ur2', code: 'r2', name: 'Room 2', parent_code: 'house' })

    const inRoom = (id: number, name: string, code: string) =>
      party({
        household_cm_id: id,
        display_name: name,
        unit_code: code,
        unit_name: code,
        share: {
          preference: 'unknown',
          proximity: [],
          request_text: '',
          needs_resolution: false,
          eligibility: 'unknown',
          eligibility_source: 'form',
          answers_conflict: false,
        },
      })

    const board = buildBoard(
      // Garcia and Chen share Room 1. Okonkwo is alone in Room 2.
      [inRoom(301, 'Garcia', 'r1'), inRoom(302, 'Chen', 'r1'), inRoom(303, 'Okonkwo', 'r2')],
      [house, r1, r2]
    )
    const slot = board.areas[0]?.slots[0]

    // All three are drawn on the one combined card...
    expect(slot?.unit.code).toBe('house')
    expect(slot?.parties).toHaveLength(3)
    // ...but only the two sharing Room 1 are the flag's subject.
    expect(slot?.consent).not.toBeNull()
    expect(slot?.consent?.unansweredCount).toBe(2)
    expect(slot?.consent?.reason).toContain('2 families')
  })

  it('IGNORES the registration gate: a no_share gate resolved to named is legitimate', () => {
    // 3 households for 2026 said no at registration and then named a partner
    // on the authoritative form. The old gate-based rule flagged every one of
    // them.
    expect(shared(['named', 'named'], 'no_share').areas[0]?.slots[0]?.consent).toBeNull()
  })

  it('IGNORES the registration gate: a yes_share gate resolved to declined still flags', () => {
    // The direction the old rule was blind to, and the larger one — 12
    // households said yes at registration then declined on the form, plus 39
    // more from maybe_mutual. The board read them as permissive.
    const slot = shared(['declined', 'open'], 'yes_share').areas[0]?.slots[0]
    expect(slot?.consent?.declinedCount).toBe(1)
  })

  it('reports how many slots are flagged across the whole board', () => {
    expect(shared(['declined', 'open']).flaggedCount).toBe(1)
    expect(shared(['open', 'open']).flaggedCount).toBe(0)
  })
})

describe('answersConflictDetail — which two answers disagreed, and which one won (kindred#2083)', () => {
  /** A minimal share block, defaulting to no conflict. */
  function shareBlock(overrides: Partial<ShareRequest> = {}): ShareRequest {
    return {
      preference: 'unknown',
      proximity: [],
      request_text: '',
      needs_resolution: false,
      eligibility: 'unknown',
      eligibility_source: 'none',
      answers_conflict: false,
      ...overrides,
    }
  }

  it('says nothing when there is no conflict', () => {
    expect(answersConflictDetail(shareBlock({ answers_conflict: false }))).toBeNull()
  })

  it('says nothing for a party with no share block at all — an adult weekend guest', () => {
    // Adult weekends carry no share question (_build_person_parties attaches
    // no share data), so there is nothing here to disagree about.
    expect(answersConflictDetail(undefined)).toBeNull()
  })

  it('names the registration answer, the form answer, and that the form wins', () => {
    // Measured against production 2026 data pre-kindred#2269: all 16
    // conflicting households then resolved with `eligibility_source: 'form'`
    // — DeriveShareEligibility only ever sets `answers_conflict` true on that
    // branch, so `eligibility` here already IS the form's own verdict, not a
    // re-derivation of it. kindred#2269's union widening is a strict superset
    // of the test that count was measured against, so the true count can only
    // be equal or higher now; the form-answered-only invariant still holds.
    const detail = answersConflictDetail(
      shareBlock({
        preference: 'no_share',
        eligibility: 'open',
        eligibility_source: 'form',
        answers_conflict: true,
      })
    )
    expect(detail).not.toBeNull()
    expect(detail).toMatch(/regist.*will not share/i)
    expect(detail).toMatch(/form.*open to sharing/i)
    expect(detail).toMatch(/form/i)
  })

  it('reuses the ONE "did not request sharing" wording for a form decline, never "declined"', () => {
    // SHARE_WORDING is defined once specifically so the slot flag, the card
    // chip, and this tooltip cannot drift into three different claims about a
    // form with no refusal option.
    const detail = answersConflictDetail(
      shareBlock({
        preference: 'yes_share',
        eligibility: 'declined',
        eligibility_source: 'form',
        answers_conflict: true,
      })
    )
    expect(detail).toContain(SHARE_WORDING.declined)
    expect(detail).not.toMatch(/\bdeclined\b/i)
  })

  it('names a named-partner form answer distinctly from an open one', () => {
    const detail = answersConflictDetail(
      shareBlock({
        preference: 'no_share',
        eligibility: 'named',
        eligibility_source: 'form',
        answers_conflict: true,
      })
    )
    expect(detail).toMatch(/named/i)
  })

  it('never attributes the resolved answer to the form when eligibility_source says otherwise', () => {
    // DeriveShareEligibility (Go, lodging_requests.go) only ever sets
    // `answers_conflict` true on its form-answered branch -- measured on 2026
    // production pre-kindred#2269, all 16 conflicting rows then carried
    // `eligibility_source: 'form'` (stale count; kindred#2269's union
    // widening can only raise it, though the form-answered-only invariant
    // still holds). This reads the field rather than assuming it, so a
    // future Go change or a stale mid-recompute row can never misattribute a
    // registration-only verdict to a form the household may not have even
    // returned.
    const detail = answersConflictDetail(
      shareBlock({
        preference: 'no_share',
        eligibility: 'open',
        eligibility_source: 'registration',
        answers_conflict: true,
      })
    )
    expect(detail).not.toBeNull()
    expect(detail).not.toMatch(/Family Camp form/i)
    expect(detail).toMatch(/open to sharing/)
  })

  it('never crashes on an unrecognised preference or eligibility value', () => {
    // Same guard philosophy as `SharePreferenceChip`: a payload ahead of a
    // type regen must degrade, not throw and take the whole card with it.
    expect(() =>
      answersConflictDetail({
        ...shareBlock({ answers_conflict: true }),
        preference: 'bogus' as unknown as SharePreferenceValue,
        eligibility: 'bogus' as unknown as ShareEligibilityValue,
      })
    ).not.toThrow()
  })

  it('does not name a maybe_mutual registration answer as the side that disagrees (kindred#2269)', () => {
    // As of kindred#2269, DeriveShareEligibility raises answers_conflict off
    // the UNION of every sibling's no_share/yes_share answer, not just the
    // winning gate -- so a household can now conflict with maybe_mutual as
    // the winning share_cabin_gate, because the actual contradiction is a
    // sibling answer that lost the recency race and isn't in this payload at
    // all. REGISTRATION_ANSWER['maybe_mutual'] is "only if a mutual match",
    // which does not read as a disagreement against any resolved verdict --
    // naming it here would have the chip pair two answers that look like
    // they agree, on a tooltip whose whole job is to say they don't.
    const detail = answersConflictDetail(
      shareBlock({
        preference: 'maybe_mutual',
        eligibility: 'declined',
        eligibility_source: 'form',
        answers_conflict: true,
      })
    )
    expect(detail).not.toBeNull()
    expect(detail).not.toMatch(/only if a mutual match/i)
    expect(detail).not.toMatch(/^Registration said/)
    // Still says what actually won, so the chip stays informative.
    expect(detail).toMatch(SHARE_WORDING.declined)
  })

  it('does not name a no_share registration answer that itself AGREES with the verdict (kindred#2269)', () => {
    // The winning gate can be no_share while eligibility is ALSO declined --
    // they agree -- and the union fix can still raise answers_conflict, because
    // a DIFFERENT sibling recorded yes_share and lost the recency race (Go
    // CollapseToHouseholdGrain's sawYesGate, consulted by DeriveShareEligibility
    // regardless of which gate won). Pairing "will not share" against a
    // declined verdict reads as agreement, not disagreement, so naming
    // `preference` here would be exactly the misleading pairing kindred#2269
    // exists to prevent -- the maybe_mutual case is not the only shape of it.
    const detail = answersConflictDetail(
      shareBlock({
        preference: 'no_share',
        eligibility: 'declined',
        eligibility_source: 'form',
        answers_conflict: true,
      })
    )
    expect(detail).not.toBeNull()
    expect(detail).not.toMatch(/will not share/i)
    expect(detail).not.toMatch(/^Registration said/)
    expect(detail).toMatch(SHARE_WORDING.declined)
  })

  it('does not name a yes_share registration answer that itself AGREES with the verdict (kindred#2269)', () => {
    // Mirror of the no_share case above: the winning gate is yes_share and
    // eligibility resolves to something other than declined -- they agree --
    // while a hidden no_share sibling that lost recency is the real conflict.
    const detail = answersConflictDetail(
      shareBlock({
        preference: 'yes_share',
        eligibility: 'open',
        eligibility_source: 'form',
        answers_conflict: true,
      })
    )
    expect(detail).not.toBeNull()
    expect(detail).not.toMatch(/open to sharing.*open to sharing/i)
    expect(detail).not.toMatch(/^Registration said/)
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

  it('orders areas by the Manage screen rank, NOT alphabetically (kindred#2076)', () => {
    // Alphabetically "Cedar Grove" < "North Ridge", but the Manage screen's
    // rank puts North Ridge first -- the board must follow the rank, not
    // the name.
    const board = buildBoard(
      [],
      [
        unit({ area_code: 'CG', area_name: 'Cedar Grove', area_sort_order: 9 }),
        unit({
          unit_id: 'u2',
          code: 'ridge-1',
          name: 'Ridge 1',
          area_code: 'NR',
          area_name: 'North Ridge',
          area_sort_order: 1,
        }),
      ]
    )
    expect(board.areas.map((area) => area.name)).toEqual(['North Ridge', 'Cedar Grove'])
  })

  it('breaks a tied (or missing) area rank by name, deterministically', () => {
    // Two areas with the SAME rank -- kindred#2076's reorder script is
    // documented non-atomic, so a mid-loop failure can leave two areas
    // sharing a rank. 0 counts as "no rank" and is a tie too.
    const board = buildBoard(
      [],
      [
        unit({
          unit_id: 'u1',
          code: 'bend-1',
          name: 'Bend 1',
          area_code: 'RB',
          area_name: 'River Bend',
          area_sort_order: 5,
        }),
        unit({
          unit_id: 'u2',
          code: 'ridge-1',
          name: 'Ridge 1',
          area_code: 'NR',
          area_name: 'North Ridge',
          area_sort_order: 5,
        }),
        unit({
          unit_id: 'u3',
          code: 'cedar-1',
          name: 'Cedar 1',
          area_code: 'CG',
          area_name: 'Cedar Grove',
          area_sort_order: 0,
        }),
        unit({
          unit_id: 'u4',
          code: 'aspen-1',
          name: 'Aspen 1',
          area_code: 'AS',
          area_name: 'Aspen',
          area_sort_order: 0,
        }),
      ]
    )
    // Rank 5 pair breaks to name (North Ridge < River Bend); the two
    // rank-0 areas break to name too (Aspen < Cedar Grove) and, because 0 is
    // the lowest rank present, sort ahead of the ranked pair.
    expect(board.areas.map((area) => area.name)).toEqual([
      'Aspen',
      'Cedar Grove',
      'North Ridge',
      'River Bend',
    ])
  })

  it('sorts units WITHIN an area alphabetically, regardless of payload order (kindred#2514)', () => {
    // REWRITE, not an adaptation — this test used to pin the opposite
    // invariant ("never reorders ... the repository's own query already
    // sorts"). That assumption was wrong: `drawnUnits` (unitLevel.ts) walks
    // the registry tree BREADTH-FIRST, so a unit's depth in the tree — not
    // its name — decides its position in the payload `buildBoard` receives.
    // A root-level unit is emitted before any room nested under a container,
    // whatever either is named, which is exactly what kindred#2514 reported
    // ("containers should be alpha within categories, not containers
    // first"). `buildBoard` must now sort explicitly rather than trust the
    // payload's order. Here the units are handed in reverse-alphabetical —
    // the shape a BFS walk produces when depth runs opposite to name — and
    // must still come out alphabetical.
    const board = buildBoard(
      [],
      [
        unit({
          area_code: 'NR',
          area_name: 'North Ridge',
          area_sort_order: 1,
          code: 'ridge-2',
          name: 'Ridge 2',
        }),
        unit({
          unit_id: 'u2',
          area_code: 'NR',
          area_name: 'North Ridge',
          area_sort_order: 1,
          code: 'ridge-1',
          name: 'Ridge 1',
        }),
        unit({ unit_id: 'u3', area_code: 'CG', area_name: 'Cedar Grove', area_sort_order: 9 }),
      ]
    )
    expect(board.areas.map((area) => area.name)).toEqual(['North Ridge', 'Cedar Grove'])
    expect(board.areas[0]?.slots.map((slot) => slot.unit.code)).toEqual(['ridge-1', 'ridge-2'])
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
          household_cm_id: 1000002,
          display_name: 'Garcia',
          unit_code: 'cedar-1',
          unit_name: 'Cedar 1',
        }),
      ],
      [unit(), unit({ unit_id: 'u2', code: 'ridge-1', area_code: 'NR', area_name: 'North Ridge' })]
    )
    expect(board.areas.map((area) => area.partyCount)).toEqual([2, 0])
  })

  it('counts distinct buildings the area draws — #2009', () => {
    // Two halves of one house share a root but are DIFFERENT buildings under
    // the immediate-parent grain ruled on #2008; a third, freestanding cabin
    // in the same area is its own building. The halves themselves are
    // containers and never drawn, so they add no slots of their own.
    const units = [
      unit({ unit_id: 'up', code: 'upstairs', is_container: true }),
      unit({ unit_id: 'down', code: 'downstairs', is_container: true }),
      unit({ code: 'up-r1', parent_code: 'upstairs' }),
      unit({ unit_id: 'u2', code: 'up-r2', parent_code: 'upstairs' }),
      unit({ unit_id: 'u3', code: 'down-r1', parent_code: 'downstairs' }),
      unit({ unit_id: 'u4', code: 'cabin-9' }),
    ]
    const board = buildBoard([], units)
    expect(board.areas[0]?.slots).toHaveLength(4)
    expect(board.areas[0]?.buildingCount).toBe(3)
  })
})

describe('buildBoard — drawing at the resolved container level', () => {
  it('draws a combined container as ONE slot instead of its rooms', () => {
    const units = [
      unit({ code: 'house', is_container: true, is_combined: true, sleeps: 7 }),
      unit({ code: 'r1', parent_code: 'house', sleeps: 2 }),
      unit({ code: 'r2', parent_code: 'house', sleeps: 2 }),
    ]
    const board = buildBoard([], units)
    const codes = board.areas.flatMap((a) => a.slots.map((s) => s.unit.code))
    expect(codes).toEqual(['house'])
    // The container's OWN measured capacity, never the sum of its rooms.
    expect(board.areas[0]?.slots[0]?.unit.sleeps).toBe(7)
  })

  it('places a container-coded party on the combined card', () => {
    const units = [
      unit({ code: 'house', is_container: true, is_combined: true }),
      unit({ code: 'r1', parent_code: 'house' }),
    ]
    const board = buildBoard(
      [party({ unit_code: 'house', unit_name: 'House', unit_codes: ['house'] })],
      units
    )
    expect(board.offBoard).toEqual([])
    expect(board.areas[0]?.slots[0]?.parties).toHaveLength(1)
  })

  it('fans a container-coded party down when the board is split below it', () => {
    // The container is NOT combined, so the rooms are drawn. The party is
    // placed, so the unplaced rail would be a lie and offBoard would hide it.
    const units = [
      unit({ code: 'house', is_container: true }),
      unit({ code: 'r1', parent_code: 'house' }),
      unit({ code: 'r2', parent_code: 'house' }),
    ]
    const board = buildBoard(
      [party({ unit_code: 'house', unit_name: 'House', unit_codes: ['house'] })],
      units
    )
    expect(board.offBoard).toEqual([])
    const drawn = board.areas.flatMap((a) => a.slots)
    expect(drawn.map((s) => s.unit.code).toSorted()).toEqual(['r1', 'r2'])
    expect(drawn.every((s) => s.parties.length === 1)).toBe(true)
  })

  it('rolls a room-coded party up onto the combined card', () => {
    const units = [
      unit({ code: 'house', is_container: true, is_combined: true }),
      unit({ code: 'r1', parent_code: 'house' }),
      unit({ code: 'r2', parent_code: 'house' }),
    ]
    const board = buildBoard(
      [
        party({
          unit_code: '',
          unit_name: 'House',
          unit_codes: ['r1', 'r2'],
          is_merged_slot: true,
        }),
      ],
      units
    )
    // ONE slot entry, not two: the rooms are not drawn, and a party must not
    // be counted twice on the card that replaced them.
    expect(board.areas[0]?.slots[0]?.parties).toHaveLength(1)
  })

  it('draws a party named at an INTERMEDIATE container on the combined card below it', () => {
    // Three levels: `block` groups `house`, and `house` is the whole-house
    // let. The fan-down descends to the DRAWN descendants, not to the raw
    // leaves — `coveredCodes` walks straight past `house` to `r1`/`r2`, and
    // neither of those is drawn, so a leaf-based fan-down yields [] and sends
    // a placed party to the off-board rail.
    //
    // Today's registry is two-level, but `parentCandidates` permits any depth
    // and task 8 already tests a three-level ancestor walk, so the roll-up
    // half of this is reachable and the fan-down half must match it.
    const units = [
      unit({ code: 'block', is_container: true }),
      unit({ code: 'house', parent_code: 'block', is_container: true, is_combined: true }),
      unit({ code: 'r1', parent_code: 'house' }),
      unit({ code: 'r2', parent_code: 'house' }),
    ]
    const board = buildBoard(
      [
        party({
          display_name: 'Alpha',
          unit_code: 'block',
          unit_name: 'Block',
          unit_codes: ['block'],
        }),
      ],
      units
    )

    expect(board.offBoard).toEqual([])
    const drawn = board.areas.flatMap((a) => a.slots)
    expect(drawn.map((s) => s.unit.code)).toEqual(['house'])
    expect(drawn[0]?.parties.map((p) => p.display_name)).toEqual(['Alpha'])
  })
})

describe('buildBoard — consent flag follows leaf overlap, not the card (task-11)', () => {
  /**
   * A combined container: `house` draws ONE card, and both `r1` and `r2` roll
   * up onto it (the roll-up `indexPayload` already does for a merged
   * building). Modelled on the real report: two households in the front and
   * back halves of one combined building went unflagged split, then flagged
   * the moment the card was merged, though nothing about either household
   * changed. (Unit named structurally, not literally -- the Lodging Name
   * Guard drops comments and exempts test files, so a real name here would
   * never be caught. See the sweep issue for the rest.)
   */
  const combinedHouse = [
    unit({ code: 'house', is_container: true, is_combined: true, sleeps: 8 }),
    unit({ code: 'r1', parent_code: 'house' }),
    unit({ code: 'r2', parent_code: 'house' }),
  ]

  /** A household placed in one room, with a resolved eligibility that alone would flag. */
  function inRoom(unitCode: string, overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
    return party({
      unit_code: unitCode,
      unit_name: unitCode,
      share: {
        preference: 'unknown',
        proximity: [],
        request_text: '',
        needs_resolution: false,
        eligibility: 'declined',
        eligibility_source: 'form',
        answers_conflict: false,
      },
      ...overrides,
    })
  }

  it('does not flag two households the merge rolled onto one card from DISJOINT rooms', () => {
    // docs/architecture/lodging-occupancy.md: "An extended family spanning
    // two or more registrations may occupy one house together, each
    // registration in its own room. This is not sharing a unit."
    const board = buildBoard(
      [
        inRoom('r1', { household_cm_id: 500001, display_name: 'Alpha' }),
        inRoom('r2', { household_cm_id: 500002, display_name: 'Beta' }),
      ],
      combinedHouse
    )
    expect(board.areas[0]?.slots[0]?.unit.code).toBe('house')
    expect(board.areas[0]?.slots[0]?.parties).toHaveLength(2)
    expect(board.areas[0]?.slots[0]?.consent).toBeNull()
    expect(board.flaggedCount).toBe(0)
  })

  it('flags two households the merge rolled onto one card from the SAME room', () => {
    const board = buildBoard(
      [
        inRoom('r1', { household_cm_id: 500001, display_name: 'Alpha' }),
        inRoom('r1', { household_cm_id: 500002, display_name: 'Beta' }),
      ],
      combinedHouse
    )
    expect(board.areas[0]?.slots[0]?.consent).not.toBeNull()
    expect(board.flaggedCount).toBe(1)
  })

  it('flags a CONTAINER-named household against one named a room beneath it, split', () => {
    // A party on the building occupies every room in it, so it overlaps a
    // party in any one of them. Nothing here is merged at all — the container
    // fans down onto both rooms and `r1` holds two parties — so this is a
    // straight comparison of `'house'` against `'r1'`, which finds no
    // intersection unless the container is expanded to its leaves first.
    const splitHouse = [
      unit({ code: 'house', is_container: true }),
      unit({ code: 'r1', parent_code: 'house' }),
      unit({ code: 'r2', parent_code: 'house' }),
    ]
    const board = buildBoard(
      [
        inRoom('house', { household_cm_id: 500001, display_name: 'Alpha' }),
        inRoom('r1', { household_cm_id: 500002, display_name: 'Beta' }),
      ],
      splitHouse
    )

    const shared = board.areas[0]?.slots.find((slot) => slot.unit.code === 'r1')
    expect(shared?.parties).toHaveLength(2)
    expect(shared?.consent).not.toBeNull()
    // `r2` holds only the fanned-down container party, so it is nobody's
    // share: one slot flagged, not two.
    expect(board.flaggedCount).toBe(1)
  })

  it('flags a CONTAINER-named household against one named a room beneath it, combined', () => {
    // The same two households once the building is drawn as one card. The
    // verdict must not depend on the draw level — that is what task-11
    // settled — so this is the merged mirror of the split case above.
    const board = buildBoard(
      [
        inRoom('house', { household_cm_id: 500001, display_name: 'Alpha' }),
        inRoom('r1', { household_cm_id: 500002, display_name: 'Beta' }),
      ],
      combinedHouse
    )

    expect(board.areas[0]?.slots[0]?.unit.code).toBe('house')
    expect(board.areas[0]?.slots[0]?.parties).toHaveLength(2)
    expect(board.areas[0]?.slots[0]?.consent).not.toBeNull()
    expect(board.flaggedCount).toBe(1)
  })

  it('flags a multi-room party whose rooms overlap a single-room party', () => {
    const multiRoom = party({
      household_cm_id: 500001,
      display_name: 'Alpha',
      unit_code: '',
      unit_name: 'House',
      unit_codes: ['r1', 'r2'],
      is_merged_slot: true,
      share: {
        preference: 'unknown',
        proximity: [],
        request_text: '',
        needs_resolution: false,
        eligibility: 'declined',
        eligibility_source: 'form',
        answers_conflict: false,
      },
    })
    const singleRoom = inRoom('r1', { household_cm_id: 500002, display_name: 'Beta' })

    const board = buildBoard([multiRoom, singleRoom], combinedHouse)
    expect(board.areas[0]?.slots[0]?.parties).toHaveLength(2)
    expect(board.areas[0]?.slots[0]?.consent).not.toBeNull()
  })

  it('still flags a plain leaf slot holding two parties in the same room', () => {
    // Not a merged card at all -- proves the ordinary, pre-existing case is
    // unbroken by gating on overlap.
    const board = buildBoard(
      [
        party({
          household_cm_id: 500001,
          display_name: 'Alpha',
          unit_code: 'cedar-1',
          unit_name: 'Cedar 1',
          share: {
            preference: 'unknown',
            proximity: [],
            request_text: '',
            needs_resolution: false,
            eligibility: 'declined',
            eligibility_source: 'form',
            answers_conflict: false,
          },
        }),
        party({
          household_cm_id: 500002,
          display_name: 'Beta',
          unit_code: 'cedar-1',
          unit_name: 'Cedar 1',
          share: {
            preference: 'unknown',
            proximity: [],
            request_text: '',
            needs_resolution: false,
            eligibility: 'declined',
            eligibility_source: 'form',
            answers_conflict: false,
          },
        }),
      ],
      [unit()]
    )
    expect(board.areas[0]?.slots[0]?.consent).not.toBeNull()
    expect(board.flaggedCount).toBe(1)
  })
})

describe("wholeBuildingHolders — #2008's placement marker, keyed by party", () => {
  const halvedHouse = [
    unit({ unit_id: 'up', code: 'upstairs', is_container: true }),
    unit({ unit_id: 'down', code: 'downstairs', is_container: true }),
    unit({ code: 'up-r1', parent_code: 'upstairs' }),
    unit({ unit_id: 'u2', code: 'up-r2', parent_code: 'upstairs' }),
    unit({ unit_id: 'u3', code: 'down-r1', parent_code: 'downstairs' }),
    unit({ unit_id: 'u4', code: 'down-r2', parent_code: 'downstairs' }),
  ]

  it('marks a party whose own unit_codes cover one whole half', () => {
    const alpha = party({
      household_cm_id: 500001,
      unit_code: '',
      unit_codes: ['up-r1', 'up-r2'],
      is_merged_slot: true,
    })
    expect(wholeBuildingHolders([alpha], halvedHouse)).toEqual(new Set([partyKey(alpha)]))
  })

  it('does not mark a party holding only part of a half', () => {
    const alpha = party({ household_cm_id: 500001, unit_code: 'up-r1', unit_codes: ['up-r1'] })
    expect(wholeBuildingHolders([alpha], halvedHouse).size).toBe(0)
  })

  it('does not mark either of two households splitting one combined house between them', () => {
    // The Front/Back case: a combined card holding two DISJOINT households.
    // The CARD is the whole building, but neither PARTY individually is —
    // that is the point of the signal being about the placement, not the
    // slot. Named at a container code that expands to every leaf via the
    // container row itself, mirroring how a real combined-house drop names
    // the container's own code.
    const combinedHouse = [
      unit({ code: 'house', is_container: true, is_combined: true }),
      unit({ code: 'r1', parent_code: 'house' }),
      unit({ code: 'r2', parent_code: 'house' }),
    ]
    const alpha = party({ household_cm_id: 500001, unit_code: 'r1', unit_codes: ['r1'] })
    const beta = party({ household_cm_id: 500002, unit_code: 'r2', unit_codes: ['r2'] })
    expect(wholeBuildingHolders([alpha, beta], combinedHouse).size).toBe(0)
  })

  it('marks a single party named at the combined container code covering both its rooms', () => {
    const combinedHouse = [
      unit({ code: 'house', is_container: true, is_combined: true }),
      unit({ code: 'r1', parent_code: 'house' }),
      unit({ code: 'r2', parent_code: 'house' }),
    ]
    const alpha = party({
      household_cm_id: 500001,
      unit_code: 'house',
      unit_codes: ['house'],
    })
    expect(wholeBuildingHolders([alpha], combinedHouse)).toEqual(new Set([partyKey(alpha)]))
  })

  it('never marks a party alone in a freestanding room with no registry parent', () => {
    const alpha = party({ household_cm_id: 500001, unit_code: 'cedar-1', unit_codes: ['cedar-1'] })
    expect(wholeBuildingHolders([alpha], [unit()]).size).toBe(0)
  })
})

describe('overlappingPartyKeys — a two-unit alias is ambiguous, not a confirmed share (kindred#2339)', () => {
  // A `lodging_unit_aliases` row mapping one alias string to TWO units writes
  // BOTH member codes onto every household that resolves through it
  // (`lodging_assignments_sync.go`'s `placementFor` records the alias's own
  // member set verbatim, deliberately unjudged). Two DIFFERENT households
  // independently resolving through the same alias then each claim the
  // identical two-code set -- which reads exactly like a shared room unless
  // this is guarded, even though the honest state is "one per unit,
  // unconfirmed which". The rule: H households on an N-unit alias is only
  // evidence of a real double-booking once H > N.
  const twoUnitAlias = [unit({ unit_id: 'u1', code: 'r1' }), unit({ unit_id: 'u2', code: 'r2' })]

  it('does not flag two households who each resolved to the same two-unit alias (H == N)', () => {
    const alpha = party({ household_cm_id: 500001, unit_code: '', unit_codes: ['r1', 'r2'] })
    const beta = party({ household_cm_id: 500002, unit_code: '', unit_codes: ['r1', 'r2'] })
    expect(overlappingPartyKeys([alpha, beta], twoUnitAlias).size).toBe(0)
  })

  it('flags all three once a two-unit alias is claimed by a third household (H > N)', () => {
    const alpha = party({ household_cm_id: 500001, unit_code: '', unit_codes: ['r1', 'r2'] })
    const beta = party({ household_cm_id: 500002, unit_code: '', unit_codes: ['r1', 'r2'] })
    const gamma = party({ household_cm_id: 500003, unit_code: '', unit_codes: ['r1', 'r2'] })
    expect(overlappingPartyKeys([alpha, beta, gamma], twoUnitAlias)).toEqual(
      new Set([partyKey(alpha), partyKey(beta), partyKey(gamma)])
    )
  })

  it('still flags a genuine same-room share unrelated to any alias', () => {
    const alpha = party({ household_cm_id: 500001, unit_code: 'r1', unit_codes: ['r1'] })
    const beta = party({ household_cm_id: 500002, unit_code: 'r1', unit_codes: ['r1'] })
    expect(overlappingPartyKeys([alpha, beta], twoUnitAlias)).toEqual(
      new Set([partyKey(alpha), partyKey(beta)])
    )
  })

  it('still flags an alias household against a household confirmed in one of its rooms', () => {
    // `alpha`'s own signature group has H = 1 household claiming its N = 2
    // codes -- ambiguous on its own, but irrelevant here, because `beta` is
    // NOT in that same signature group (`beta` names one code, not two), so
    // the pair between them is never treated as ambiguous. `beta`'s
    // single-leaf placement is a confirmed claim on `r1`.
    const alpha = party({ household_cm_id: 500001, unit_code: '', unit_codes: ['r1', 'r2'] })
    const beta = party({ household_cm_id: 500002, unit_code: 'r1', unit_codes: ['r1'] })
    expect(overlappingPartyKeys([alpha, beta], twoUnitAlias)).toEqual(
      new Set([partyKey(alpha), partyKey(beta)])
    )
  })

  // Through `buildBoard`, the real entry point the board renders from --
  // `overlappingPartyKeys` is not what staff see. `consentFlag` reads its
  // output and `flaggedCount` sums the result, so the amber ring is what the
  // guard actually silences; a test only on the helper would pass even if the
  // wiring above it stopped reading the guarded value.
  function aliasBoard(householdCount: number) {
    const parties = Array.from({ length: householdCount }, (_, index) =>
      party({
        household_cm_id: 500101 + index,
        display_name: `H${String(index)}`,
        unit_code: '',
        unit_name: 'R 1 + R 2',
        unit_codes: ['r1', 'r2'],
        // `is_merged_slot` is what makes `buildBoard` DRAW a multi-code
        // placement instead of railing it as unplaced -- without it this
        // fixture yields an empty board, which would satisfy the H <= N
        // assertion below for entirely the wrong reason.
        is_merged_slot: true,
        share: {
          preference: 'unknown',
          proximity: [],
          request_text: '',
          needs_resolution: false,
          // `declined` is the eligibility that DOES raise the flag once an
          // overlap is found, so a silent board here is the guard working
          // rather than the fixture having nothing to report.
          eligibility: 'declined',
          eligibility_source: 'form',
          answers_conflict: false,
        },
      })
    )
    return buildBoard(parties, twoUnitAlias)
  }

  it('raises no amber flag on the BOARD for two households on one two-unit alias', () => {
    const board = aliasBoard(2)
    expect(board.flaggedCount).toBe(0)
    expect(board.areas.flatMap((area) => area.slots).map((slot) => slot.consent)).toEqual([
      null,
      null,
    ])
  })

  it('still raises the board flag once a third household claims the same two units', () => {
    expect(aliasBoard(3).flaggedCount).toBeGreaterThan(0)
  })
})

describe('overlappingPartyKeys — a CONTAINER is ambiguous on the same terms as an alias (kindred#2371)', () => {
  // The alias suite above is entirely MULTI-CODE, which is exactly why this
  // route was missed. Two households each named at ONE container code claim
  // the identical set of rooms just as surely as two households each naming
  // that container's two rooms explicitly -- `occupiedLeafCodes` expands both
  // to the same leaves -- so the H <= N rule must reach them on the same
  // terms. Judging ambiguity on the codes a placement HAPPENED TO NAME rather
  // than on the rooms it claims is what split the two routes apart.
  const twoRoomHouse = [
    unit({ unit_id: 'uh', code: 'house', name: 'Aspen House', is_container: true }),
    unit({ unit_id: 'u1', code: 'r1', name: 'Aspen 1', parent_code: 'house' }),
    unit({ unit_id: 'u2', code: 'r2', name: 'Aspen 2', parent_code: 'house' }),
  ]

  it('does not flag two households each named at the SAME two-room container (H == N)', () => {
    const alpha = party({ household_cm_id: 500001, unit_code: 'house', unit_codes: ['house'] })
    const beta = party({ household_cm_id: 500002, unit_code: 'house', unit_codes: ['house'] })
    expect(overlappingPartyKeys([alpha, beta], twoRoomHouse).size).toBe(0)
  })

  it('treats a container name and its explicit room set as the SAME claim', () => {
    // Two ways of writing one placement. `alpha` names the house; `beta` names
    // both of its rooms. One household per room fits either way, so neither
    // spelling is evidence of a confirmed share.
    const alpha = party({ household_cm_id: 500001, unit_code: 'house', unit_codes: ['house'] })
    const beta = party({ household_cm_id: 500002, unit_code: '', unit_codes: ['r1', 'r2'] })
    expect(overlappingPartyKeys([alpha, beta], twoRoomHouse).size).toBe(0)
  })

  it('flags all three once a third household is named at the same two-room container (H > N)', () => {
    const alpha = party({ household_cm_id: 500001, unit_code: 'house', unit_codes: ['house'] })
    const beta = party({ household_cm_id: 500002, unit_code: 'house', unit_codes: ['house'] })
    const gamma = party({ household_cm_id: 500003, unit_code: 'house', unit_codes: ['house'] })
    expect(overlappingPartyKeys([alpha, beta, gamma], twoRoomHouse)).toEqual(
      new Set([partyKey(alpha), partyKey(beta), partyKey(gamma)])
    )
  })

  it('still flags two households on a ONE-room container (N == 1, so H > N at two)', () => {
    // A container is not a licence to co-locate. Expanded, both households
    // claim the single room beneath it -- a genuine same-room share.
    const oneRoomHouse = [
      unit({ unit_id: 'uh', code: 'house', name: 'Aspen House', is_container: true }),
      unit({ unit_id: 'u1', code: 'r1', name: 'Aspen 1', parent_code: 'house' }),
    ]
    const alpha = party({ household_cm_id: 500001, unit_code: 'house', unit_codes: ['house'] })
    const beta = party({ household_cm_id: 500002, unit_code: 'house', unit_codes: ['house'] })
    expect(overlappingPartyKeys([alpha, beta], oneRoomHouse)).toEqual(
      new Set([partyKey(alpha), partyKey(beta)])
    )
  })

  it('still flags a container household against a household confirmed in one of its rooms', () => {
    // `beta` names ONE room -- a confirmed claim on `r1`, not the same
    // ambiguous set -- so the pair between them is never ambiguous, exactly
    // as on the alias route.
    const alpha = party({ household_cm_id: 500001, unit_code: 'house', unit_codes: ['house'] })
    const beta = party({ household_cm_id: 500002, unit_code: 'r1', unit_codes: ['r1'] })
    expect(overlappingPartyKeys([alpha, beta], twoRoomHouse)).toEqual(
      new Set([partyKey(alpha), partyKey(beta)])
    )
  })

  // Through `buildBoard`, the real entry point staff see -- the same reason
  // the alias suite above ends with a board test. A combined container draws
  // ONE card, so both households land on it and `consentFlag` runs over the
  // pair.
  function containerBoard(householdCount: number) {
    const combinedHouse = [
      unit({
        unit_id: 'uh',
        code: 'house',
        name: 'Aspen House',
        is_container: true,
        is_combined: true,
      }),
      unit({ unit_id: 'u1', code: 'r1', name: 'Aspen 1', parent_code: 'house' }),
      unit({ unit_id: 'u2', code: 'r2', name: 'Aspen 2', parent_code: 'house' }),
    ]
    const parties = Array.from({ length: householdCount }, (_, index) =>
      party({
        household_cm_id: 500201 + index,
        display_name: `H${String(index)}`,
        unit_code: 'house',
        unit_name: 'Aspen House',
        unit_codes: ['house'],
        share: {
          preference: 'unknown',
          proximity: [],
          request_text: '',
          needs_resolution: false,
          // `declined` is the eligibility that DOES raise the flag once an
          // overlap is found, so a silent board is the guard working rather
          // than the fixture having nothing to report.
          eligibility: 'declined',
          eligibility_source: 'form',
          answers_conflict: false,
        },
      })
    )
    return buildBoard(parties, combinedHouse)
  }

  it('raises no amber flag on the BOARD for two households on one two-room container', () => {
    const board = containerBoard(2)
    expect(board.flaggedCount).toBe(0)
    expect(board.areas.flatMap((area) => area.slots).map((slot) => slot.consent)).toEqual([null])
  })

  it('still raises the board flag once a third household is named at the same container', () => {
    expect(containerBoard(3).flaggedCount).toBeGreaterThan(0)
  })
})
