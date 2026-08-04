/**
 * Triage for the weekend roster.
 *
 * The roster's job is not to list parties — the board places them. Its job is
 * to say which ones need a decision and why. That only works if the signals it
 * ranks on are actually discriminating: measured against real 2026 data,
 * `needs_resolution` is true for 44 of 62 parties, and `has_medical_narrative`
 * (deleted in kindred#1889) was true for 62 of 62
 * for 62 of 62, so neither can drive triage.
 *
 * The state that matters most is a party whose cabin does not provide what
 * they asked for. That cannot be computed until the registry records what each
 * cabin HAS — all 82 cabins are `is_confirmed: false` today — so the check is
 * built now and reports "not verified" until the data exists, rather than
 * guessing from unset amenity defaults and flagging everyone.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import {
  attentionSections,
  countUnmeasuredSpaces,
  partyAttention,
  partyBeds,
} from './rosterAttention'

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 2000001,
    person_cm_id: 0,
    display_name: 'The Johnson Family',
    adults: [{ adult_number: 1, display_name: 'Samuel Johnson', relationship: 'Parent' }],
    children: [{ person_cm_id: 1000001, display_name: 'Emma Johnson', age: 9, grade: 4 }],
    party_size: 2,
    unit_code: 'ridge-a',
    unit_name: 'Ridge A',
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

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'ridge-a',
    name: 'Ridge A',
    sleeps: 5,
    bathroom: 'none',
    has_power: false,
    is_confirmed: true,
    is_active: true,
    is_container: false,
    is_family_available: true,
    ...overrides,
  }
}

describe('partyAttention — ranking', () => {
  it('ranks a mandatory accommodation above everything else', () => {
    const a = partyAttention(
      party({ flags: { needs_accommodation: true, accommodation_is_mandatory: true } })
    )
    expect(a.level).toBe('required')
  })

  it('still reports a mandatory accommodation when the party is also unplaced', () => {
    const a = partyAttention(party({ unit_name: '', flags: { accommodation_is_mandatory: true } }))
    expect(a.level).toBe('required')
  })

  it('flags an unplaced party', () => {
    expect(partyAttention(party({ unit_name: '', unit_code: '' })).level).toBe('unplaced')
  })

  it('settles a placed party with no requested needs', () => {
    expect(partyAttention(party(), unit()).level).toBe('settled')
  })
})

describe('partyAttention — does the cabin provide what was asked for', () => {
  it('reports an unmet need when a CONFIRMED cabin lacks it', () => {
    const a = partyAttention(
      party({ flags: { needs_private_bathroom: true } }),
      unit({ is_confirmed: true, bathroom: 'shared' })
    )
    expect(a.level).toBe('unmet')
    expect(a.reason).toBe('No private bathroom')
  })

  it('settles when a confirmed cabin provides everything asked for', () => {
    const a = partyAttention(
      party({ flags: { needs_private_bathroom: true, needs_power: true } }),
      unit({ is_confirmed: true, bathroom: 'private', has_power: true })
    )
    expect(a.level).toBe('settled')
  })

  it('names every unmet need, not just the first', () => {
    const a = partyAttention(
      party({ flags: { needs_private_bathroom: true, needs_power: true } }),
      unit({ is_confirmed: true, bathroom: 'none', has_power: false })
    )
    expect(a.level).toBe('unmet')
    expect(a.reason).toBe('No private bathroom · No power')
  })

  it('reports "not verified" when the cabin amenities are unconfirmed', () => {
    // The live state: every cabin is unconfirmed, so `has_power: false` means
    // "nobody has said", not "there is no power". Treating that as unmet would
    // flag every constrained family on false evidence.
    const a = partyAttention(
      party({ flags: { needs_power: true } }),
      unit({ is_confirmed: false, has_power: false })
    )
    expect(a.level).toBe('unverified')
    expect(a.reason).toBe('Power')
  })

  it('reports "not verified" when the assigned cabin cannot be found', () => {
    // A merged slot is named for the merge, not a unit code.
    const a = partyAttention(
      party({ flags: { needs_private_bathroom: true }, is_merged_slot: true }),
      undefined
    )
    expect(a.level).toBe('unverified')
  })

  it('cannot verify a generic accommodation request even on a confirmed cabin', () => {
    // `needs_accommodation` names no specific amenity, so no cabin field
    // settles it.
    const a = partyAttention(
      party({ flags: { needs_accommodation: true } }),
      unit({ is_confirmed: true, bathroom: 'private', has_power: true })
    )
    expect(a.level).toBe('unverified')
  })

  it('does not re-list a need the confirmed cabin already provides', () => {
    // A generic accommodation keeps the party unverified, because no cabin
    // field settles it. That must not drag the SPECIFIC needs back into the
    // reason: a confirmed cabin with power has verifiably answered "Power",
    // and saying otherwise reads as "we don't know if this cabin has power"
    // when the registry says it does.
    const a = partyAttention(
      party({ flags: { needs_power: true, needs_accommodation: true } }),
      unit({ is_confirmed: true, has_power: true })
    )
    expect(a.level).toBe('unverified')
    expect(a.reason).toBe('Accommodation')
  })

  it('keeps the specific needs in the reason while the cabin is unconfirmed', () => {
    // The mirror of the case above: without confirmation nothing is verified,
    // so both the specific need and the generic accommodation are outstanding.
    const a = partyAttention(
      party({ flags: { needs_power: true, needs_accommodation: true } }),
      unit({ is_confirmed: false, has_power: true })
    )
    expect(a.level).toBe('unverified')
    expect(a.reason).toBe('Power · Accommodation')
  })

  it('does not escalate on an infant, which is context rather than a request', () => {
    // Derived from the household's ages, not asked for. It informs which cabin
    // suits them; it is not an unfulfilled request.
    expect(partyAttention(party({ flags: { has_infant: true } }), unit()).level).toBe('settled')
  })

  it('does NOT escalate on needs_resolution alone', () => {
    const a = partyAttention(
      party({ share: { needs_resolution: true, request_text: 'near the Garcia family' } }),
      unit()
    )
    expect(a.level).toBe('settled')
  })
})

describe('partyBeds', () => {
  it('uses the reported party size', () => {
    expect(partyBeds(party({ party_size: 4 }))).toBe(4)
  })

  it('falls back to counting people when party_size is absent', () => {
    const withoutSize = party({
      adults: [
        { adult_number: 1, display_name: 'Olivia Chen' },
        { adult_number: 2, display_name: 'Liam Garcia' },
      ],
      children: [{ person_cm_id: 1, display_name: 'Olivia Chen' }],
    })
    delete withoutSize.party_size
    expect(partyBeds(withoutSize)).toBe(3)
  })
})

describe('countUnmeasuredSpaces', () => {
  it('counts only the spaces a family could actually be placed into', () => {
    // Deliberately not `counts.units_capacity_unknown`. It used to span staff
    // holds — 5 on real 2026 data where only 2 of the 79 placeable spaces were
    // unmeasured — but `_build_counts` now excludes staff housing, so on that
    // data the two agree. What still separates them is a cabin HELD BACK this
    // weekend: still planning inventory, so `units_capacity_unknown` keeps it,
    // while nobody can be placed in it today, so this drops it.
    expect(
      countUnmeasuredSpaces([
        unit({ code: 'a', sleeps: null }),
        unit({ code: 'b', sleeps: 5 }),
        unit({ code: 'c', sleeps: null, is_family_available: false }),
        unit({ code: 'd', sleeps: null, is_container: true }),
      ])
    ).toBe(1)
  })

  it('treats an absent capacity the same as an explicit null', () => {
    const noSleeps = unit({ code: 'e' })
    delete noSleeps.sleeps
    expect(countUnmeasuredSpaces([noSleeps])).toBe(1)
  })

  it('returns zero for an empty registry', () => {
    expect(countUnmeasuredSpaces([])).toBe(0)
  })
})

describe('attentionSections', () => {
  it('orders sections by urgency and drops the empty ones', () => {
    const sections = attentionSections(
      [
        party({ display_name: 'Settled Family' }),
        party({ display_name: 'Unplaced Family', unit_name: '', unit_code: '' }),
      ],
      new Map([['ridge-a', unit()]])
    )
    expect(sections.map((s) => s.level)).toEqual(['unplaced', 'settled'])
  })

  it('puts a cabin that does not fit above one that is merely unplaced', () => {
    // An unplaced family is visibly outstanding. A family placed somewhere
    // that does not work looks done and is not.
    const sections = attentionSections(
      [
        party({ display_name: 'Unplaced Family', unit_name: '', unit_code: '' }),
        party({
          display_name: 'Wrong Cabin Family',
          household_cm_id: 2000002,
          flags: { needs_power: true },
        }),
      ],
      new Map([['ridge-a', unit({ is_confirmed: true, has_power: false })]])
    )
    expect(sections.map((s) => s.level)).toEqual(['unmet', 'unplaced'])
  })

  it('preserves the order the API sent within a section', () => {
    const sections = attentionSections(
      [
        party({ display_name: 'Adams', unit_name: '', unit_code: '' }),
        party({ display_name: 'Baker', unit_name: '', unit_code: '' }),
        party({ display_name: 'Chen', unit_name: '', unit_code: '' }),
      ],
      new Map()
    )
    expect(sections[0]?.parties.map((p) => p.display_name)).toEqual(['Adams', 'Baker', 'Chen'])
  })

  it('reports a single section when every party shares one state', () => {
    const sections = attentionSections(
      [
        party({ unit_name: '', unit_code: '' }),
        party({ unit_name: '', unit_code: '', display_name: 'Second' }),
      ],
      new Map()
    )
    expect(sections).toHaveLength(1)
    expect(sections[0]?.level).toBe('unplaced')
  })

  it('returns nothing for an empty roster', () => {
    expect(attentionSections([], new Map())).toEqual([])
  })
})
