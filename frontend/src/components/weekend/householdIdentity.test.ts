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
  childrenRun,
  childrenRunLabel,
  dedupeChildNames,
  familyNameLabel,
  isAttendingAdultName,
  namedAdults,
  partyFamilyLabel,
  partyHeadcount,
  partyIdentityLabel,
  partySearchText,
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

  /*
   * Three or more distinct surnames is NOT a hypothetical shape to leave
   * untested: one of 2026's rostered households has three today (re-measured
   * against production 2026-08-09 on the family-camp cohort: 366 single /
   * 6 double / 1 triple across 373 households with a child surname), and
   * kindred#2073's heading spans years and unions those sets.
   */
  it('keeps three or more distinct surnames, in arrival order', () => {
    expect(
      childSurnames([
        { person_cm_id: 1, display_name: 'Ava Johnson', last_name: 'Johnson' },
        { person_cm_id: 2, display_name: 'Liam Garcia', last_name: 'Garcia' },
        { person_cm_id: 3, display_name: 'Mia Nguyen', last_name: 'Nguyen' },
      ])
    ).toEqual(['Johnson', 'Garcia', 'Nguyen'])
  })

  // Punctuation is part of the surname, exactly as a hyphen is. No 2026
  // rostered child carries an apostrophe (0 of 662, measured 2026-08-09), so
  // this pins the rule rather than a live population -- but kindred#2073
  // reaches back through years this measurement does not cover.
  it('keeps an apostrophe inside the surname', () => {
    expect(
      childSurnames([{ person_cm_id: 1, display_name: 'Ava O’Brien', last_name: 'O’Brien' }])
    ).toEqual(['O’Brien'])
    expect(familyNameLabel(['O’Brien'])).toBe('The O’Brien Family')
  })

  // A generational suffix filed INSIDE `persons.last_name` (1 of 662 rostered
  // 2026 children) travels with it -- the dedupe never tokenises a surname,
  // so there is nothing to strip it off.
  it('keeps a generational suffix that is part of the filed surname', () => {
    expect(
      childSurnames([
        { person_cm_id: 1, display_name: 'Liam Johnson III', last_name: 'Johnson III' },
        { person_cm_id: 2, display_name: 'Ava Johnson III', last_name: 'Johnson III' },
      ])
    ).toEqual(['Johnson III'])
  })

  it('ignores padding around a filed surname', () => {
    expect(
      childSurnames([
        { person_cm_id: 1, display_name: 'Ava Johnson', last_name: ' Johnson ' },
        { person_cm_id: 2, display_name: 'Liam Johnson', last_name: 'Johnson' },
      ])
    ).toEqual(['Johnson'])
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

  /*
   * `familyNameLabel` is EXPORTED for kindred#2073, which takes the union of
   * a household's child surnames across years -- and a union assembled by
   * concatenating per-year lists carries the same surname once per year, in
   * whatever casing each year's CampMinder record was typed in. Deduping only
   * inside `childSurnames` would leave that caller printing
   * "The Johnson & johnson Family", so the label normalises its own input and
   * is idempotent: `familyNameLabel(childSurnames(x))` and
   * `familyNameLabel(rawUnion)` agree.
   */
  it('dedupes a repeated surname rather than naming the family twice', () => {
    expect(familyNameLabel(['Johnson', 'johnson'])).toBe('The Johnson Family')
    expect(familyNameLabel(['Johnson', 'Garcia', 'JOHNSON'])).toBe('The Johnson & Garcia Family')
  })

  it('drops a blank surname rather than joining onto nothing', () => {
    expect(familyNameLabel(['Johnson', '   '])).toBe('The Johnson Family')
    expect(familyNameLabel(['  '])).toBe('')
  })

  it('trims a surname rather than printing its padding', () => {
    expect(familyNameLabel([' Johnson '])).toBe('The Johnson Family')
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

  // An adults-only household party -- no children on the weekend at all, as
  // distinct from children who carry no surname. Same fallback, different
  // reason to reach it.
  it('falls back to the attending adults for a party with no children', () => {
    const p = party({
      adults: [{ adult_number: 1, display_name: 'Olivia Nguyen', relationship: 'Mother' }],
      children: [],
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

  it('lifts the surname off an only child too, so the age follows the first name', () => {
    /*
     * ⚠️ THIS EXPECTATION IS THE REVERSE OF THE ONE IT REPLACES, BY RULING
     * (owner, 2026-08-20) -- and the reasoning it overturns is worth keeping
     * rather than deleting. kindred#2180 lifted a surname only for two or
     * more children, on the argument that "a single child shares nothing with
     * anybody", so an only child printed `Ava Johnson (5)` while a pair
     * printed `Ava (5) · Liam (8) Johnson`.
     *
     * What that argument missed is what the lift is FOR on this board. It is
     * not a deduplication for its own sake: it puts the AGE immediately after
     * the first name, which is the pair staff read when they are matching
     * families by how old the children are. `Ava Johnson (5)` puts a surname
     * between them; `Ava (5) Johnson` does not, and the review artifact drew
     * it that way throughout.
     *
     * The two-or-more gate remains for ADULTS (`dedupeAdultNames`), whose
     * surname is a guessed trailing token rather than a structured field.
     */
    const run = dedupeChildNames([
      { person_cm_id: 1, display_name: 'Ava Johnson', last_name: 'Johnson' },
    ])
    expect(run.names).toEqual(['Ava'])
    expect(run.sharedSurname).toBe('Johnson')
  })

  it('still leaves an only child whose name IS the surname whole', () => {
    // The `nameBeforeSurname` guard is what the relaxed gate must not reach
    // past: lifting `Johnson` off `Johnson` leaves an empty segment, and the
    // card would render a bare age in front of a surname.
    const run = dedupeChildNames([
      { person_cm_id: 1, display_name: 'Johnson', last_name: 'Johnson' },
    ])
    expect(run.names).toEqual(['Johnson'])
    expect(run.sharedSurname).toBe('')
  })

  it('still leaves an only child with no surname on file alone', () => {
    // Nothing structured to lift. The run prints exactly what is filed.
    const run = dedupeChildNames([{ person_cm_id: 1, display_name: 'Ava Johnson', last_name: '' }])
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

  // Two siblings' rows are two CampMinder records, typed at different times.
  // The surname is one surname whether or not their casing and padding agree,
  // and the name in front of it must not keep the padding either.
  it('lifts the surname past casing and whitespace differences between siblings', () => {
    const run = dedupeChildNames([
      { person_cm_id: 1, display_name: 'Ava  Johnson', last_name: 'Johnson' },
      { person_cm_id: 2, display_name: 'Liam johnson ', last_name: ' johnson ' },
    ])
    expect(run.names).toEqual(['Ava', 'Liam'])
    expect(run.sharedSurname).toBe('Johnson')
  })

  it('keeps an apostrophe surname whole', () => {
    const run = dedupeChildNames([
      { person_cm_id: 1, display_name: 'Ava O’Brien', last_name: 'O’Brien' },
      { person_cm_id: 2, display_name: 'Liam O’Brien', last_name: 'O’Brien' },
    ])
    expect(run.names).toEqual(['Ava', 'Liam'])
    expect(run.sharedSurname).toBe('O’Brien')
  })

  // The suffix is inside `persons.last_name`, so it is part of the ONE name
  // being lifted -- never left stranded on the individual children.
  it('lifts a surname carrying a generational suffix whole', () => {
    const run = dedupeChildNames([
      { person_cm_id: 1, display_name: 'Liam Johnson III', last_name: 'Johnson III' },
      { person_cm_id: 2, display_name: 'Ava Johnson III', last_name: 'Johnson III' },
    ])
    expect(run.names).toEqual(['Liam', 'Ava'])
    expect(run.sharedSurname).toBe('Johnson III')
  })

  it('leaves three different surnames written out in full', () => {
    const run = dedupeChildNames([
      { person_cm_id: 1, display_name: 'Ava Johnson', last_name: 'Johnson' },
      { person_cm_id: 2, display_name: 'Liam Garcia', last_name: 'Garcia' },
      { person_cm_id: 3, display_name: 'Mia Nguyen', last_name: 'Nguyen' },
    ])
    expect(run.names).toEqual(['Ava Johnson', 'Liam Garcia', 'Mia Nguyen'])
    expect(run.sharedSurname).toBe('')
  })

  it('has nothing to lift for a party with no children', () => {
    expect(dedupeChildNames([])).toEqual({ names: [], sharedSurname: '' })
    expect(dedupeChildNames(undefined)).toEqual({ names: [], sharedSurname: '' })
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

  /*
   * A generational suffix is the one place the trailing-token rule could lift
   * the WRONG token, and it is the reason nothing is lifted unless every
   * adult's trailing token matches: "David Johnson Jr." and "Emma Johnson"
   * disagree, so both stay whole rather than the line reading
   * "David Johnson · Emma Johnson Jr.".
   *
   * The both-carry-a-suffix case, where the rule would lift "Jr." itself, is
   * unreachable on the live data: of the 132 rostered 2026 households whose
   * named adults share a trailing token, 0 share a suffix token (measured
   * 2026-08-09). It is left unhandled deliberately rather than guarded with a
   * speculative stop-list.
   */
  it('leaves a suffixed adult name alone when the trailing tokens disagree', () => {
    const run = dedupeAdultNames([
      { adult_number: 1, display_name: 'David Johnson Jr.' },
      { adult_number: 2, display_name: 'Emma Johnson' },
    ])
    expect(run.names).toEqual(['David Johnson Jr.', 'Emma Johnson'])
    expect(run.sharedSurname).toBe('')
  })

  /*
   * ★ THE TRAILING-TOKEN GATE IS NOT REDUNDANT WITH `dedupedRun`, and deleting
   * it as "already checked below" is the mutation this test exists to kill.
   *
   * `dedupedRun` asks only whether each name ENDS WITH the surname string --
   * a raw suffix compare with no word boundary, which is safe for the
   * children (their `display_name` is built as `first + ' ' + last_name`, so
   * the boundary is guaranteed) but NOT for an adult's free text. Without the
   * gate, "Olivia MacJohnson" ends with the FIRST adult's "Johnson" and the
   * line would render "Noah · Olivia Mac Johnson" -- half of one surname
   * printed as a forename and the other half lent to a stranger.
   *
   * Order matters to this test: the candidate surname is the first adult's
   * trailing token, so the longer name has to come SECOND for the suffix
   * compare to be reachable at all.
   */
  it('does not lift a surname out of the tail of a longer one', () => {
    const run = dedupeAdultNames([
      { adult_number: 1, display_name: 'Noah Johnson' },
      { adult_number: 2, display_name: 'Olivia MacJohnson' },
    ])
    expect(run.names).toEqual(['Noah Johnson', 'Olivia MacJohnson'])
    expect(run.sharedSurname).toBe('')
  })

  it('keeps an apostrophe in a shared adult surname', () => {
    const run = dedupeAdultNames([
      { adult_number: 1, display_name: 'Olivia O’Brien' },
      { adult_number: 2, display_name: 'Noah O’Brien' },
    ])
    expect(run.names).toEqual(['Olivia', 'Noah'])
    expect(run.sharedSurname).toBe('O’Brien')
  })

  // `family_camp_adults.name` is free text a parent typed, so padding and
  // casing are theirs, not the data model's.
  it('lifts a shared surname past padding and casing in a typed name', () => {
    const run = dedupeAdultNames([
      { adult_number: 1, display_name: '  Olivia Johnson ' },
      { adult_number: 2, display_name: 'Noah johnson' },
    ])
    expect(run.names).toEqual(['Olivia', 'Noah'])
    expect(run.sharedSurname).toBe('Johnson')
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

describe('partySearchText', () => {
  /*
   * ONE search text for one queue. `FloatingUnplacedBadge` and the unit
   * card's placement picker (kindred#2080) search the SAME list of unplaced
   * parties; two copies of this construction that drifted would mean a
   * household findable in one and not the other.
   */
  it('finds a household by any member, adult or child', () => {
    const text = partySearchText(
      party({
        adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
        children: [{ person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 }],
      })
    ).toLowerCase()
    expect(text).toContain('emma johnson')
    expect(text).toContain('noah johnson')
  })

  it('leads with the identity the card shows, not CampMinder salutation', () => {
    // kindred#2084: `display_name` is the mailing_title salutation and
    // disagreed with the attending-adult list on 26.7% of 2026 households.
    // Searching for the stale wording must not resurrect it here.
    const text = partySearchText(
      party({
        display_name: 'The Garcia Family',
        adults: [{ adult_number: 1, display_name: 'Liam Garcia', relationship: 'Father' }],
        children: [],
      })
    )
    expect(text).toContain('Liam Garcia')
    expect(text).not.toContain('The Garcia Family')
  })

  it('still names a person-grain guest, who has no household identity', () => {
    // An adult weekend's parties are person-grain; `partyIdentityLabel`
    // falls back to `display_name` for them and this must not go blank.
    const text = partySearchText(
      party({ grain: 'person', person_cm_id: 501, display_name: 'Liam Garcia', adults: [] })
    )
    expect(text).toContain('Liam Garcia')
  })
})

/**
 * The children-run, lifted out of `FamilyCard`'s `ChildList` so the Assign
 * modal's candidate rows can print the SAME identity (owner ruling
 * 2026-08-20, kindred#2072 §3.5).
 *
 * The card renders it as JSX and the modal needs it as text, so the shared
 * derivation returns SEGMENTS and the label is built from them. Everything
 * that used to be a decision inside `ChildList` -- the youngest-first
 * ordering, the unknown-age bucket, the omitted age, the blank-name fallback,
 * the lifted surname -- is made once, here.
 */
describe('childrenRun -- one derivation for the card and the modal (kindred#2072)', () => {
  const fmt = (age: number) => String(Math.trunc(age))

  it('runs youngest first, with the shared surname printed once at the end', () => {
    expect(
      childrenRunLabel(
        [
          { person_cm_id: 2, display_name: 'Liam Johnson', last_name: 'Johnson', age: 8 },
          { person_cm_id: 1, display_name: 'Ava Johnson', last_name: 'Johnson', age: 5 },
        ],
        fmt
      )
    ).toBe('Ava (5) · Liam (8) Johnson')
  })

  it('prints two surnames in full rather than inventing a shared one', () => {
    expect(
      childrenRunLabel(
        [
          { person_cm_id: 1, display_name: 'Ava Johnson', last_name: 'Johnson', age: 5 },
          { person_cm_id: 2, display_name: 'Liam Garcia', last_name: 'Garcia', age: 8 },
        ],
        fmt
      )
    ).toBe('Ava Johnson (5) · Liam Garcia (8)')
  })

  it('omits an age it does not have, and sorts that child LAST rather than first', () => {
    // `(a.age ?? 0) - (b.age ?? 0)` would coerce the unknown to 0 and lead
    // with it -- the exact bug `youngestFirst` was written to avoid.
    expect(
      childrenRunLabel(
        [
          { person_cm_id: 1, display_name: 'Ava Johnson', last_name: 'Johnson', age: null },
          { person_cm_id: 2, display_name: 'Liam Johnson', last_name: 'Johnson', age: 8 },
        ],
        fmt
      )
    ).toBe('Liam (8) · Ava Johnson')
  })

  it('puts an only child’s age straight after their first name (owner, 2026-08-20)', () => {
    // The whole point of the ruling, stated at the surface that renders it:
    // `Isla (3) Nguyen`, not `Isla Nguyen (3)`. Both the card's bold line and
    // the modal's candidate row read this one function, so they cannot
    // disagree about it.
    expect(
      childrenRunLabel(
        [{ person_cm_id: 1, display_name: 'Ava Johnson', last_name: 'Johnson', age: 5 }],
        fmt
      )
    ).toBe('Ava (5) Johnson')
  })

  it('names a child with nothing on file rather than leaving a blank segment', () => {
    expect(
      childrenRunLabel([{ person_cm_id: 1, display_name: '', last_name: '', age: 4 }], fmt)
    ).toBe('Unnamed camper (4)')
  })

  it('is EMPTY for a party with no children, so a caller can fall back', () => {
    // The modal's candidate row falls back to `partyIdentityLabel` on this,
    // which is what an adult-weekend person-grain party gets.
    expect(childrenRunLabel([], fmt)).toBe('')
    expect(childrenRunLabel(undefined, fmt)).toBe('')
  })

  it('returns keyed segments, so the card can render one element per child', () => {
    const run = childrenRun(
      [
        { person_cm_id: 22, display_name: 'Liam Johnson', last_name: 'Johnson', age: 8 },
        { person_cm_id: 11, display_name: 'Ava Johnson', last_name: 'Johnson', age: 5 },
      ],
      fmt
    )
    expect(run.segments.map((s) => s.text)).toEqual(['Ava (5)', 'Liam (8)'])
    expect(run.segments.map((s) => s.key)).toEqual(['11', '22'])
    expect(run.sharedSurname).toBe('Johnson')
  })

  it('keys a child with no CampMinder id by its position, never by a blank string', () => {
    // Two nameless, id-less children in one household would otherwise collide
    // on the same React key.
    const run = childrenRun(
      [
        { display_name: 'Ava Johnson', last_name: 'Johnson', age: 5 },
        { display_name: 'Liam Johnson', last_name: 'Johnson', age: 8 },
      ],
      fmt
    )
    expect(new Set(run.segments.map((s) => s.key)).size).toBe(2)
  })
})
