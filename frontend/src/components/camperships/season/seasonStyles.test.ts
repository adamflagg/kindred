import { describe, expect, it } from 'vitest'

import { TH } from '../kit/kitStyles'
import * as season from './seasonStyles'

const ALIGN = /\btext-(left|right|center)\b/g

/** Any palette colour, Tailwind's or the theme's own, rather than a semantic token (Task 3 m3). */
const RAW_PALETTE =
  /\b(bg|text|border)-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|forest|bark|berry|parchment)-\d|(?:white|black)\b)/

describe("Season's class strings", () => {
  it.each(Object.entries(season))('%s sets at most one text-align', (_name, classes) => {
    expect([...classes.matchAll(ALIGN)].length).toBeLessThanOrEqual(1)
  })

  it('carries no raw palette colour, so both themes resolve without dark: partners', () => {
    for (const classes of Object.values(season)) {
      expect(classes).not.toMatch(RAW_PALETTE)
    }
  })

  it('catches any palette colour and passes the semantic tokens', () => {
    for (const raw of [
      'bg-white',
      'text-black',
      'text-gray-500',
      'border-slate-200',
      'bg-zinc-50',
      'text-neutral-700',
      'bg-blue-600',
      'text-green-700',
      'border-red-300',
      'text-forest-200',
      'bg-parchment-50',
      'bg-white/80',
    ]) {
      expect(raw).toMatch(RAW_PALETTE)
    }
    for (const token of [
      'bg-muted',
      'bg-muted/40',
      'text-muted-foreground',
      'text-foreground',
      'border-border',
      'border-b',
      'bg-card',
      'bg-background',
      'text-primary',
      'text-xs',
      'text-left',
      'whitespace-nowrap',
    ]) {
      expect(token).not.toMatch(RAW_PALETTE)
    }
  })
})

describe('header cells alias the kit TH (spec §1.1)', () => {
  it('reads 12/15 like the grid: TH_LABEL is TH, the money ones its right-aligned twins', () => {
    expect(season.TH_LABEL).toBe(TH)
    expect(season.TH_MONEY).toBe(TH.replace('text-left', 'text-right'))
    expect(season.TH_MONEY_TEXT).toBe(
      TH.replace('text-left', 'text-right').replace('bg-muted ', '')
    )
  })
})
