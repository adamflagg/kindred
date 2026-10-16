import { describe, expect, it } from 'vitest'
import { DELTA_INK, deltaInk } from './deltaTokens'

/**
 * #3207 PR 8 (owner, 2026-10-14; rulings #16–#18 2026-10-15): one app-wide set of change colours.
 * Good is forest (the house palette, replacing Overview's emerald), bad is the kit's red, neutral is grey
 * (New Campers' blue folds into it).
 */
describe('delta tokens', () => {
  it('are forest, the kit red and grey, light and dark', () => {
    expect(DELTA_INK.good).toBe('text-forest-700 dark:text-forest-300')
    expect(DELTA_INK.bad).toBe('text-red-700 dark:text-red-400')
    expect(DELTA_INK.neutral).toBe('text-muted-foreground')
  })

  it('reads a rise as good when more is better', () => {
    expect(deltaInk(3, 'up-good')).toBe(DELTA_INK.good)
    expect(deltaInk(-3, 'up-good')).toBe(DELTA_INK.bad)
  })

  it('reads a rise as bad when more is worse (Cancelled turns red when it rises)', () => {
    expect(deltaInk(3, 'up-bad')).toBe(DELTA_INK.bad)
    expect(deltaInk(-3, 'up-bad')).toBe(DELTA_INK.good)
  })

  it('keeps a neutral figure grey either way (waitlist, decision 16)', () => {
    expect(deltaInk(3, 'neutral')).toBe(DELTA_INK.neutral)
    expect(deltaInk(-3, 'neutral')).toBe(DELTA_INK.neutral)
  })

  it('keeps no change grey', () => {
    expect(deltaInk(0, 'up-good')).toBe(DELTA_INK.neutral)
    expect(deltaInk(0, 'up-bad')).toBe(DELTA_INK.neutral)
  })
})
