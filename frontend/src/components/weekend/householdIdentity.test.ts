/**
 * The household's identity where the deleted salutation used to stand.
 *
 * Fictional data throughout.
 */
import { describe, expect, it } from 'vitest'

import type { RosterPartyRow } from '../../types/lodging'
import {
  attendingAdults,
  childSurnames,
  dedupeAdultNames,
  dedupeChildNames,
  familyNameLabel,
  isAttendingAdultName,
  namedAdults,
  partyFamilyLabel,
  partyHeadcount,
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

describe('partyHeadcount -- kindred#2152', () => {
  // `party_size` became a BED count under kindred#1925/#2046 -- it drops
  // placeholder/blank adult slots AND discounts a child under 18 months, so
  // it can legitimately disagree with the names actually printed on a card.
  // Any badge or count that stands next to the printed adult/child list must
  // use THIS, never `party.party_size`, or the two disagree on screen.
  it('counts the named adults and the children, ignoring the reported party_size', () => {
    const p = party({
      party_size: 9,
      adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
      children: [
        { person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 },
        { person_cm_id: 9002, display_name: 'Ava Johnson', age: 5, grade: 0 },
      ],
    })
    expect(partyHeadcount(p)).toBe(3)
  })

  // kindred#1946's cleanup hasn't run against prod yet -- the nameless rows
  // this predicate exists for are still live. The count must be correct with
  // them present, not just after a resync nobody has confirmed happened.
  it('excludes blank and placeholder adult rows even though party.adults still carries them', () => {
    const p = party({
      party_size: 5,
      adults: [
        { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
        { adult_number: 2, display_name: '', relationship: '' },
        { adult_number: 3, display_name: 'NA', relationship: '' },
      ],
      children: [],
    })
    expect(partyHeadcount(p)).toBe(1)
  })

  it('counts a person-grain party’s own adult entry, not just household grain', () => {
    const p = party({
      grain: 'person',
      display_name: 'Priya Patel',
      adults: [{ adult_number: 1, display_name: 'Priya Patel' }],
      children: [],
    })
    expect(partyHeadcount(p)).toBe(1)
  })

  it('returns 0 rather than throwing when adults and children are both missing', () => {
    const p = party()
    delete p.adults
    delete p.children
    expect(partyHeadcount(p)).toBe(0)
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

/**
 * kindred#2180 -- naming a household by its children's deduplicated surnames.
 *
 * ⚠️ A HYPHENATED SURNAME IS ONE NAME. 72 of 2026's 680 distinct rostered
 * children carry one (measured 2026-08-09). Dedupe on the whole string; a
 * family of Garcia-Lopez children is "The Garcia-Lopez Family" and never
 * "The Garcia & Lopez Family".
 */
describe('childSurnames -- kindred#2180', () => {
  it('is a hyphenated surname ONE name, never its parts', () => {
    expect(
      childSurnames([
        { person_cm_id: 1, display_name: 'Ava Garcia-Lopez', last_name: 'Garcia-Lopez' },
        { person_cm_id: 2, display_name: 'Liam Garcia-Lopez', last_name: 'Garcia-Lopez' },
      ])
    ).toEqual(['Garcia-Lopez'])
    expect(familyNameLabel(['Garcia-Lopez'])).toBe('The Garcia-Lopez Family')
  })

  it('keeps a surname that contains a space whole -- the reason last_name is on the wire', () => {
    expect(
      childSurnames([
        { person_cm_id: 1, display_name: 'Ava Martinez Garcia', last_name: 'Martinez Garcia' },
      ])
    ).toEqual(['Martinez Garcia'])
  })

  it('dedupes case-insensitively and keeps the first-seen casing', () => {
    expect(
      childSurnames([
        { person_cm_id: 1, display_name: 'Ava Johnson', last_name: 'Johnson' },
        { person_cm_id: 2, display_name: 'Liam johnson', last_name: 'johnson' },
      ])
    ).toEqual(['Johnson'])
  })

  it('preserves the order the children arrive in -- oldest first, as the API sorts them', () => {
    expect(
      childSurnames([
        { person_cm_id: 1, display_name: 'Ava Nguyen', last_name: 'Nguyen' },
        { person_cm_id: 2, display_name: 'Liam Patel', last_name: 'Patel' },
        { person_cm_id: 3, display_name: 'Mia Nguyen', last_name: 'Nguyen' },
      ])
    ).toEqual(['Nguyen', 'Patel'])
  })

  it('drops a blank or whitespace-only surname rather than naming a family after nothing', () => {
    expect(
      childSurnames([
        { person_cm_id: 1, display_name: 'Ava', last_name: '' },
        { person_cm_id: 2, display_name: 'Liam Johnson', last_name: '  ' },
      ])
    ).toEqual([])
  })

  it('handles no children at all', () => {
    expect(childSurnames([])).toEqual([])
    expect(childSurnames(undefined)).toEqual([])
  })
})

describe('familyNameLabel -- kindred#2180', () => {
  it('names one surname', () => {
    expect(familyNameLabel(['Johnson'])).toBe('The Johnson Family')
  })

  it('joins two with an ampersand', () => {
    expect(familyNameLabel(['Johnson', 'Garcia'])).toBe('The Johnson & Garcia Family')
  })

  /*
   * The 3+ form is NOT hypothetical and must not be special-cased away. One
   * 2026 rostered household already has three distinct child surnames
   * (374 single / 7 double / 1 triple across 382 households, 2026-08-09), and
   * kindred#2073's heading spans YEARS -- it takes the union of the per-year
   * sets, which goes higher still.
   */
  it('commas the middle and ampersands the last for three or more', () => {
    expect(familyNameLabel(['Johnson', 'Garcia', 'Nguyen'])).toBe(
      'The Johnson, Garcia & Nguyen Family'
    )
    expect(familyNameLabel(['Johnson', 'Garcia', 'Nguyen', 'Patel'])).toBe(
      'The Johnson, Garcia, Nguyen & Patel Family'
    )
  })

  it('has nothing to say about no surnames', () => {
    expect(familyNameLabel([])).toBe('')
  })
})

describe('partyFamilyLabel -- kindred#2180', () => {
  it('names the household from its children, not from its adults', () => {
    const p = party({
      adults: [{ adult_number: 1, display_name: 'Olivia Nguyen', relationship: 'Mother' }],
      children: [
        { person_cm_id: 1, display_name: 'Ava Johnson', last_name: 'Johnson', age: 9 },
        { person_cm_id: 2, display_name: 'Liam Johnson', last_name: 'Johnson', age: 7 },
      ],
    })
    expect(partyFamilyLabel(p)).toBe('The Johnson Family')
  })

  /*
   * `family_camp_adults.last_name` is empty for every 2026 row and for every
   * year 2017-2021, so the adults can never be the source. When the children
   * cannot name the household either, fall back to the attending-adult label
   * this replaced rather than to a bare "The Family".
   */
  it('falls back to the attending-adult label when no child carries a surname', () => {
    const p = party({
      adults: [{ adult_number: 1, display_name: 'Olivia Nguyen', relationship: 'Mother' }],
      children: [{ person_cm_id: 1, display_name: 'Ava', last_name: '', age: 9 }],
    })
    expect(partyFamilyLabel(p)).toBe('Olivia Nguyen')
  })

  it('falls back all the way to the salutation when there is nobody named at all', () => {
    const p = party({ display_name: 'Mr. and Mrs. Johnson', adults: [], children: [] })
    expect(partyFamilyLabel(p)).toBe('Mr. and Mrs. Johnson')
  })

  it('leaves a person-grain party its own name -- an adult guest is not a family', () => {
    const p = party({
      grain: 'person',
      display_name: 'Priya Patel',
      adults: [{ adult_number: 1, display_name: 'Priya Patel' }],
      children: [],
    })
    expect(partyFamilyLabel(p)).toBe('Priya Patel')
  })
})

describe('dedupeChildNames -- kindred#2180', () => {
  it('lifts a shared surname out of every child and prints it once', () => {
    const run = dedupeChildNames([
      { person_cm_id: 1, display_name: 'Ava Johnson', last_name: 'Johnson' },
      { person_cm_id: 2, display_name: 'Liam Johnson', last_name: 'Johnson' },
    ])
    expect(run.names).toEqual(['Ava', 'Liam'])
    expect(run.sharedSurname).toBe('Johnson')
  })

  it('lifts a multi-word surname whole, never just its last token', () => {
    const run = dedupeChildNames([
      { person_cm_id: 1, display_name: 'Ava Martinez Garcia', last_name: 'Martinez Garcia' },
      { person_cm_id: 2, display_name: 'Liam Martinez Garcia', last_name: 'Martinez Garcia' },
    ])
    expect(run.names).toEqual(['Ava', 'Liam'])
    expect(run.sharedSurname).toBe('Martinez Garcia')
  })

  it('leaves two surnames alone -- there is nothing shared to lift', () => {
    const run = dedupeChildNames([
      { person_cm_id: 1, display_name: 'Ava Johnson', last_name: 'Johnson' },
      { person_cm_id: 2, display_name: 'Liam Garcia', last_name: 'Garcia' },
    ])
    expect(run.names).toEqual(['Ava Johnson', 'Liam Garcia'])
    expect(run.sharedSurname).toBe('')
  })

  it('leaves an only child their whole name -- one name shares nothing', () => {
    const run = dedupeChildNames([
      { person_cm_id: 1, display_name: 'Ava Johnson', last_name: 'Johnson' },
    ])
    expect(run.names).toEqual(['Ava Johnson'])
    expect(run.sharedSurname).toBe('')
  })

  it('does not strip a child whose whole name IS the surname down to nothing', () => {
    const run = dedupeChildNames([
      { person_cm_id: 1, display_name: 'Johnson', last_name: 'Johnson' },
      { person_cm_id: 2, display_name: 'Liam Johnson', last_name: 'Johnson' },
    ])
    expect(run.names).toEqual(['Johnson', 'Liam Johnson'])
    expect(run.sharedSurname).toBe('')
  })

  it('matches the surname suffix case-insensitively but prints the surname as filed', () => {
    const run = dedupeChildNames([
      { person_cm_id: 1, display_name: 'Ava Johnson', last_name: 'Johnson' },
      { person_cm_id: 2, display_name: 'Liam johnson', last_name: 'johnson' },
    ])
    expect(run.names).toEqual(['Ava', 'Liam'])
    expect(run.sharedSurname).toBe('Johnson')
  })

  it('leaves a nameless child alone rather than inventing a surname for them', () => {
    const run = dedupeChildNames([
      { person_cm_id: 1, display_name: '', last_name: '' },
      { person_cm_id: 2, display_name: 'Liam Johnson', last_name: 'Johnson' },
    ])
    expect(run.names).toEqual(['', 'Liam Johnson'])
    expect(run.sharedSurname).toBe('')
  })
})

/**
 * The adult half is materially weaker and deliberately NOT the children's
 * rule. `family_camp_adults.last_name` is empty on every 2026 row, so the
 * only signal is the trailing token of a free-text name a parent typed. Of
 * the 340 rostered 2026 households with two or more named adults, only 135
 * (39.7%) have all adults sharing one -- the dedupe is a no-op for the rest,
 * which is the correct outcome, not a gap.
 */
describe('dedupeAdultNames -- kindred#2180', () => {
  it('lifts a trailing token every adult shares', () => {
    const run = dedupeAdultNames([
      { adult_number: 1, display_name: 'Olivia Johnson' },
      { adult_number: 2, display_name: 'Noah Johnson' },
    ])
    expect(run.names).toEqual(['Olivia', 'Noah'])
    expect(run.sharedSurname).toBe('Johnson')
  })

  it('leaves two different surnames alone -- 205 of 340 households look like this', () => {
    const run = dedupeAdultNames([
      { adult_number: 1, display_name: 'Olivia Johnson' },
      { adult_number: 2, display_name: 'Noah Garcia' },
    ])
    expect(run.names).toEqual(['Olivia Johnson', 'Noah Garcia'])
    expect(run.sharedSurname).toBe('')
  })

  it('never splits a hyphenated adult surname either', () => {
    const run = dedupeAdultNames([
      { adult_number: 1, display_name: 'Olivia Garcia-Lopez' },
      { adult_number: 2, display_name: 'Noah Garcia-Lopez' },
    ])
    expect(run.names).toEqual(['Olivia', 'Noah'])
    expect(run.sharedSurname).toBe('Garcia-Lopez')
  })

  /*
   * An adult's display_name is free text, so its "surname" is only ever the
   * trailing token -- and a one-token name has nothing in front of it to
   * keep. Lifting it would leave a bare separator on the line.
   */
  it('leaves a single-token adult name alone', () => {
    const run = dedupeAdultNames([
      { adult_number: 1, display_name: 'Johnson' },
      { adult_number: 2, display_name: 'Noah Johnson' },
    ])
    expect(run.names).toEqual(['Johnson', 'Noah Johnson'])
    expect(run.sharedSurname).toBe('')
  })

  it('leaves a lone adult their whole name', () => {
    const run = dedupeAdultNames([{ adult_number: 1, display_name: 'Olivia Johnson' }])
    expect(run.names).toEqual(['Olivia Johnson'])
    expect(run.sharedSurname).toBe('')
  })

  it('keeps a three-token name whole when only the last token is shared', () => {
    const run = dedupeAdultNames([
      { adult_number: 1, display_name: 'Olivia Marie Johnson' },
      { adult_number: 2, display_name: 'Noah Johnson' },
    ])
    expect(run.names).toEqual(['Olivia Marie', 'Noah'])
    expect(run.sharedSurname).toBe('Johnson')
  })
})
