import { describe, expect, it } from 'vitest'

import { EMPTY_JOURNEY_COUNTS, journeyCountLabel } from './journeyCountLabel'

describe('journeyCountLabel (owner rulings 2026-09-22)', () => {
  it('shows only the non-zero parts', () => {
    expect(journeyCountLabel({ summers: 0, familyWeekends: 0, adultWeekends: 5 })).toBe(
      '5 adult weekends'
    )
    expect(journeyCountLabel({ summers: 6, familyWeekends: 0, adultWeekends: 0 })).toBe('6 summers')
  })

  it('separates shown parts with a dot, and only shown parts', () => {
    expect(journeyCountLabel({ summers: 3, familyWeekends: 0, adultWeekends: 2 })).toBe(
      '3 summers · 2 adult weekends'
    )
    expect(journeyCountLabel({ summers: 6, familyWeekends: 1, adultWeekends: 0 })).toBe(
      '6 summers · 1 family weekend'
    )
    expect(journeyCountLabel({ summers: 1, familyWeekends: 2, adultWeekends: 1 })).toBe(
      '1 summer · 2 family weekends · 1 adult weekend'
    )
  })

  it('is empty when everything is zero — the caller renders no line', () => {
    expect(journeyCountLabel(EMPTY_JOURNEY_COUNTS)).toBe('')
  })

  it('never says "at camp"', () => {
    expect(journeyCountLabel({ summers: 5, familyWeekends: 0, adultWeekends: 0 })).not.toContain(
      'at camp'
    )
  })
})
