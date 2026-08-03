/**
 * CampMinder joins a weekend's identity and its description with a colon.
 * Splitting is lossless; abbreviating would not be — which is why the slug
 * below is an ADDRESS and never a label. See the note in weekendNames.ts.
 */
import { describe, expect, it } from 'vitest'

import {
  resolveWeekendRef,
  shortWeekendName,
  splitWeekendName,
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
})

const FC1 = { session_cm_id: 1309514, name: 'Family Camp 1: Memorial Day Weekend' }
const WOMENS = { session_cm_id: 1335115, name: "Women's Weekend" }
/** Same slug as WOMENS ('ww'). Hypothetical, and the point of the guard. */
const WINTER = { session_cm_id: 1379004, name: 'Winter Weekend' }

describe('weekendRef', () => {
  it('addresses a weekend by its slug when that slug is unique', () => {
    expect(weekendRef(FC1, [FC1, WOMENS])).toBe('fc1')
  })

  it('falls back to the CampMinder id when two weekends share a slug', () => {
    // An ambiguous slug that resolved to whichever row sorted first would open
    // the wrong weekend, which is worse than an ugly URL.
    expect(weekendRef(WOMENS, [FC1, WOMENS, WINTER])).toBe('1335115')
    expect(weekendRef(WINTER, [FC1, WOMENS, WINTER])).toBe('1379004')
  })
})

describe('resolveWeekendRef', () => {
  it('finds the weekend a slug names', () => {
    expect(resolveWeekendRef([FC1, WOMENS], 'fc1')).toEqual(FC1)
  })

  it('finds one by CampMinder id, which is what an ambiguous slug falls back to', () => {
    // Not for old links — there is no back-compat obligation here. This is the
    // other half of `weekendRef`'s collision guard: what it emits, this reads.
    expect(resolveWeekendRef([FC1, WOMENS], '1335115')).toEqual(WOMENS)
  })

  it('refuses to guess when a slug is ambiguous', () => {
    expect(resolveWeekendRef([FC1, WOMENS, WINTER], 'ww')).toBeUndefined()
  })

  it('finds nothing for a reference that names no weekend', () => {
    expect(resolveWeekendRef([FC1, WOMENS], 'zz')).toBeUndefined()
    expect(resolveWeekendRef([FC1, WOMENS], undefined)).toBeUndefined()
  })
})
