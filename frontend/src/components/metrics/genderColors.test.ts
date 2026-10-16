import { describe, expect, it } from 'vitest'

import {
  GENDER_DISPLAY_COLORS,
  genderGroupRow,
  genderGroupSegments,
  getGenderColor,
} from './genderColors'

describe('metrics gender colours read the kit tokens (#2898, #77 a)', () => {
  it('keys the donut colour map by the displayed name', () => {
    expect(GENDER_DISPLAY_COLORS['Girl/woman']).toBe('#d9266b')
    expect(GENDER_DISPLAY_COLORS['Self-described']).toBe('#7a9a1e')
    expect(GENDER_DISPLAY_COLORS['Not given']).toBe('var(--gender-not-given)')
    expect(getGenderColor('Non-binary')).toBe('#b8860f')
  })

  it('turns a by_gender count into the five group columns', () => {
    expect(genderGroupRow({ 'Girl/woman': 3, Agender: 1, 'not given': 2 })).toEqual({
      'Girl/woman': 3,
      'Another identity': 1,
      'No answer': 2,
    })
  })

  it('draws a segment per group any row has, in the fixed order, Another identity hatched', () => {
    const segments = genderGroupSegments([
      { 'No answer': 1, 'Girl/woman': 2 },
      { 'Another identity': 1, 'Boy/man': 4 },
    ])
    expect(segments.map((s) => s.key)).toEqual([
      'Girl/woman',
      'Boy/man',
      'Another identity',
      'No answer',
    ])
    expect(segments.find((s) => s.key === 'Another identity')?.hatch).toBe(true)
    expect(segments.find((s) => s.key === 'Girl/woman')?.hatch).toBeUndefined()
  })
})
