/**
 * The type scale (spec §1.1): each role aliases its slice 1 constant, so the two cannot drift; the few new
 * strings are pinned to cs-type.css's measured values. Every raw palette colour has its dark: partner.
 */
import { describe, expect, it } from 'vitest'

import {
  BUTTON_SECONDARY,
  FIELD_INLINE,
  TAB_NAV,
  TAB_PILL_ACTIVE,
  TAB_PILL_IDLE,
} from '../../admin/lodging/lodgingStyles'
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
    ['CS_SELECT', FIELD_INLINE],
    ['CS_SEARCH', AID_SEARCH_INPUT],
    ['CS_BTN_TOOL', BUTTON_SECONDARY],
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
    ['CS_BTN', household.HH_BUTTON_PRIMARY],
    ['CS_BTN2', household.HH_BUTTON],
    ['CS_BTN_SM', household.HH_DETAILS_BUTTON],
    ['CS_SEG', household.HH_SEG],
    ['CS_SEG_BUTTON', household.HH_SEG_BUTTON],
    ['CS_SEG_ON', household.HH_SEG_ON],
    ['CS_SEG_OFF', household.HH_SEG_OFF],
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
    expect(cs.CS_FLABEL).toBe('text-foreground text-sm')
    expect(cs.CS_PMETA).toBe('text-muted-foreground text-xs')
    expect(cs.CS_SMALL).toBe('text-muted-foreground text-xs')
    expect(cs.CS_PANEL_HEAD).toBe('text-muted-foreground text-[11.5px] leading-[1.5] font-bold')
    expect(cs.CS_LABEL).toBe('text-foreground text-[13.5px] leading-normal font-semibold')
    expect(cs.CS_BODY).toBe('text-[13.5px] leading-normal')
    expect(cs.CS_PANEL).toBe('text-sm')
    expect(cs.CS_SUBHEAD).toBe('text-foreground text-[12.5px] leading-[18.75px] font-semibold')
    expect(cs.CS_CARD_TITLE).toBe('font-bold')
    expect(cs.CS_LINK).toBe('text-primary font-medium hover:underline')
    expect(cs.CS_PANEL_RULE).toBe('border-dashed border-amber-300 dark:border-amber-800')
    expect(cs.CS_INPUT).toBe(
      'border-border bg-background rounded-md border px-2 py-1 text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none'
    )
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
