/**
 * Both themes, source-level: every raw palette colour in the Camperships kit has a `dark:`
 * partner in the same class string (the auditStyles.test.ts rule). Semantic tokens resolve per
 * theme on their own, so only palette-bearing strings are checked, and each case asserts.
 */
import { describe, expect, it } from 'vitest'

import * as aid from './aidStyles'
import * as kit from './kitStyles'

const styles = { ...aid, ...kit }

// Ruling 2026-10-01 (plan review): two- and three-digit shades, so `amber-50` is checked too.
const PALETTE = /(?<!dark:)\b(bg|text|border)-(red|amber|emerald|sky|purple|stone)-\d{2,3}\b/g

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

/** The dark partner must share the light class's prefix and colour family (an arbitrary `dark:bg-[…amber-900…]` value counts by the family it names). */
function hasDarkPartner(classes: string, prefix: string, colour: string): boolean {
  return new RegExp(`dark:${prefix}-(${colour}-|\\[[^\\]]*-${colour}-)`).test(classes)
}

describe('hasDarkPartner (the check itself)', () => {
  it('rejects a dark partner of another colour or another prefix', () => {
    expect(hasDarkPartner('text-red-700 dark:text-emerald-400', 'text', 'red')).toBe(false)
    expect(hasDarkPartner('bg-red-100 dark:text-red-300', 'bg', 'red')).toBe(false)
    expect(hasDarkPartner('border-sky-200 dark:bg-sky-900', 'border', 'sky')).toBe(false)
  })

  it('accepts the same prefix and colour', () => {
    expect(hasDarkPartner('text-red-700 dark:text-red-400', 'text', 'red')).toBe(true)
    expect(
      hasDarkPartner(
        'bg-amber-50 dark:bg-[color-mix(in_oklab,var(--color-amber-900)_30%,x)]',
        'bg',
        'amber'
      )
    ).toBe(true)
  })
})

describe('Camperships kit styles in both themes', () => {
  it('has palette-bearing strings to check (it.each would register nothing otherwise)', () => {
    expect(PALETTE_BEARING.length).toBeGreaterThan(0)
  })

  it.each(PALETTE_BEARING)(
    '%s pairs every light palette colour with a dark one',
    (_name, classes) => {
      const matches = [...classes.matchAll(PALETTE)]
      expect(matches.length).toBeGreaterThan(0)
      for (const match of matches) {
        expect(
          hasDarkPartner(classes, String(match[1]), String(match[2])),
          `${match[0]} has no dark:${String(match[1])}-${String(match[2])}-… partner`
        ).toBe(true)
      }
    }
  )

  it('inks a negative in red-700, as D74 rules', () => {
    expect(styles.NEGATIVE_INK).toContain('text-red-700')
  })
})
