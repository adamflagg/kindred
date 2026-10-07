/**
 * Compare prints alone (§S5 H; V F4): the app's own chrome (the nav, the Season bar, the cache line, the version
 * badge) stays off the paper while a compare is on screen, and only then, so every other page prints as it did.
 * Source-level: jsdom has no print media and no :has(), so the rule and its two ends are pinned by their literals.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = (path: string) => readFileSync(resolve(__dirname, '../../../../', path), 'utf-8')

describe('Compare prints alone (V F4)', () => {
  it('hides the app chrome in print only while a compare marks the page', () => {
    expect(src('index.css').replace(/\s+/g, ' ')).toContain(
      '@media print { body:has([data-print-alone]) [data-app-chrome] { display: none !important; } }'
    )
  })

  it('marks the nav, the Season bar, the cache line and the version badge as app chrome', () => {
    expect(src('layouts/AppLayout.tsx').match(/data-app-chrome/g)).toHaveLength(4)
  })

  it('marks the compare as the page that prints alone', () => {
    expect(src('components/camperships/season/scenarios/CompareTable.tsx')).toContain(
      'data-print-alone'
    )
  })
})
