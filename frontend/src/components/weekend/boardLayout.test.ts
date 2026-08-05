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
} from '../../types/lodging'
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
    expect(slots.map((slot) => slot.unit.code)).toEqual(['cedar-1', 'aspen-lodge'])
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
   * building). Modelled on the real report: two households in Wawona Front
   * and Wawona Back went unflagged split, then flagged the moment the card
   * was merged, though nothing about either household changed.
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
