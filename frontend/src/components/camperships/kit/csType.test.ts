/**
 * The type scale (spec §1.1): each role aliases its slice 1 constant, so the two cannot drift; the few new
 * strings are pinned to cs-type.css's measured values. Every raw palette colour has its dark: partner.
 */
import { describe, expect, it } from 'vitest'

import { TAB_NAV, TAB_PILL_ACTIVE, TAB_PILL_IDLE } from '../../admin/lodging/lodgingStyles'
import * as household from '../household/householdStyles'
import { AID_SEARCH_INPUT } from './AidTable'
import * as cs from './csType'
import * as kit from './kitStyles'

describe('csType aliases slice 1 (spec §1.1)', () => {
  it.each([
    ['CS_TAB_ACTIVE', TAB_PILL_ACTIVE],
    ['CS_TAB_IDLE', TAB_PILL_IDLE],
    ['CS_TABBAR', TAB_NAV],
    ['CS_STRIP', kit.STRIP],
    ['CS_STRIP_LENSES', kit.STRIP_LENSES],
    ['CS_CHIP', kit.STRIP_LENS.appeals],
    ['CS_CHIP_INK', kit.STRIP_LENS.all],
    ['CS_CHIP_ON', kit.STRIP_LENS_ON],
    ['CS_CHIP_COUNT', kit.STRIP_COUNT_WATCH],
    ['CS_SEARCH', AID_SEARCH_INPUT],
    ['CS_TH', kit.TH],
    ['CS_TD', kit.TD],
    ['CS_TFOOT', kit.TFOOT_CELL],
    ['CS_TH_CARD', household.HH_TH],
    ['CS_TH_CARD_NUM', household.HH_TH_NUM],
    ['CS_TABLE_CARD', household.HH_TABLE],
    ['CS_TD_CARD', household.HH_PANEL_TD],
    ['CS_CARD', household.HH_CARD],
    ['CS_MUTED', household.HH_NOTE],
    ['CS_META', household.HH_LOCK],
    ['CS_BTN_SM', household.HH_DETAILS_BUTTON],
    ['CS_AMBER_NOTE', household.HH_AMBER_NOTE],
    ['CS_BADGE_AMBER', kit.STRIP_BADGE.amber],
    ['CS_SCROLL_BOX', kit.SCROLL_BOX],
    ['CS_DETAIL_ROW', kit.DETAIL_ROW],
    ['CS_DETAIL_LINE', kit.DETAIL_LINE],
    ['CS_ROW_HIGHLIGHT', kit.ROW_HIGHLIGHT],
    ['CS_HIGHLIGHT_EDGE', kit.HIGHLIGHT_EDGE],
  ])('%s is the slice 1 string', (name, source) => {
    expect((cs as unknown as Record<string, string>)[name]).toBe(source)
  })

  it('CS_PILL is the kit PILL record', () => {
    expect(cs.CS_PILL).toBe(kit.PILL)
  })

  it('pins the strings slice 1 has none for to cs-type.css', () => {
    expect(cs.CS_PMETA).toBe('text-muted-foreground text-xs')
    expect(cs.CS_SMALL).toBe('text-muted-foreground text-xs')
    expect(cs.CS_PANEL_HEAD).toBe('text-muted-foreground text-[11.5px] leading-[1.5] font-bold')
    expect(cs.CS_LABEL).toBe('text-foreground text-[13.5px] leading-normal font-semibold')
    expect(cs.CS_BODY).toBe('text-[13.5px] leading-normal')
    expect(cs.CS_PANEL).toBe('text-sm')
    expect(cs.CS_SUBHEAD).toBe('text-foreground text-[12.5px] leading-[18.75px] font-semibold')
    expect(cs.CS_CARD_TITLE).toBe('font-bold')
    expect(cs.CS_PANEL_RULE).toBe('border-dashed border-amber-300 dark:border-amber-800')
  })

  it('pairs every raw palette colour with its dark: partner', () => {
    const palette = /(?<!dark:)\b(bg|text|border)-(red|amber|emerald|sky|purple|stone)-\d{2,3}\b/g
    for (const value of Object.values(cs)) {
      if (typeof value !== 'string') continue
      for (const [, prefix, colour] of value.matchAll(palette)) {
        expect(value).toMatch(
          new RegExp(`dark:${prefix ?? ''}-(${colour ?? ''}-|\\[[^\\]]*-${colour ?? ''}-)`)
        )
      }
    }
  })
})

/**
 * The final design language (2026-10-09, owner-approved kit final-v2/kit.html + cs-final.css). The
 * strings above that slice 1 owned and the kit now overrides (CS_SELECT, CS_INPUT, CS_BTN_TOOL,
 * CS_BTN/CS_BTN2, CS_SEG*, CS_FLABEL, CS_LINK) are pinned here instead, by what the kit requires.
 */
describe('csType carries the final design language (design-language.md)', () => {
  const classes = (value: string) => value.split(/\s+/)

  it.each([
    'CS_PICKER',
    'CS_SELECT',
    'CS_SEARCH',
    'CS_BTN',
    'CS_BTN2',
    'CS_BTN_CSV',
    'CS_DATE',
    'CS_SEG_WELL',
  ])('§2: %s is one 26px control', (name) => {
    expect(classes((cs as unknown as Record<string, string>)[name] ?? '')).toContain('h-[26px]')
  })

  it.each(['CS_PICKER', 'CS_SELECT', 'CS_SEARCH', 'CS_BTN2', 'CS_BTN_CSV', 'CS_DATE'])(
    '§3: %s is card white at 12.5px',
    (name) => {
      const value = classes((cs as unknown as Record<string, string>)[name] ?? '')
      expect(value).toContain('bg-card')
      expect(value).toContain('text-[12.5px]')
      expect(value).not.toContain('bg-background')
    }
  )

  it.each(['CS_PICKER_FIELD', 'CS_INPUT', 'CS_FIELD', 'CS_DATE_FIELD'])(
    '§2: %s is the 30px, 13.5px editor field on card white',
    (name) => {
      const value = classes((cs as unknown as Record<string, string>)[name] ?? '')
      expect(value).toContain('h-[30px]')
      expect(value).toContain('text-[13.5px]')
      expect(value).toContain('bg-card')
    }
  )

  it('keeps the retired names as aliases until the screens move off them', () => {
    expect(cs.CS_SELECT_CTL).toBe(cs.CS_SELECT)
    expect(cs.CS_BTN_TOOL).toBe(cs.CS_BTN_CSV)
    expect(cs.CS_INPUT).toBe(cs.CS_FIELD)
  })

  it('§1: a filter label is 12.5px muted', () => {
    expect(classes(cs.CS_FLABEL)).toEqual(
      expect.arrayContaining(['text-muted-foreground', 'text-[12.5px]'])
    )
  })

  it('§9: one green band (forest-200 at 24% over the card; forest-900 at 55% in the dark)', () => {
    expect(cs.CS_BAND).toContain('var(--color-forest-200)_24%')
    expect(cs.CS_BAND).toContain('dark:bg-[color-mix(in_oklab,var(--color-forest-900)_55%')
    expect(cs.CS_BAND_WARN).toContain('var(--color-amber-100)_55%')
    expect(cs.CS_BAND_EDGE).toContain('border-t')
    expect(cs.CS_OK_BG).toContain('var(--color-forest-200)_55%')
    expect(cs.CS_OK_INK).toContain('text-forest-800')
  })

  it('§9: no emerald or yellow band survives in the kit', () => {
    const everything = [
      ...(Object.values(cs) as unknown[]).filter((v): v is string => typeof v === 'string'),
      kit.TD,
      kit.TH,
      kit.TFOOT_CELL,
      kit.TFOOT_CELL_WRAP,
      kit.GROUP_ROW,
      ...Object.values(kit.PILL),
    ].join(' ')
    expect(everything).not.toMatch(/\b(bg|text)-(emerald|yellow)-\d/)
  })

  it('§9–10: section rows and every total row sit in the band', () => {
    expect(kit.GROUP_ROW).toContain(cs.CS_BAND)
    expect(kit.TFOOT_CELL).toContain(cs.CS_BAND)
    expect(kit.TFOOT_CELL_WRAP).toContain(cs.CS_BAND)
    expect(kit.TFOOT_CELL).toContain('font-bold')
  })

  it('§2, §8: cells are padded 5px 8px with a light rule on every column but the first', () => {
    expect(classes(kit.TD)).toEqual(
      expect.arrayContaining(['px-2', 'py-[5px]', 'first:border-l-0'])
    )
    expect(kit.TD).toContain(cs.CS_RULE)
    expect(kit.TH).toContain(cs.CS_RULE)
    expect(cs.CS_RULE).toContain('var(--color-border)_75%')
    expect(cs.CS_RULE_GROUP).toContain('border-l')
  })

  // Scan #3109: the primary button keeps the hover the household button it replaced had.
  it('§4: the primary button darkens on hover', () => {
    expect(classes(cs.CS_BTN)).toEqual(
      expect.arrayContaining(['hover:bg-forest-800', 'dark:hover:bg-forest-600'])
    )
  })

  it('§19: every link carries a size', () => {
    expect(classes(cs.CS_LINK)).toContain('text-[13.5px]')
    expect(classes(cs.CS_LINK_SM)).toContain('text-xs')
    expect(classes(cs.CS_LINK_CELL)).toContain('text-sm')
  })

  it('§12: the footnote mark is 0.72em and the notes 11.5px', () => {
    expect(classes(cs.CS_SUP)).toEqual(
      expect.arrayContaining(['text-[0.72em]', 'leading-none', 'align-super'])
    )
    expect(classes(cs.CS_NOTES)).toContain('text-[11.5px]')
  })

  it('§13: a cut cell truncates', () => {
    expect(classes(cs.CS_CUT)).toEqual(expect.arrayContaining(['truncate', 'max-w-full']))
  })

  it('§23: a scroll box is a bounded card in the page flow, never holding the wheel', () => {
    expect(classes(cs.CS_BOUNDED)).toEqual(
      expect.arrayContaining(['max-h-[420px]', 'overflow-auto'])
    )
    expect(cs.CS_BOUNDED).not.toContain('overscroll-contain')
    expect(kit.SCROLL_BOX).not.toContain('overscroll-contain')
  })

  it('§5: the toolbar is one row that never wraps', () => {
    expect(classes(cs.CS_TOOLBAR)).toEqual(expect.arrayContaining(['flex', 'flex-nowrap']))
  })

  it('§18: the segmented well fills the picked choice with primary', () => {
    expect(classes(cs.CS_SEG_ON)).toContain('bg-primary')
    expect(classes(cs.CS_SEG_OFF)).not.toContain('bg-primary')
  })

  it('§24: the editor lays two columns, and its field grid label · field · label · field', () => {
    expect(classes(cs.CS_FORM2)).toEqual(
      expect.arrayContaining(['grid', 'grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'])
    )
    expect(classes(cs.CS_FGRID)).toContain(
      'grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)]'
    )
  })
})
