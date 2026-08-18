/**
 * CampMinder joins a weekend's identity and its description with a colon.
 * Splitting is lossless; abbreviating is not — which is why there are three
 * forms and not one, and why which form a surface may use is a rule rather
 * than a preference. See the note in weekendNames.ts.
 *
 * `weekendSlug` is an ADDRESS for a URL and is never rendered on its own.
 * `weekendLabel` is the narrow display licence the owner granted on
 * 2026-08-18 (kindred#2393) for the 416px family journey panel: it uppercases
 * the slug and falls back to the weekend's short name, never to a CampMinder
 * id. Everywhere with room still prints `splitWeekendName`'s output verbatim.
 */
import { describe, expect, it } from 'vitest'

import {
  resolveWeekendRef,
  shortWeekendName,
  splitWeekendName,
  weekendLabel,
  weekendRef,
  weekendSlug,
} from './weekendNames'

describe('splitWeekendName', () => {
  it('splits identity from description at the colon', () => {
    expect(splitWeekendName('Family Camp 1: Memorial Day Weekend')).toEqual({
      short: 'Family Camp 1',
      qualifier: 'Memorial Day Weekend',
    })
  })

  it('keeps a parenthetical qualifier with the description, not the identity', () => {
    expect(splitWeekendName('Family Camp 5: JFAM Weekend (w/ kids 10 and under)')).toEqual({
      short: 'Family Camp 5',
      qualifier: 'JFAM Weekend (w/ kids 10 and under)',
    })
  })

  it('passes through a name that is already short', () => {
    expect(splitWeekendName("Women's Weekend")).toEqual({
      short: "Women's Weekend",
      qualifier: '',
    })
    expect(splitWeekendName('Ready, Set, Camp')).toEqual({
      short: 'Ready, Set, Camp',
      qualifier: '',
    })
  })

  it('does not mistake a comma for a separator', () => {
    // "Ready, Set, Camp" must not become "Ready".
    expect(splitWeekendName('Ready, Set, Camp').short).toBe('Ready, Set, Camp')
  })

  it('keeps the whole name when the colon would leave nothing in front', () => {
    expect(splitWeekendName(': Memorial Day')).toEqual({
      short: ': Memorial Day',
      qualifier: '',
    })
  })

  it('trims the surrounding whitespace CampMinder sometimes carries', () => {
    expect(splitWeekendName('  Family Camp 2 :  Keshet LGBTQ Weekend ')).toEqual({
      short: 'Family Camp 2',
      qualifier: 'Keshet LGBTQ Weekend',
    })
  })
})

describe('shortWeekendName', () => {
  it('returns just the identity', () => {
    expect(shortWeekendName('Family Camp 7: Jewish Families of Color Weekend')).toBe(
      'Family Camp 7'
    )
  })
})

describe('weekendSlug', () => {
  it('abbreviates to initials and keeps a trailing number', () => {
    expect(weekendSlug('Family Camp 1: Memorial Day Weekend')).toBe('fc1')
    expect(weekendSlug('Family Camp 10')).toBe('fc10')
  })

  it('ignores the punctuation CampMinder names carry', () => {
    expect(weekendSlug("Women's Weekend")).toBe('ww')
    expect(weekendSlug('Ready, Set, Camp')).toBe('rsc')
  })

  it('drops a program token that many weekends share', () => {
    // A token on half the lineup tells you nothing about WHICH weekend, so it
    // is noise in an address. Winter Family Camp, not JFAM Winter Family Camp.
    expect(weekendSlug('JFAM Winter Family Camp')).toBe('wfc')
  })

  it('reads only the identity, never the description after the colon', () => {
    // Otherwise every JFAM weekend would slug identically.
    expect(weekendSlug('Family Camp 3: JFAM Weekend (w/ kids 10 and under)')).toBe('fc3')
    expect(weekendSlug('Family Camp 5: JFAM Weekend (w/ kids 10 and under)')).toBe('fc5')
  })

  it('gives back nothing for a name with no letters or digits to abbreviate', () => {
    expect(weekendSlug('   ')).toBe('')
  })

  it('keeps a shared token rather than slugging to bare digits', () => {
    // Dropping the token from "JFAM 10" leaves `10`, and `resolveWeekendRef`
    // reads a run of digits as a CampMinder id — so that URL would not resolve
    // back to the weekend that produced it. The token earns its place here for
    // the same reason it is dropped everywhere else: it is what makes the
    // address an address.
    expect(weekendSlug('JFAM 10')).toBe('j10')
  })

  it('gives back nothing for a name that abbreviates to digits alone', () => {
    // The numeric space belongs to CampMinder ids. A slug that cannot be told
    // apart from one is not an address, and '' is how a caller is told so.
    expect(weekendSlug('2026')).toBe('')
  })
})

const FC1 = { session_cm_id: 1000001, name: 'Family Camp 1: Memorial Day Weekend' }
const WOMENS = { session_cm_id: 1000002, name: "Women's Weekend" }
/** Same slug as WOMENS ('ww'). Hypothetical, and the point of the guard. */
const WINTER = { session_cm_id: 1000003, name: 'Winter Weekend' }
/** Slugs to bare digits once the shared token is dropped — see `weekendSlug`. */
const JFAM_10 = { session_cm_id: 1000004, name: 'JFAM 10' }
/** Nothing to abbreviate but digits, so it has no slug at all. */
const YEAR_ONLY = { session_cm_id: 1000005, name: '2026' }

describe('weekendRef', () => {
  it('addresses a weekend by its slug when that slug is unique', () => {
    expect(weekendRef(FC1, [FC1, WOMENS])).toBe('fc1')
  })

  it('falls back to the CampMinder id when two weekends share a slug', () => {
    // An ambiguous slug that resolved to whichever row sorted first would open
    // the wrong weekend, which is worse than an ugly URL.
    expect(weekendRef(WOMENS, [FC1, WOMENS, WINTER])).toBe('1000002')
    expect(weekendRef(WINTER, [FC1, WOMENS, WINTER])).toBe('1000003')
  })

  it('falls back to the CampMinder id when a name has no slug to give', () => {
    expect(weekendRef(YEAR_ONLY, [FC1, YEAR_ONLY])).toBe('1000005')
  })

  it('emits nothing a run of digits could be mistaken for', () => {
    // THE ROUND TRIP IS THE TEST: whatever `weekendRef` emits, the URL hands
    // straight back to `resolveWeekendRef`, and a slug of `10` came back as a
    // CampMinder-id lookup that matched nothing.
    for (const session of [JFAM_10, YEAR_ONLY]) {
      const ref = weekendRef(session, [FC1, JFAM_10, YEAR_ONLY])
      expect(resolveWeekendRef([FC1, JFAM_10, YEAR_ONLY], ref)).toEqual(session)
    }
  })
})

describe('resolveWeekendRef', () => {
  it('finds the weekend a slug names', () => {
    expect(resolveWeekendRef([FC1, WOMENS], 'fc1')).toEqual(FC1)
  })

  it('finds one by CampMinder id, which is what an ambiguous slug falls back to', () => {
    // Not for old links — there is no back-compat obligation here. This is the
    // other half of `weekendRef`'s collision guard: what it emits, this reads.
    expect(resolveWeekendRef([FC1, WOMENS], '1000002')).toEqual(WOMENS)
  })

  it('refuses to guess when a slug is ambiguous', () => {
    expect(resolveWeekendRef([FC1, WOMENS, WINTER], 'ww')).toBeUndefined()
  })

  it('finds nothing for a reference that names no weekend', () => {
    expect(resolveWeekendRef([FC1, WOMENS], 'zz')).toBeUndefined()
    expect(resolveWeekendRef([FC1, WOMENS], undefined)).toBeUndefined()
  })
})

describe('weekendLabel', () => {
  /**
   * The owner's 2026-08-18 ruling on kindred#2393: a weekend prints as `FC1`,
   * as PLAIN TEXT, on the journey panel's weekend line and on the members
   * modal's tabs. `w-[26rem]` has no room for "Family Camp 1: Memorial Day
   * Weekend" three times over, and the abbreviation is the one staff already
   * say out loud.
   */
  it('abbreviates a numbered family weekend to FCx', () => {
    expect(weekendLabel('Family Camp 1: Memorial Day Weekend')).toBe('FC1')
  })

  it('keeps a two-digit weekend distinct from a one-digit one', () => {
    // The same collision `weekendSlug` guards: FC10 must not read as FC1.
    expect(weekendLabel('Family Camp 10')).toBe('FC10')
    expect(weekendLabel('Family Camp 1')).toBe('FC1')
  })

  it('uppercases the two 2026 weekends that are not FCx', () => {
    // Computed against the ten 2026 family sessions: FC1-FC8 plus these two,
    // which sit outside the day-group plan. They are not special cases in the
    // code and must not become them — they are what the rule already produces.
    //
    // ⚠️ kindred#2393's ruling called these `rs` and `w`. Both are off: the
    // slug rule keeps EVERY initial of the identity, so "Ready, Set, Camp" is
    // `rsc` (the example weekendSlug's own doc block gives) and "JFAM Winter
    // Family Camp" is `wfc` once the shared JFAM token is dropped. Pinned here
    // as computed rather than as written down, because the alternative is
    // special-casing two weekends to match a note.
    expect(weekendLabel('Ready, Set, Camp')).toBe('RSC')
    expect(weekendLabel('JFAM Winter Family Camp')).toBe('WFC')
  })

  it('gives the ten 2026 family weekends ten distinct labels', () => {
    // A label that collided would put two weekends on one tab in the members
    // modal and read as one entry on the journey's weekend line.
    const labels = [
      'Ready, Set, Camp',
      'Family Camp 1: Memorial Day Weekend',
      'Family Camp 2: Keshet LGBTQ Weekend',
      'Family Camp 3: JFAM Weekend (w/ kids 10 and under)',
      'Family Camp 4: Labor Day Weekend',
      'Family Camp 5: JFAM Weekend (w/ kids 10 and under)',
      'Family Camp 6',
      'Family Camp 7: Jewish Families of Color Weekend',
      'Family Camp 8: JFAM Weekend (w/ kids 10 and under)',
      'JFAM Winter Family Camp',
    ].map(weekendLabel)

    expect(new Set(labels).size).toBe(labels.length)
  })

  it('reads the identity only, so a description cannot drag the label', () => {
    expect(weekendLabel('Family Camp 5: JFAM Weekend (w/ kids 10 and under)')).toBe('FC5')
  })

  it('falls back to the short name when there is nothing to abbreviate', () => {
    // `weekendSlug` returns '' here on purpose: the numeric space belongs to
    // CampMinder ids, so this weekend has no ADDRESS. It still has a name,
    // and the label is that name — never the id `weekendRef` falls back to,
    // which names nothing a staff member can read.
    expect(weekendSlug('2026')).toBe('')
    expect(weekendLabel('2026')).toBe('2026')
    expect(weekendLabel('2026')).not.toBe(String(YEAR_ONLY.session_cm_id))
  })

  it('never returns an empty string for a weekend that has a name', () => {
    for (const session of [FC1, WOMENS, WINTER, JFAM_10, YEAR_ONLY]) {
      expect(weekendLabel(session.name).length).toBeGreaterThan(0)
    }
  })
})
