/**
 * Both themes, source-level: every raw palette colour in the Camperships kit has a `dark:`
 * partner in the same class string (the auditStyles.test.ts rule). Semantic tokens resolve per
 * theme on their own, so only palette-bearing strings are checked, and each case asserts.
 */
import { describe, expect, it } from 'vitest'

import * as styles from './aidStyles'

// Ruling 2026-10-01 (plan review): two- and three-digit shades, so `amber-50` is checked too.
const PALETTE = /(?<!dark:)\b(bg|text)-(red|amber|emerald|sky|purple|stone)-\d{2,3}\b/g

function classStrings(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const [name, value] of Object.entries(styles) as Array<[string, unknown]>) {
    if (typeof value === 'string') out.push([name, value])
    else if (value !== null && typeof value === 'object')
      for (const [key, v] of Object.entries(value))
        if (typeof v === 'string') out.push([`${name}.${key}`, v])
  }
  return out
}

const PALETTE_BEARING = classStrings().filter(
  ([, classes]) => [...classes.matchAll(PALETTE)].length > 0
)

describe('Camperships kit styles in both themes', () => {
  it.each(PALETTE_BEARING)(
    '%s pairs every light palette colour with a dark one',
    (_name, classes) => {
      const matches = [...classes.matchAll(PALETTE)]
      expect(matches.length).toBeGreaterThan(0)
      for (const match of matches) {
        expect(classes, `${match[0]} has no dark:${String(match[1])}-… partner`).toMatch(
          new RegExp(`dark:${String(match[1])}-`)
        )
      }
    }
  )

  it('inks a negative in red-700, as D74 rules', () => {
    expect(styles.NEGATIVE_INK).toContain('text-red-700')
  })
})
