/**
 * The Waitlist tab has no comparison while registration is live (PM-8 A): a past waitlist can't be
 * rebuilt for a day. After the season it compares with the compare year's final, as before.
 */
import { describe, it, expect } from 'vitest'
import { waitlistCompareView } from './waitlistCompare'

describe('waitlistCompareView', () => {
  it('drops the comparison while the season is live, and says why once, plainly', () => {
    const view = waitlistCompareView(2025, { prior_basis: 'unavailable' })
    expect(view.comparable).toBe(false)
    expect(view.line).toBe("No comparison: a past waitlist can't be rebuilt for a day.")
  })

  it("compares with the compare year's final after the season", () => {
    const view = waitlistCompareView(2025, { prior_basis: 'final' })
    expect(view.comparable).toBe(true)
    expect(view.line).toBeNull()
  })

  it('says nothing without a compare year', () => {
    expect(waitlistCompareView(null, undefined)).toEqual({ comparable: false, line: null })
  })

  it('keeps comparing while the compare year loads, so its busy cue still shows', () => {
    expect(waitlistCompareView(2025, undefined)).toEqual({ comparable: true, line: null })
  })
})
