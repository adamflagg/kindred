import { describe, expect, it } from 'vitest'

import * as season from './seasonStyles'

const ALIGN = /\btext-(left|right|center)\b/g

describe("Season's class strings", () => {
  it.each(Object.entries(season))('%s sets at most one text-align', (_name, classes) => {
    expect([...classes.matchAll(ALIGN)].length).toBeLessThanOrEqual(1)
  })

  it('carries no raw palette colour, so both themes resolve without dark: partners', () => {
    for (const classes of Object.values(season)) {
      expect(classes).not.toMatch(/\b(bg|text|border)-(red|amber|emerald|sky|purple|stone)-\d/)
    }
  })
})
