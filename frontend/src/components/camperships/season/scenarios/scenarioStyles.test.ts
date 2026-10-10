/**
 * Both themes, source-level (the kit's aidStyles.test.ts rule): every raw palette colour in
 * Scenarios' own marks has a `dark:` partner of the same prefix and family in the same string.
 */
import { describe, expect, it } from 'vitest'

import * as styles from './scenarioStyles'

const PALETTE = /(?<!dark:)\b(bg|text|border)-(amber|forest)-\d{2,3}\b/g

const NAMES = [
  'CHANGE_MORE',
  'CHANGE_LESS',
  'BOX_CHANGED',
  'BOX_BAD',
  'SETTING_CHANGED',
  'CHECK_CHANGED',
  'UP_INK',
  'FIT_DONE',
  'FIT_WARN',
  'CARD_SHELL',
  'GROUP_HEAD',
]

const strings: Array<[string, string]> = Object.entries(styles)

describe("Scenarios' marks in both themes", () => {
  it('has palette-bearing strings to check', () => {
    expect(
      strings.filter(([, classes]) => [...classes.matchAll(PALETTE)].length > 0).length
    ).toBeGreaterThan(0)
  })

  it("is the sandbox's marks (scenarios-v4), and no more", () => {
    expect(Object.keys(styles).sort()).toEqual([...NAMES].sort())
  })

  it.each(strings)('%s gives every palette colour its dark partner', (_name, classes) => {
    for (const [, prefix, colour] of classes.matchAll(PALETTE)) {
      expect(classes).toMatch(new RegExp(`dark:${prefix ?? ''}-${colour ?? ''}-`))
    }
  })
})
