import { describe, expect, it } from 'vitest'

import { programLabel } from './programLabel'

describe('programLabel', () => {
  it('names the rules programs the way staff say them', () => {
    expect(programLabel('summer')).toBe('Summer camp')
    expect(programLabel('family_camp')).toBe('Family Camp')
    expect(programLabel('tbm')).toBe('TBM')
    expect(programLabel('womens_weekend')).toBe("Women's Weekend")
    expect(programLabel('mens_weekend')).toBe("Men's Weekend")
  })

  it('spells out a key it has no name for, never the raw underscore form', () => {
    expect(programLabel('quest')).toBe('Quest')
    expect(programLabel('winter_retreat')).toBe('Winter retreat')
  })
})
