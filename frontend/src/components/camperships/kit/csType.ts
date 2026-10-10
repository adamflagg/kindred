/**
 * The Camperships type scale (spec §1.1; mockups/cs-type.css, measured from slice 1). Each role is named once as
 * CS_<ROLE>. Where slice 1 has the class string, this RE-EXPORTS it, so householdStyles' promise ("imported or left
 * alone, never edited") holds; a new string exists only where slice 1 has none. csType.test.ts pins each alias to its
 * source. Season components import roles from here, never a raw `text-*` size.
 */
import { TAB_NAV, TAB_PILL_ACTIVE, TAB_PILL_IDLE } from '../../admin/lodging/lodgingStyles'
import {
  HH_AMBER_NOTE,
  HH_CARD,
  HH_DETAILS_BUTTON,
  HH_LOCK,
  HH_NOTE,
  HH_PANEL_TD,
  HH_TABLE,
  HH_TH,
  HH_TH_NUM,
} from '../household/householdStyles'
import {
  AID_SEARCH_INPUT,
  CS_BAND,
  CS_BAND_EDGE,
  CS_BAND_WARN,
  CS_OK_BG,
  CS_OK_INK,
  CS_RULE,
  CS_RULE_GROUP,
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
/**
 * A label inside a card's form (Scenarios' Sandbox cards): 14px foreground, as CS_FLABEL was before the kit. §1 moved
 * only TOOLBAR controls and their labels to 12.5px muted; a card form is neither a toolbar nor a §24 editor grid.
 */
export const CS_CLABEL = 'text-foreground text-sm'
/** A filter's label in the toolbar (kit .cf-lab, design-language §1): 12.5/18, muted, one line. */
export const CS_FLABEL = 'text-muted-foreground text-[12.5px] leading-[18px] whitespace-nowrap'
export const CS_SEARCH = AID_SEARCH_INPUT

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
/**
 * cs-card-title on a real h3/h2: fonts.css and index.css style bare headings OUTSIDE any cascade layer, so they
 * beat Tailwind's layered utilities (Fraunces, 30px). The important modifiers win until the app-wide fix (#2954).
 */
export const CS_CARD_HEADING = `${CS_CARD_TITLE} !font-sans !text-[13.5px] !leading-normal !tracking-[inherit]`
/** cs-body 13.5/20.25, for a block outside a card. */
export const CS_BODY = 'text-[13.5px] leading-normal'
/** The mock's `.cf-empty`: a dashed card in muted body type, standing where a table or grid would. */
export const CS_EMPTY = `bg-card border-border text-muted-foreground rounded-xl border border-dashed px-4 py-3.5 ${CS_BODY}`
/** cs-label 13.5/600: a fold line's or a row's label. */
export const CS_LABEL = 'text-foreground text-[13.5px] leading-normal font-semibold'
/** A card's sub-head, 12.5/18.75 600 (spec §6.2 D: "Which years count", "Applications and Round 1"). */
export const CS_SUBHEAD = 'text-foreground text-[12.5px] leading-[18.75px] font-semibold'
export const CS_MUTED = HH_NOTE
/** cs-small 12/16 muted. */
export const CS_SMALL = 'text-muted-foreground text-xs'
export const CS_META = HH_LOCK
const LINK_INK = 'text-primary font-medium hover:underline'
/**
 * A link carries a size (design-language §19, owner item 13: an unsized link inherited 16px and wrapped
 * the Rules bar). CS_LINK is the body size, 13.5px; CS_LINK_SM sits in a 12px line; CS_LINK_CELL in a
 * 14px grid cell. Never compose a link with a second text size.
 */
export const CS_LINK = `${LINK_INK} text-[13.5px]`
export const CS_LINK_SM = `${LINK_INK} text-xs`
export const CS_LINK_CELL = `${LINK_INK} text-sm`
export const CS_AMBER_NOTE = HH_AMBER_NOTE

// ── Pills, badges ──
export const CS_PILL = PILL
export const CS_BADGE_AMBER = STRIP_BADGE.amber
export const CS_BTN_SM = HH_DETAILS_BUTTON

// ═══ The final design language (2026-10-09; final-v2/kit.html + cs-final.css, owner-approved) ═══
// Every toolbar control is ONE height, 26px, at 12.5/18 on card white ("white" = --card in both
// themes); an editor's field is 30px at 13.5px (design-language §1–3).

/** One control height (kit --cf-ctl-h). */
export const CS_CTL_H = 'h-[26px]'
const CTL_FACE =
  'bg-card border-border text-foreground box-border rounded-lg border text-[12.5px] leading-[18px] shadow-[0_1px_2px_hsl(var(--shadow-color)/0.07)]'
const CTL_FOCUS =
  'hover:border-[color-mix(in_oklab,var(--color-primary)_50%,var(--color-border))] focus-visible:border-[color-mix(in_oklab,var(--color-primary)_50%,var(--color-border))] focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none'
const FIELD_FACE =
  'bg-card border-border text-foreground box-border h-[30px] rounded-lg border text-[13.5px] shadow-[0_1px_2px_hsl(var(--shadow-color)/0.07)]'

// ── The white stylized picker (§3; .cf-picker, .cf-pop): AidPicker dresses a Headless UI Listbox in these ──
export const CS_PICKER = `${CS_CTL_H} ${CTL_FACE} ${CTL_FOCUS} inline-flex max-w-[220px] cursor-pointer items-center gap-1.5 pr-2 pl-2.5 font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-45`
/** The same picker inside an editor: 30px at 13.5px, no width cap. */
export const CS_PICKER_FIELD = `${FIELD_FACE} ${CTL_FOCUS} inline-flex cursor-pointer items-center gap-1.5 pr-2 pl-2.5 font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-45`
/** The popover: a white card list with the existing 200ms fade-and-drop (needs the Listbox `transition` prop). */
export const CS_PICKER_OPTIONS =
  'bg-card text-foreground border-border absolute top-[calc(100%+4px)] left-0 z-[70] max-h-[260px] w-max max-w-[320px] min-w-full overflow-auto rounded-[10px] border p-1 shadow-lg transition duration-200 ease-out focus:outline-none data-[closed]:-translate-y-1 data-[closed]:opacity-0'
export const CS_PICKER_OPTION =
  'relative flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2.5 pl-[22px] text-[12.5px] leading-[18px] whitespace-nowrap data-[focus]:bg-muted data-[selected]:font-semibold'
/** A group heading inside the popover (programs under their pool). */
export const CS_PICKER_GROUP =
  'text-muted-foreground px-2.5 pt-1.5 pb-0.5 text-[11px] font-bold tracking-[.05em] uppercase'
/** A date is the product's <input type="date"> in the kit's dress (rev1: no preset date lists). */
export const CS_DATE = `${CS_CTL_H} ${CTL_FACE} ${CTL_FOCUS} pr-1.5 pl-2 tabular-nums [color-scheme:light] dark:[color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-45`
export const CS_DATE_FIELD = `${FIELD_FACE} ${CTL_FOCUS} pr-1.5 pl-2 tabular-nums [color-scheme:light] dark:[color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-45`
/** An editor's text or number field (.cf-field): 30px at 13.5px on card white. */
export const CS_FIELD = `${FIELD_FACE} ${CTL_FOCUS} px-2`
/**
 * @deprecated A native select. Every select becomes AidPicker (§3); until each screen PR moves its
 * selects, this dresses the native ones in the picker's face so no select stays page-cream.
 */
export const CS_SELECT = `${CS_CTL_H} ${CTL_FACE} ${CTL_FOCUS} px-2`
/** @deprecated Scenarios' control-line select; the same 26px white control now. */
export const CS_SELECT_CTL = CS_SELECT
/** @deprecated The editor's box; it is the 30px editor field now (CS_FIELD). */
export const CS_INPUT = CS_FIELD

// ── Buttons (§4; .cf-btn, .cf-btn2, .cf-csv): 26px, 12.5/600, radius 8, Title Case words ──
const BTN_SHAPE = `${CS_CTL_H} box-border inline-flex flex-none cursor-pointer items-center gap-[5px] rounded-lg border px-2.5 text-[12.5px] leading-[18px] font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-45`
/** The primary action (Record a Commitment…, Save Funder). */
export const CS_BTN = `${BTN_SHAPE} bg-forest-700 border-forest-700 text-white hover:bg-forest-800 hover:border-forest-800 dark:bg-forest-500 dark:border-forest-500 dark:hover:bg-forest-600 dark:hover:border-forest-600`
/** The secondary action (Close, Back, Clear). */
export const CS_BTN2 = `${BTN_SHAPE} bg-card border-border text-foreground shadow-[0_1px_2px_hsl(var(--shadow-color)/0.07)] hover:border-[color-mix(in_oklab,var(--color-primary)_45%,var(--color-border))]`
/** Download CSV and Copy: the secondary button, the same on every page, always last on its row. */
export const CS_BTN_CSV = CS_BTN2
/** @deprecated The 38px tool button; Download CSV is the small one now. */
export const CS_BTN_TOOL = CS_BTN_CSV

// ── The one-row toolbar (§5; .cf-bar, .cf-status) ──
export const CS_TOOLBAR =
  'flex min-h-[30px] flex-nowrap items-center gap-2.5 text-[12.5px] leading-[18px]'
export const CS_TOOLBAR_LEFT = 'flex min-w-0 flex-nowrap items-center gap-2.5'
/** The right group may shrink only through its status slot; its controls are flex-none. */
export const CS_TOOLBAR_RIGHT = 'ml-auto flex min-w-0 flex-nowrap items-center gap-2'
/** The lead: a count line that used to sit above the table. */
export const CS_TOOLBAR_LEAD = 'font-semibold whitespace-nowrap'
/** The status slot: the result of the last action; it truncates, with the full words in its title. */
export const CS_TOOLBAR_STATUS =
  'text-muted-foreground min-w-0 max-w-[340px] truncate text-[12.5px] leading-[18px]'
/** A filter from a link, as a removable chip (.cf-fchip): one line, the old sentence in its title. */
export const CS_FCHIP =
  'border-[color-mix(in_oklab,var(--color-primary)_35%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-forest-200)_30%,var(--color-card))] text-foreground box-border inline-flex h-[22px] flex-none cursor-help items-center gap-1 rounded-full border pr-1 pl-[9px] text-xs font-semibold whitespace-nowrap dark:bg-[color-mix(in_oklab,var(--color-forest-900)_60%,var(--color-card))]'
export const CS_FCHIP_WARN =
  'box-border inline-flex h-[22px] flex-none cursor-help items-center gap-1 rounded-full border border-amber-300 bg-amber-50 pr-1 pl-[9px] text-xs font-semibold whitespace-nowrap text-amber-800 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-200'

// ── The segmented switcher (§18; .cf-seg): every single-choice view filter, counts inside ──
export const CS_SEG_WELL =
  'border-border box-border inline-flex h-[26px] flex-none gap-0.5 rounded-[9px] border bg-[color-mix(in_oklab,var(--color-muted)_55%,transparent)] p-0.5 dark:bg-[color-mix(in_oklab,var(--color-muted)_35%,transparent)]'
export const CS_SEG_BUTTON =
  'inline-flex h-5 cursor-pointer items-center rounded-md px-2.5 text-xs leading-4 font-medium whitespace-nowrap'
export const CS_SEG_ON = 'bg-primary text-primary-foreground'
export const CS_SEG_OFF = 'text-muted-foreground hover:text-foreground bg-transparent'
/** A choice's count, inside its segment, 3px off its label (a flex button drops the space; mock `.ct`). */
export const CS_SEG_COUNT = 'ml-[3px] tabular-nums opacity-75'
/** The well under its older name (the Rules lead switch, Scenarios' panel switch). */
export const CS_SEG = CS_SEG_WELL

// ── Grid colour roles (§8–9; --cf-rule, --cf-band, --cf-ok-bg), defined beside the table in kitStyles ──
export { CS_BAND, CS_BAND_EDGE, CS_BAND_WARN, CS_OK_BG, CS_OK_INK, CS_RULE, CS_RULE_GROUP }

// ── Footnotes (§12; .cf-sup, .cf-notes) ──
/** The footnote mark: 0.72em, raised, 500, muted (about 8.6px in a 12px header, 10px in a 14px cell). */
export const CS_SUP =
  'text-muted-foreground static ml-px align-super text-[0.72em] leading-none font-medium tabular-nums'
/** The notes list: 11.5/16 muted. */
export const CS_NOTES = 'text-muted-foreground text-[11.5px] leading-4'

// ── Truncation (§13; .cf-cut) ──
export const CS_CUT = 'inline-block max-w-full truncate align-bottom'

// ── Scroll boxes (§23; .cf-card.is-bounded): a bounded card in the page flow, never sticky to the window ──
export const CS_BOUNDED =
  'bg-card border-border shadow-lodge-sm max-h-[420px] overflow-auto rounded-xl border'

// ── Editors (§24; .cf-ed, .cf-form2, .cf-fgrid, .cf-edrow): wide and short ──
export const CS_EDITOR =
  'bg-card border-border flex flex-col gap-1.5 self-stretch rounded-[10px] border px-2.5 py-2'
/** Fields left, dependent choices right (3 : 2), a dashed rule between. */
export const CS_FORM2 = 'grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start'
export const CS_FORM2_SIDE = 'border-border border-l border-dashed pl-4'
/** label · field · label · field. */
export const CS_FGRID =
  'grid grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5'
export const CS_FGRID_TWO =
  'grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5'
export const CS_FGRID_LABEL = 'text-muted-foreground text-[12.5px] whitespace-nowrap'
/** The buttons on one row, with the required-field reason or logged-with-who line beside them. */
export const CS_EDROW = 'flex min-w-0 flex-nowrap items-center gap-2'
