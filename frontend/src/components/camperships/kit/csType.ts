/**
 * The Camperships type scale (spec §1.1; mockups/cs-type.css, measured from slice 1). Each role is named once as
 * CS_<ROLE>. Where slice 1 has the class string, this RE-EXPORTS it, so householdStyles' promise ("imported or left
 * alone, never edited") holds; a new string exists only where slice 1 has none. csType.test.ts pins each alias to its
 * source. Season components import roles from here, never a raw `text-*` size.
 */
import {
  BUTTON_SECONDARY,
  FIELD_INLINE,
  TAB_NAV,
  TAB_PILL_ACTIVE,
  TAB_PILL_IDLE,
} from '../../admin/lodging/lodgingStyles'
import {
  HH_AMBER_NOTE,
  HH_BUTTON,
  HH_BUTTON_PRIMARY,
  HH_CARD,
  HH_DETAILS_BUTTON,
  HH_LOCK,
  HH_NOTE,
  HH_PANEL_TD,
  HH_SEG,
  HH_SEG_BUTTON,
  HH_SEG_OFF,
  HH_SEG_ON,
  HH_TABLE,
  HH_TH,
  HH_TH_NUM,
} from '../household/householdStyles'
import { AID_SEARCH_INPUT } from './AidTable'
import {
  DETAIL_LINE,
  DETAIL_ROW,
  HIGHLIGHT_EDGE,
  PILL,
  ROW_HIGHLIGHT,
  SCROLL_BOX,
  STRIP,
  STRIP_BADGE,
  STRIP_COUNT_WATCH,
  STRIP_LENS,
  STRIP_LENS_ON,
  STRIP_LENSES,
  TD,
  TFOOT_CELL,
  TH,
} from './kitStyles'

// ── Tabs, strips, filters (cs-tab, cs-tabbar, cs-strip, cs-chip, cs-flabel, cs-select, cs-search, cs-btn-tool) ──
export const CS_TAB_ACTIVE = TAB_PILL_ACTIVE
export const CS_TAB_IDLE = TAB_PILL_IDLE
export const CS_TABBAR = TAB_NAV
export const CS_STRIP = STRIP
export const CS_STRIP_LENSES = STRIP_LENSES
/** A chip in muted 500 (a kind, a chapter). */
export const CS_CHIP = STRIP_LENS.appeals
/** A chip in ink 600 ("All"). */
export const CS_CHIP_INK = STRIP_LENS.all
export const CS_CHIP_ON = STRIP_LENS_ON
export const CS_CHIP_COUNT = STRIP_COUNT_WATCH
/** cs-flabel 14/20: a filter's label ("Person", "From"). */
export const CS_FLABEL = 'text-foreground text-sm'
export const CS_SELECT = FIELD_INLINE
export const CS_SEARCH = AID_SEARCH_INPUT
export const CS_BTN_TOOL = BUTTON_SECONDARY

// ── Tables (cs-th, cs-td, cs-tfoot; cs-th-card, cs-td-card inside a card) ──
export const CS_TH = TH
export const CS_TD = TD
export const CS_TFOOT = TFOOT_CELL
export const CS_TH_CARD = HH_TH
export const CS_TH_CARD_NUM = HH_TH_NUM
export const CS_TABLE_CARD = HH_TABLE
export const CS_TD_CARD = HH_PANEL_TD
export const CS_SCROLL_BOX = SCROLL_BOX
export const CS_ROW_HIGHLIGHT = ROW_HIGHLIGHT
export const CS_HIGHLIGHT_EDGE = HIGHLIGHT_EDGE
export const CS_DETAIL_ROW = DETAIL_ROW
export const CS_DETAIL_LINE = DETAIL_LINE

// ── An opened row's panels (cs-panel, cs-pmeta, cs-phead) ──
/** The dashed amber rule between panels (RequestDetailLine's). */
export const CS_PANEL_RULE = 'border-dashed border-amber-300 dark:border-amber-800'
/** cs-pmeta 12/16 muted. */
export const CS_PMETA = 'text-muted-foreground text-xs'
/** cs-phead 11.5/17.25 700 muted, sentence case (the household receipt's head). */
export const CS_PANEL_HEAD = 'text-muted-foreground text-[11.5px] leading-[1.5] font-bold'
/** cs-panel 14/20 400 (also cs-td's size): an opened row's panels, the History box's words, the Season notice. */
export const CS_PANEL = 'text-sm'

// ── Cards and words (cs-card, cs-card-title, cs-body, cs-label, cs-muted, cs-small, cs-meta, cs-link) ──
export const CS_CARD = HH_CARD
/** cs-card-title 13.5/700: inside CS_CARD, which sets 13.5. */
export const CS_CARD_TITLE = 'font-bold'
/** cs-body 13.5/20.25, for a block outside a card. */
export const CS_BODY = 'text-[13.5px] leading-normal'
/** cs-label 13.5/600: a fold line's or a row's label. */
export const CS_LABEL = 'text-foreground text-[13.5px] leading-normal font-semibold'
/** A card's sub-head, 12.5/18.75 600 (spec §6.2 D: "Which years count", "Applications and Round 1"). */
export const CS_SUBHEAD = 'text-foreground text-[12.5px] leading-[18.75px] font-semibold'
export const CS_MUTED = HH_NOTE
/** cs-small 12/16 muted. */
export const CS_SMALL = 'text-muted-foreground text-xs'
export const CS_META = HH_LOCK
export const CS_LINK = 'text-primary font-medium hover:underline'
export const CS_AMBER_NOTE = HH_AMBER_NOTE

// ── Pills, badges, buttons, boxes (cs-pill, cs-badge, cs-btn, cs-btn2, cs-btn-sm, cs-input, cs-seg) ──
export const CS_PILL = PILL
export const CS_BADGE_AMBER = STRIP_BADGE.amber
export const CS_BTN = HH_BUTTON_PRIMARY
export const CS_BTN2 = HH_BUTTON
export const CS_BTN_SM = HH_DETAILS_BUTTON
/** cs-input 14/20: the opened editor's box. */
export const CS_INPUT =
  'border-border bg-background rounded-md border px-2 py-1 text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none'
export const CS_SEG = HH_SEG
export const CS_SEG_BUTTON = HH_SEG_BUTTON
export const CS_SEG_ON = HH_SEG_ON
export const CS_SEG_OFF = HH_SEG_OFF
