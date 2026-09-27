/**
 * Both themes, source-level (spec §7): every raw palette colour on the Audit Log
 * has a `dark:` partner in the same class string. Semantic tokens (bg-card,
 * text-muted-foreground, bg-primary...) resolve per theme on their own.
 *
 * Controller ruling (2026-09-26): a test case must assert something. Most
 * exported class strings carry no raw palette colour at all (they're pure
 * semantic tokens), so `it.each` runs only over the ones that do — every case
 * below finds at least one match and asserts on it.
 */
import { describe, expect, it } from 'vitest'

import * as styles from './auditStyles'

const PALETTE = /(?<!dark:)\b(bg|text)-(purple|emerald|amber|sky|red)-\d{3}\b/g

function classStrings(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const [name, value] of Object.entries(styles)) {
    if (typeof value === 'string') out.push([name, value])
    else
      for (const [key, v] of Object.entries(value as Record<string, string>))
        out.push([`${name}.${key}`, v])
  }
  return out
}

function paletteMatches(classes: string) {
  return [...classes.matchAll(PALETTE)]
}

// Filtered so every it.each case has at least one match to assert on.
const PALETTE_BEARING = classStrings().filter(([, classes]) => paletteMatches(classes).length > 0)

describe('Audit Log styles in both themes', () => {
  it.each(PALETTE_BEARING)(
    '%s pairs every light palette colour with a dark one',
    (_name, classes) => {
      const matches = paletteMatches(classes)
      expect(matches.length).toBeGreaterThan(0)
      for (const match of matches) {
        const prop = match[1]
        expect(classes, `${match[0]} has no dark:${prop}-… partner`).toMatch(
          new RegExp(`dark:${prop}-`)
        )
      }
    }
  )

  it('gives each entry type its own pill colour', () => {
    const pills = Object.values(styles.TYPE_PILL)
    expect(new Set(pills).size).toBe(pills.length)
  })
})
