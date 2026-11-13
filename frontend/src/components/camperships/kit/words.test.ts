import { describe, expect, it } from 'vitest'

import { FORM_SOURCE_WORDS, sentenceCase } from './words'

describe('sentenceCase', () => {
  it('capitalises the first letter and leaves the rest as sent', () => {
    expect(sentenceCase('household level')).toBe('Household level')
    expect(sentenceCase('committed · not yet in CampMinder')).toBe(
      'Committed · not yet in CampMinder'
    )
    expect(sentenceCase('Already Fine')).toBe('Already Fine')
    expect(sentenceCase('')).toBe('')
  })
})

describe('FORM_SOURCE_WORDS (adult aid form design §10)', () => {
  it('names each aid form in chip words', () => {
    expect(FORM_SOURCE_WORDS).toEqual({ google_form: 'adult aid form', campminder: 'CM form' })
  })
})
