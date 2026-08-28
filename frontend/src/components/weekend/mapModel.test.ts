/**
 * The projection from board to map. Fictional data throughout.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { AREA_HUES } from './boardLayout'
import { buildMapModel, countMapUnits, hasCoordinates } from './mapModel'

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
    reason: '',
    is_family_available: true,
    map_x: 0.4,
    map_y: 0.5,
    ...overrides,
  }
}

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 9001,
    person_cm_id: 0,
    display_name: 'Johnson',
    adults: [],
    children: [],
    party_size: 3,
    unit_code: '',
    unit_name: '',
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    share: {
      preference: 'unknown',
      preference_raw: '',
      proximity: [],
      request_text: '',
    },
    flags: {
      needs_private_bathroom: false,
      needs_power: false,
      needs_accommodation: false,
      accommodation_is_mandatory: false,
      has_infant: false,
    },
    ...overrides,
  }
}

/** Every party in the payload, wherever the model put it. */
function allPartyNames(model: ReturnType<typeof buildMapModel>): Array<string | undefined> {
  return [
    ...model.units.flatMap((u) => u.parties.map((p) => p.display_name)),
    ...model.unplaced.map((p) => p.display_name),
    ...model.offMap.map((e) => e.party.display_name),
  ].sort()
}

describe('hasCoordinates', () => {
  it('accepts a positioned unit', () => {
    expect(hasCoordinates(unit({ map_x: 0.1, map_y: 0.2 }))).toBe(true)
  })

  it('rejects null, which is an unset coordinate', () => {
    expect(hasCoordinates(unit({ map_x: null, map_y: 0.2 }))).toBe(false)
  })

  it('rejects (0,0), because PocketBase stores an unset number as 0', () => {
    // Unlike `sleeps`, the API does NOT map a stored 0 to null here, so an
    // unpositioned unit arrives as 0.0 and would render in the exact top-left
    // corner looking like a real placement.
    expect(hasCoordinates(unit({ map_x: 0, map_y: 0 }))).toBe(false)
  })

  it('accepts a genuine zero on one axis only', () => {
    expect(hasCoordinates(unit({ map_x: 0, map_y: 0.5 }))).toBe(true)
  })
})

describe('buildMapModel', () => {
  /**
   * Permanent staff housing: held for staff AND not released this weekend.
   *
   * Setting only `inventory_class` is not enough — `unit()` defaults
   * `is_family_available: true`, which satisfies `isPlanningInventory`'s OR
   * clause and leaves the unit drawn. Every earlier staff fixture in the map
   * suite made exactly that mistake, which is why none of them could see the
   * board exclusion reaching the map.
   */
  function staffUnit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
    return unit({ inventory_class: 'staff_default', is_family_available: false, ...overrides })
  }

  it('drops staff housing, because the map is a projection of the board', () => {
    // The map inherits the board's exclusion rather than overriding it.
    //
    // The design doc (§5.3) originally said the opposite — keep them, marked —
    // on the reasoning that a map missing part of the property is worse for
    // orientation. Staff overruled that on 2026-08-04: they know where the
    // staff cabins are, and they asked for FEWER map toggles, not more marks.
    // Recorded here rather than only in the spec, because "the map is a pure
    // projection of the board" is the property that makes the two surfaces
    // agree, and a future reader is more likely to reach for an override than
    // to find the ruling.
    const model = buildMapModel(
      [],
      [unit(), staffUnit({ unit_id: 'u2', code: 'aspen-lodge', map_x: 0.7, map_y: 0.2 })]
    )
    expect(model.units.map((u) => u.unit.code)).toEqual(['cedar-1'])
  })

  it('still draws staff housing that holds a party, so nobody vanishes', () => {
    // The escape hatch reaches the map too. This is the one case where a staff
    // cabin appears on the map, and it must: hiding it would put a family
    // nowhere on the surface that answers "where is this family sleeping".
    const model = buildMapModel(
      [party({ unit_code: 'aspen-lodge', unit_name: 'Aspen Lodge' })],
      [unit(), staffUnit({ unit_id: 'u2', code: 'aspen-lodge', map_x: 0.7, map_y: 0.2 })]
    )
    expect(model.units.map((u) => u.unit.code)).toEqual(['cedar-1', 'aspen-lodge'])
    expect(model.offMap).toHaveLength(0)
    expect(model.unplaced).toHaveLength(0)
  })

  it('counts what the map draws, staff housing excluded', () => {
    const units = [
      unit(),
      staffUnit({ unit_id: 'u2', code: 'aspen-lodge', map_x: 0.7, map_y: 0.2 }),
    ]
    expect(countMapUnits([], units)).toBe(buildMapModel([], units).units.length)
    expect(countMapUnits([], units)).toBe(1)
  })

  it('still never draws a container, staff-held or not', () => {
    // The container rule is not weakened by the staff rule: a building row
    // carries the beds its halves already report.
    const model = buildMapModel(
      [],
      [unit(), staffUnit({ unit_id: 'u2', code: 'staff-block', is_container: true })]
    )
    expect(model.units.map((u) => u.unit.code)).toEqual(['cedar-1'])
  })

  it('never draws a container', () => {
    const model = buildMapModel(
      [],
      [unit(), unit({ unit_id: 'u2', code: 'lodge', is_container: true })]
    )
    expect(model.units.map((u) => u.unit.code)).toEqual(['cedar-1'])
  })

  it('holds an unpositioned unit out of the map and reports it', () => {
    const model = buildMapModel(
      [],
      [unit(), unit({ unit_id: 'u2', code: 'cedar-2', map_x: 0, map_y: 0 })]
    )
    expect(model.units.map((u) => u.unit.code)).toEqual(['cedar-1'])
    expect(model.unpositionedUnits.map((u) => u.code)).toEqual(['cedar-2'])
  })

  it('sends a party in an unpositioned unit off-map, not to the unplaced queue', () => {
    const stranded = party({ display_name: 'Garcia', unit_code: 'cedar-2', unit_name: 'Cedar 2' })
    const model = buildMapModel(
      [stranded],
      [unit({ unit_id: 'u2', code: 'cedar-2', map_x: 0, map_y: 0 })]
    )
    expect(model.unplaced).toEqual([])
    expect(model.offMap).toEqual([{ party: stranded, reason: 'no-coordinates' }])
  })

  it('sends a merged party off-map with the reason that says why', () => {
    const merged = party({
      display_name: 'Nguyen',
      unit_code: '',
      unit_name: 'Cedar 1 + Cedar 2',
      is_merged_slot: true,
    })
    const model = buildMapModel([merged], [unit()])
    expect(model.offMap).toEqual([{ party: merged, reason: 'merged-slot' }])
  })

  it('distinguishes a not-on-board placement from a merged one', () => {
    // Without this, collapsing offMapReason's ternary to a constant
    // 'merged-slot' passes every other test in this file: the totality test
    // exercises this path but only checks names, never `.reason`.
    const stranded = party({ display_name: 'Petrov', unit_code: 'cedar-9', unit_name: 'Cedar 9' })
    const model = buildMapModel([stranded], [unit()])
    expect(model.offMap).toEqual([{ party: stranded, reason: 'not-on-board' }])
  })

  it('keeps a genuinely unplaced party in the unplaced queue', () => {
    const model = buildMapModel([party({ display_name: 'Silva' })], [unit()])
    expect(model.unplaced.map((p) => p.display_name)).toEqual(['Silva'])
    expect(model.offMap).toEqual([])
  })

  it('puts every party in exactly one bucket', () => {
    const parties = [
      party({ display_name: 'Placed', unit_code: 'cedar-1', unit_name: 'Cedar 1' }),
      party({ display_name: 'Unplaced' }),
      party({ display_name: 'Merged', unit_code: '', unit_name: 'A + B', is_merged_slot: true }),
      party({ display_name: 'Stranded', unit_code: 'cedar-9', unit_name: 'Cedar 9' }),
    ]
    const model = buildMapModel(parties, [unit()])
    expect(allPartyNames(model)).toEqual(['Merged', 'Placed', 'Stranded', 'Unplaced'])
  })

  it('takes its area hue from the board, in the board order', () => {
    // buildBoard sorts area buckets by NAME and indexes the hue off that.
    // Map and board must agree about which area is which colour.
    const model = buildMapModel(
      [],
      [unit({ unit_id: 'u2', code: 'birch-1', area_code: 'BW', area_name: 'Birch Wood' }), unit()]
    )
    const hueFor = (code: string) => model.units.find((u) => u.unit.code === code)?.hue
    expect(hueFor('birch-1')).toBe(AREA_HUES[0])
    expect(hueFor('cedar-1')).toBe(AREA_HUES[1])
  })

  it('carries the normalized coordinates through untouched', () => {
    const model = buildMapModel([], [unit({ map_x: 0.25, map_y: 0.75 })])
    expect(model.units[0]).toMatchObject({ x: 0.25, y: 0.75 })
  })
})

/**
 * kindred#2183 — the popover's container summary needs a room count and a
 * whole-house capacity, and it CANNOT derive either: it is handed `MapUnit[]`,
 * never the registry, so a walk to the leaves beneath a combined house is
 * impossible there. Both are computed here and threaded down.
 */
describe('buildMapModel — what a drawn unit stands for (kindred#2183)', () => {
  /**
   * A three-level house, drawn as ONE card: root combined, an intermediate
   * container half, two rooms beneath THAT. Three levels on purpose — a
   * direct-children walk finds nothing here and reports the house as 0 rooms
   * with no capacity, which looks plausible rather than broken.
   */
  const HOUSE: LodgingUnitRow[] = [
    unit({
      unit_id: 'h0',
      code: 'cedar-house',
      name: 'Cedar House',
      is_container: true,
      is_combined: true,
      // A container's own `sleeps` is a DELTA over its rooms (kindred#2041) —
      // the landing futon, not the whole house.
      sleeps: 1,
      map_x: 0.3,
      map_y: 0.3,
    }),
    unit({
      unit_id: 'h1',
      code: 'cedar-house-up',
      name: 'Cedar House Upstairs',
      is_container: true,
      parent_code: 'cedar-house',
      sleeps: 0,
      map_x: 0.3,
      map_y: 0.3,
    }),
    unit({
      unit_id: 'h2',
      code: 'cedar-house-a',
      name: 'Cedar House A',
      parent_code: 'cedar-house-up',
      sleeps: 2,
      map_x: 0.3,
      map_y: 0.3,
    }),
    unit({
      unit_id: 'h3',
      code: 'cedar-house-b',
      name: 'Cedar House B',
      parent_code: 'cedar-house-up',
      sleeps: 3,
      map_x: 0.3,
      map_y: 0.3,
    }),
  ]

  it('says an ordinary room stands for exactly one room', () => {
    const model = buildMapModel([], [unit()])
    expect(model.units[0]?.roomCount).toBe(1)
  })

  it('reports an ordinary room’s own capacity', () => {
    const model = buildMapModel([], [unit({ sleeps: 4 })])
    expect(model.units[0]?.capacity).toBe(4)
  })

  it('leaves an unmeasured room’s capacity unknown rather than calling it 0', () => {
    const model = buildMapModel([], [unit({ sleeps: null })])
    expect(model.units[0]?.capacity).toBeNull()
  })

  it('counts the LEAF rooms under a combined house, at any depth', () => {
    const model = buildMapModel([], HOUSE)
    expect(model.units.map((u) => u.unit.code)).toEqual(['cedar-house'])
    expect(model.units[0]?.roomCount).toBe(2)
  })

  it('adds the house delta to every room beneath it', () => {
    const model = buildMapModel([], HOUSE)
    expect(model.units[0]?.capacity).toBe(6)
  })

  it('refuses a whole-house total when one room beneath is unmeasured', () => {
    const withUnmeasured = HOUSE.map((row) =>
      row.code === 'cedar-house-b' ? { ...row, sleeps: null } : row
    )
    const model = buildMapModel([], withUnmeasured)
    expect(model.units[0]?.capacity).toBeNull()
  })

  it('skips a retired room in both directions — no beds, and no veto', () => {
    // A deactivated room adds nothing and must not park its house in the
    // unmeasured state forever. Same rule as `effectiveSleeps`.
    const retired = HOUSE.map((row) =>
      row.code === 'cedar-house-b' ? { ...row, sleeps: null, is_active: false } : row
    )
    const model = buildMapModel([], retired)
    expect(model.units[0]?.capacity).toBe(3)
  })

  it('leaves a retired room out of the ROOM COUNT too, not only out of the beds', () => {
    // The two numbers are printed on adjacent lines of one summary — "Rooms 2
    // · 1 taken, 1 open" over "Sleeps 3" — so counting a room the capacity
    // deliberately skipped makes the pair disagree, and offers a retired room
    // as one of the building's "open" ones. Whichever way the active filter
    // goes it has to go the same way in both.
    const retired = HOUSE.map((row) =>
      row.code === 'cedar-house-b' ? { ...row, is_active: false } : row
    )
    const model = buildMapModel([], retired)
    expect(model.units[0]?.roomCount).toBe(1)
    expect(model.units[0]?.capacity).toBe(3)
  })
})

/**
 * kindred#2010's straddle marker, threaded to the map for the same reason
 * `roomCount` and `capacity` are: `MapUnitPopover` is handed `MapUnit[]` and
 * never the registry, so it cannot ask `slotOccupancy` the question itself.
 *
 * Without it the peek asserts over-capacity where BOTH board surfaces withhold
 * it — `LodgingUnitCard`'s `overCapacity` and the Assign modal's header each
 * gate on `spanWidth === 0`, and this popover had no gate at all.
 */
describe('buildMapModel — how wide a straddling party is (kindred#2010)', () => {
  /** A house drawn SPLIT: the container is not combined, so its rooms are the marks. */
  const HOUSE = unit({
    unit_id: 'h0',
    code: 'aspen-house',
    name: 'Aspen House',
    is_container: true,
    sleeps: 7,
  })
  const R1 = unit({
    unit_id: 'h1',
    code: 'aspen-1',
    name: 'Aspen 1',
    parent_code: 'aspen-house',
    sleeps: 3,
  })
  const R2 = unit({
    unit_id: 'h2',
    code: 'aspen-2',
    name: 'Aspen 2',
    parent_code: 'aspen-house',
    sleeps: 3,
  })

  it('reports nothing spanning for a party wholly inside the room it is drawn on', () => {
    // `unit_name` is what `indexPayload` reads to decide a party is PLACED at
    // all — a party with only a `unit_code` lands in the unplaced queue and
    // would pass this assertion by never reaching a slot.
    const model = buildMapModel([party({ unit_code: 'cedar-1', unit_name: 'Cedar 1' })], [unit()])
    expect(model.units[0]?.parties).toHaveLength(1)
    expect(model.units[0]?.spanWidth).toBe(0)
  })

  it('reports how many rooms a straddling party holds, on every mark it is drawn on', () => {
    // The household holds both halves and is drawn on each, so the same six
    // people are counted twice over three beds apiece.
    const model = buildMapModel(
      [
        party({
          party_size: 6,
          unit_code: '',
          unit_codes: ['aspen-1', 'aspen-2'],
          unit_name: 'Aspen 1',
        }),
      ],
      [HOUSE, R1, R2]
    )
    expect(model.units.map((u) => u.unit.code)).toEqual(['aspen-1', 'aspen-2'])
    expect(model.units.map((u) => u.parties.length)).toEqual([1, 1])
    expect(model.units.map((u) => u.spanWidth)).toEqual([2, 2])
  })

  it('reports nothing spanning on an empty room', () => {
    const model = buildMapModel([], [HOUSE, R1, R2])
    expect(model.units.map((u) => u.spanWidth)).toEqual([0, 0])
  })
})

describe('countMapUnits', () => {
  it('counts what the map draws, which is not the inventory count', () => {
    const units = [
      unit(),
      unit({ unit_id: 'u2', code: 'lodge', is_container: true }),
      unit({ unit_id: 'u3', code: 'cedar-3', map_x: 0, map_y: 0 }),
    ]
    expect(countMapUnits([], units)).toBe(1)
  })
})
