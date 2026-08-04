/**
 * The projection from board to map. Fictional data throughout.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { AREA_HUES } from './boardLayout'
import { buildMapModel, countMapUnits, hasCoordinates, resolvePartyUnits } from './mapModel'

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
    allocation_default: 'family_pool',
    reservation_state: null,
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
      needs_resolution: false,
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

describe('resolvePartyUnits', () => {
  const byCode = new Map([['cedar-1', unit()]])

  it('returns nothing for an unplaced party', () => {
    expect(resolvePartyUnits(party(), byCode)).toEqual([])
  })

  it('returns the one unit a placed party occupies', () => {
    const got = resolvePartyUnits(party({ unit_code: 'cedar-1', unit_name: 'Cedar 1' }), byCode)
    expect(got.map((u) => u.code)).toEqual(['cedar-1'])
  })

  it('returns nothing for a merged slot, which carries no unit code', () => {
    // This is the ONLY place a party becomes units. When the API grows
    // `unit_codes`, this function changes and nothing else does.
    const merged = party({ unit_code: '', unit_name: 'Cedar 1 + Cedar 2', is_merged_slot: true })
    expect(resolvePartyUnits(merged, byCode)).toEqual([])
  })
})

describe('buildMapModel', () => {
  /**
   * Permanent staff housing: held for staff AND not released this weekend.
   *
   * Setting only `allocation_default` is not enough — `unit()` defaults
   * `is_family_available: true`, which satisfies `isPlanningInventory`'s OR
   * clause and leaves the unit drawn. Every earlier staff fixture in the map
   * suite made exactly that mistake, which is why none of them could see the
   * board exclusion reaching the map.
   */
  function staffUnit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
    return unit({ allocation_default: 'staff_default', is_family_available: false, ...overrides })
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
