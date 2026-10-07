/**
 * Both themes, source-level (the kit's aidStyles.test.ts rule): every raw palette colour in
 * Scenarios' own marks has a `dark:` partner of the same prefix and family in the same string.
 */
import { describe, expect, it } from 'vitest'

import * as styles from './scenarioStyles'

const PALETTE = /(?<!dark:)\b(bg|text|border)-(amber|forest)-\d{2,3}\b/g

const NAMES = [
  'KEPT_CHIP',
  'DRAFT_CHIP',
  'PLAIN_CHIP',
  'CHANGE_MORE',
  'CHANGE_LESS',
  'BOX_CHANGED',
  'BOX_BAD',
  'WAS_INK',
  'SETTING_CHANGED',
  'CHECK_CHANGED',
  'UP_INK',
  'LOCKED_CARD',
  'POOL_CELL',
  'FIT_BOX',
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

  it('gives a chip no raw text size: it takes the size of the role it sits in', () => {
    for (const name of ['KEPT_CHIP', 'DRAFT_CHIP', 'PLAIN_CHIP']) {
      expect(styles[name as keyof typeof styles]).not.toMatch(/(?<!dark:)\btext-(xs|sm|base|\[)/)
    }
  })

  it.each(strings)('%s gives every palette colour its dark partner', (_name, classes) => {
    for (const [, prefix, colour] of classes.matchAll(PALETTE)) {
      expect(classes).toMatch(new RegExp(`dark:${prefix ?? ''}-${colour ?? ''}-`))
    }
  })
})
