/**
 * The household's identity where the deleted salutation used to stand.
 *
 * Fictional data throughout.
 */
import { describe, expect, it } from 'vitest'

import type { RosterPartyRow } from '../../types/lodging'
import {
  attendingAdults,
  isAttendingAdultName,
  namedAdults,
  partyIdentityLabel,
} from './householdIdentity'

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 101,
    display_name: 'Mr. and Mrs. Johnson',
    adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
    children: [],
    party_size: 1,
    unit_code: '',
    unit_name: '',
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    ...overrides,
  }
}

describe('attendingAdults', () => {
  it('keeps only adults with a name on file -- family_camp_adults is not a fixed five', () => {
    const p = party({
      adults: [
        { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
        { adult_number: 2, display_name: '', relationship: '' },
      ],
    })
    expect(attendingAdults(p)).toEqual([
      { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
    ])
  })

  it('returns nothing for a person-grain party -- it has no separate adult list', () => {
    const p = party({
      grain: 'person',
      adults: [{ adult_number: 1, display_name: 'Priya Patel' }],
    })
    expect(attendingAdults(p)).toEqual([])
  })

  it('returns an empty list rather than throwing when adults is missing', () => {
    const p = party()
    delete p.adults
    expect(attendingAdults(p)).toEqual([])
  })
})

describe('namedAdults', () => {
  // Scan finding on kindred#2084: `composition()` and the members line in
  // HouseholdRosterRow, and the Party section in FamilyDetailsPanel, all
  // counted/rendered `party.adults` raw -- including a blank
  // `family_camp_adults` slot. Unlike `attendingAdults`, this is NOT gated
  // to household grain: a person-grain party's own single adult entry is
  // real, not a blank slot to drop.
  it('drops a blank adult slot regardless of grain', () => {
    const p = party({
      adults: [
        { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
        { adult_number: 2, display_name: '', relationship: '' },
      ],
    })
    expect(namedAdults(p)).toEqual([
      { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
    ])
  })

  it('keeps a person-grain party’s own adult entry -- it is real, not a blank slot', () => {
    const p = party({
      grain: 'person',
      adults: [{ adult_number: 1, display_name: 'Priya Patel' }],
    })
    expect(namedAdults(p)).toEqual([{ adult_number: 1, display_name: 'Priya Patel' }])
  })

  it('returns an empty list rather than throwing when adults is missing', () => {
    const p = party()
    delete p.adults
    expect(namedAdults(p)).toEqual([])
  })
})

describe('partyIdentityLabel', () => {
  it('joins the attending adults instead of the (possibly wrong) salutation', () => {
    // kindred#2084: measured against 2026's 382 rostered households, the
    // salutation disagreed with the real adult list on 26.7% of them, in
    // both directions. This is the replacement the ruling picked.
    const p = party({
      display_name: 'Mr. and Mrs. Johnson',
      adults: [
        { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
        { adult_number: 2, display_name: 'David Johnson', relationship: 'Father' },
      ],
    })
    expect(partyIdentityLabel(p)).toBe('Emma Johnson · David Johnson')
  })

  it('drops a blank adult slot from the joined label', () => {
    const p = party({
      adults: [
        { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
        { adult_number: 2, display_name: '', relationship: '' },
      ],
    })
    expect(partyIdentityLabel(p)).toBe('Emma Johnson')
  })

  it('falls back to display_name only when no adult has a name on file', () => {
    // An empty `family_camp_adults` scrape, not a malformed salutation --
    // every household #2084 measured as malformed HAS a non-empty adult
    // list, so this fallback never resurrects the string being replaced.
    const p = party({ display_name: 'Household 4021', adults: [] })
    expect(partyIdentityLabel(p)).toBe('Household 4021')
  })

  it('keeps a person-grain party’s own display_name -- it IS the identity', () => {
    const p = party({
      grain: 'person',
      display_name: 'Priya Patel',
      adults: [{ adult_number: 1, display_name: 'Priya Patel' }],
    })
    expect(partyIdentityLabel(p)).toBe('Priya Patel')
  })
})

describe('placeholder adult names -- kindred#1925', () => {
  /*
   * `family_camp_adults` is a five-slot scrape, and a registrant who has no
   * second adult sometimes types one in anyway. Measured on 2026's 382
   * rostered households: two such rows, holding `NA` and `0`, and BOTH were
   * rendered on the board -- `'NA'.trim()` is truthy, so the blank-name
   * filter let them straight through. Staff were reading an adult called NA.
   *
   * The same predicate now runs server-side inside `party_size`
   * (`api/constants/lodging.py`), and `test_lodging_constants.py` greps this
   * file to pin the two token lists together. Adding a token here without
   * adding it there is a Python test failure, and vice versa.
   */
  it('drops a placeholder from the attending adults', () => {
    const p = party({
      adults: [
        { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
        { adult_number: 2, display_name: 'NA', relationship: '' },
      ],
    })
    expect(attendingAdults(p).map((a) => a.display_name)).toEqual(['Emma Johnson'])
  })

  it('drops a placeholder from namedAdults too', () => {
    const p = party({
      adults: [
        { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
        { adult_number: 3, display_name: '0', relationship: '' },
      ],
    })
    expect(namedAdults(p).map((a) => a.display_name)).toEqual(['Emma Johnson'])
  })

  it('leaves the identity label to the salutation when every slot is a placeholder', () => {
    const p = party({
      display_name: 'Mr. and Mrs. Johnson',
      adults: [{ adult_number: 1, display_name: 'none', relationship: '' }],
    })
    expect(partyIdentityLabel(p)).toBe('Mr. and Mrs. Johnson')
  })

  it('accepts a real name that merely contains a placeholder token', () => {
    expect(isAttendingAdultName('Nona Garcia')).toBe(true)
    expect(isAttendingAdultName('Noor Johnson')).toBe(true)
  })

  it('rejects blanks, whitespace and every placeholder token, case-insensitively', () => {
    expect(isAttendingAdultName('')).toBe(false)
    expect(isAttendingAdultName('   ')).toBe(false)
    expect(isAttendingAdultName(undefined)).toBe(false)
    expect(isAttendingAdultName(null)).toBe(false)
    for (const token of ['NA', 'n/a', ' N/A ', 'None', '-', '0', 'no', 'NO']) {
      expect(isAttendingAdultName(token)).toBe(false)
    }
  })
})
