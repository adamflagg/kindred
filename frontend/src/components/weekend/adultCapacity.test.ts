/**
 * The adult-weekend capacity rule (kindred#2765, owner ruling 2026-09-23).
 *
 * On an `adult` session a `shareable` non-container unit holds 8 guests; every
 * other unit makes NO capacity claim; a family weekend is judged on beds,
 * exactly as before. Fictional data throughout.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow, WriteInCoverRow } from '../../types/lodging'
import {
  ADULT_SHARED_CABIN_GUESTS,
  adultLodgingTally,
  isAdultSharedCabin,
  occupancyClaim,
} from './adultCapacity'

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'ridge-d',
    name: 'Ridge D',
    area_code: 'RG',
    area_name: 'Ridge',
    sleeps: 15,
    bathroom: 'shared',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    is_confirmed: true,
    is_active: true,
    is_container: false,
    inventory_class: 'family_pool',
    shareability: 'shareable',
    family_available_override: null,
    reason: '',
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

function guest(personCmId: number, unitCode: string): RosterPartyRow {
  return {
    grain: 'person',
    household_cm_id: 0,
    person_cm_id: personCmId,
    display_name: `Guest ${String(personCmId)}`,
    party_size: 1,
    unit_code: unitCode,
    unit_name: unitCode,
    unit_codes: unitCode === '' ? [] : [unitCode],
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
  }
}

function writeIn(over: Partial<WriteInCoverRow> = {}): WriteInCoverRow {
  return {
    unit_id: 'u1',
    unit_code: 'ridge-d',
    unit_name: 'Ridge D',
    occupant_name: 'Ava Martinez',
    note: '',
    party_size: null,
    relation: 'own',
    unit_sleeps: 15,
    ...over,
  }
}

describe('the ceiling', () => {
  it('is 8 guests, defined once', () => {
    expect(ADULT_SHARED_CABIN_GUESTS).toBe(8)
  })

  it('applies to a shareable cabin that is not a container', () => {
    expect(isAdultSharedCabin(unit())).toBe(true)
  })

  it('does not apply to a single-party unit, an unclassified one, or a container', () => {
    expect(isAdultSharedCabin(unit({ shareability: 'single_party', sleeps: 4 }))).toBe(false)
    expect(isAdultSharedCabin(unit({ shareability: 'unknown' }))).toBe(false)
    // A combined shareable house IS a drop target, but gets no 8-guest ceiling.
    expect(isAdultSharedCabin(unit({ is_container: true, is_combined: true }))).toBe(false)
  })
})

describe('occupancyClaim', () => {
  it('judges a shared cabin on an adult weekend against 8 guests, not its beds', () => {
    expect(occupancyClaim(unit(), 15, true)).toEqual({ kind: 'guests', limit: 8 })
  })

  it('makes no claim about any other unit on an adult weekend', () => {
    expect(occupancyClaim(unit({ shareability: 'single_party' }), 4, true)).toEqual({
      kind: 'none',
      limit: null,
    })
    expect(occupancyClaim(unit({ shareability: 'unknown' }), 4, true).kind).toBe('none')
    expect(occupancyClaim(unit({ is_container: true, is_combined: true }), 8, true).kind).toBe(
      'none'
    )
  })

  it('judges every unit on a family weekend against its beds, unchanged', () => {
    expect(occupancyClaim(unit(), 15, false)).toEqual({ kind: 'beds', limit: 15 })
    expect(occupancyClaim(unit({ shareability: 'single_party' }), null, false)).toEqual({
      kind: 'beds',
      limit: null,
    })
  })
})

describe('adultLodgingTally — the stats bar on an adult weekend', () => {
  const shared = [
    unit({ unit_id: 'u1', code: 'ridge-d', name: 'Ridge D' }),
    unit({ unit_id: 'u2', code: 'ridge-e', name: 'Ridge E' }),
  ]
  const house = unit({
    unit_id: 'h1',
    code: 'oak-house',
    name: 'Oak House',
    is_container: true,
    is_combined: true,
    sleeps: null,
  })
  const houseRoom = unit({
    unit_id: 'h1r',
    code: 'oak-house-1',
    name: 'Oak House 1',
    parent_code: 'oak-house',
    shareability: 'single_party',
    sleeps: 4,
  })
  const single = unit({
    unit_id: 's1',
    code: 'pine-1',
    name: 'Pine 1',
    shareability: 'single_party',
    sleeps: 2,
  })

  it('counts guests in shared cabins against 8 per open shared cabin, and the rest as other lodging', () => {
    const parties = [
      guest(1, 'ridge-d'),
      guest(2, 'ridge-d'),
      guest(3, 'ridge-e'),
      guest(4, 'pine-1'),
      guest(5, ''),
    ]
    const tally = adultLodgingTally(parties, [...shared, house, houseRoom, single])
    expect(tally).toEqual({ placed: 4, sharedGuests: 3, sharedPlaces: 16, otherGuests: 1 })
  })

  it('leaves a combined shareable house out of the denominator and counts its guests as other lodging', () => {
    const parties = [guest(1, 'oak-house'), guest(2, 'oak-house')]
    const tally = adultLodgingTally(parties, [...shared, house, houseRoom, single])
    expect(tally.sharedPlaces).toBe(16)
    expect(tally.otherGuests).toBe(2)
  })

  it('counts an unsized write-in as one guest', () => {
    const written = unit({
      unit_id: 'u1',
      code: 'ridge-d',
      name: 'Ridge D',
      write_ins: [writeIn()],
    })
    const parties = [guest(1, 'ridge-d')]
    const tally = adultLodgingTally(parties, [written, shared[1] as LodgingUnitRow])
    expect(tally).toEqual({ placed: 2, sharedGuests: 2, sharedPlaces: 16, otherGuests: 0 })
  })

  it('counts a write-in on a split house once, as other lodging', () => {
    // The house is NOT combined, so only its rooms are drawn and each carries
    // the house's row as an `ancestor` cover. `sized` leaves an ancestor out of
    // every room's own figure, so the tally must count the guest once itself.
    const splitHouse = unit({
      unit_id: 'h2',
      code: 'elm-house',
      name: 'Elm House',
      is_container: true,
      is_combined: false,
      shareability: 'single_party',
      sleeps: null,
    })
    const houseWriteIn = writeIn({
      unit_id: 'h2',
      unit_code: 'elm-house',
      unit_name: 'Elm House',
      relation: 'ancestor',
      unit_sleeps: 6,
    })
    const rooms = ['elm-house-1', 'elm-house-2'].map((code, i) =>
      unit({
        unit_id: `h2r${String(i)}`,
        code,
        name: code,
        parent_code: 'elm-house',
        shareability: 'single_party',
        sleeps: 3,
        write_ins: [houseWriteIn],
      })
    )
    const tally = adultLodgingTally([guest(1, 'ridge-d')], [...shared, splitHouse, ...rooms])
    expect(tally).toEqual({ placed: 2, sharedGuests: 1, sharedPlaces: 16, otherGuests: 1 })
  })

  it('leaves a shared cabin closed this weekend out of the denominator', () => {
    const closed = unit({
      unit_id: 'u2',
      code: 'ridge-e',
      name: 'Ridge E',
      is_family_available: false,
    })
    expect(adultLodgingTally([], [shared[0] as LodgingUnitRow, closed]).sharedPlaces).toBe(8)
  })
})
