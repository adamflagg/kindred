/**
 * CampMinder joins a weekend's identity and its description with a colon.
 * Splitting is lossless; abbreviating would not be.
 */
import { describe, expect, it } from 'vitest'

import { shortWeekendName, splitWeekendName } from './weekendNames'

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
