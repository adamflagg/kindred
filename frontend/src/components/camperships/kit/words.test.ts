import { describe, expect, it } from 'vitest'

import { sentenceCase } from './words'

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
