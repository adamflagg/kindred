/**
 * The finance kit's own class strings (pills, chips, table, receipt), kept apart from aidStyles.ts
 * so the shell's eager path (AppLayout -> RemainingLine -> MoneyText) pulls in only NEGATIVE_INK
 * and none of this. Same rules as aidStyles.ts: every raw palette colour has its `dark:` partner
 * (aidStyles.test.ts holds that line for both modules); `text-xs` is the floor.
 */

// ── Pills (§4.5; D19, D59) ────────────────────────────────────────────────────

// ── Grid colour roles (design-language §8–9; cs-final.css --cf-rule, --cf-band, --cf-ok-bg) ──────
// Defined here, beside the table that wears them; csType re-exports them. This module imports
// nothing from csType (csType imports it).

/** THE green (§9): section rows and every total row. Emerald and yellow bands are retired. */
export const CS_BAND =
  'bg-[color-mix(in_oklab,var(--color-forest-200)_24%,var(--color-card))] dark:bg-[color-mix(in_oklab,var(--color-forest-900)_55%,var(--color-card))]'
/** The band's top rule. */
export const CS_BAND_EDGE =
  'border-t border-t-[color-mix(in_oklab,var(--color-forest-700)_28%,var(--color-border))] dark:border-t-[color-mix(in_oklab,var(--color-forest-600)_45%,var(--color-border))]'
/** A section that needs staff ("No funder yet"). */
export const CS_BAND_WARN =
  'bg-[color-mix(in_oklab,var(--color-amber-100)_55%,var(--color-card))] dark:bg-[color-mix(in_oklab,var(--color-amber-900)_35%,var(--color-card))]'
/** The positive pill and the done note (§9). */
export const CS_OK_BG =
  'bg-[color-mix(in_oklab,var(--color-forest-200)_55%,var(--color-card))] dark:bg-[color-mix(in_oklab,var(--color-forest-700)_45%,var(--color-card))]'
export const CS_OK_INK = 'text-forest-800 dark:text-forest-200'
/** The light rule on every column (§8; owner: "Grid style everywhere"). The first cell drops it. */
export const CS_RULE =
  'border-l border-l-[color-mix(in_oklab,var(--color-border)_75%,var(--color-card))] dark:border-l-[color-mix(in_oklab,var(--color-border)_80%,var(--color-card))]'
/** The firmer rule on the first column of a column group. */
export const CS_RULE_GROUP =
  'border-l border-l-[color-mix(in_oklab,var(--color-border),var(--color-foreground)_10%)] dark:border-l-[color-mix(in_oklab,var(--color-border),var(--color-foreground)_14%)]'

/** One chip size (§11): 11.5/16 600, padding 1px 8px, ONE line, truncating inside a narrow column. */
const PILL_SHAPE =
  'inline-block max-w-full truncate rounded-full px-2 py-px text-[11.5px] leading-4 font-semibold align-middle'

/** A header (or label) that explains itself on hover and click: the dotted underline the journey rows use for a Tooltip trigger, and the help cursor. */
export const HELP_HEADER =
  'decoration-muted-foreground/60 cursor-help text-left underline decoration-dotted underline-offset-2'
export type PillTone =
  'red' | 'amber' | 'ok' | 'emerald' | 'sky' | 'purple' | 'stone' | 'muted' | 'line'

const PILL_OK = `${PILL_SHAPE} ${CS_OK_BG} ${CS_OK_INK}`

export const PILL: Record<PillTone, string> = {
  red: `${PILL_SHAPE} bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300`,
  amber: `${PILL_SHAPE} bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300`,
  /** The positive pill (§9): the forest ok tone. */
  ok: PILL_OK,
  /** @deprecated Emerald is retired (§9); the old name draws the ok tone until its callers move. */
  emerald: PILL_OK,
  sky: `${PILL_SHAPE} bg-sky-100 text-sky-700 dark:bg-sky-900/35 dark:text-sky-300`,
  purple: `${PILL_SHAPE} bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300`,
  stone: `${PILL_SHAPE} bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300`,
  muted: `${PILL_SHAPE} bg-muted text-muted-foreground`,
  /** Outlined, no fill: a season's basis (P · to date, r) beside its year. */
  line: `${PILL_SHAPE} border-border text-foreground border bg-transparent`,
}

/** What each state wears (§4.5): hold red, note amber, accepted ok (forest), R2 sky, R3 purple, cancelled stone. */
export const STATUS_TONE = {
  hold: 'red',
  note: 'amber',
  accepted: 'ok',
  round2: 'sky',
  round3: 'purple',
  cancelled: 'stone',
} as const satisfies Record<string, PillTone>

// ── Household chips (§4.9; D32: sky / purple / emerald) ───────────────────────

const CHIP_SHAPE =
  'inline-flex items-center rounded-md px-1.5 py-px text-xs font-bold whitespace-nowrap'

export const HOUSEHOLD_CHIP: Record<number, string> = {
  1: `${CHIP_SHAPE} bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200`,
  2: `${CHIP_SHAPE} bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200`,
  3: `${CHIP_SHAPE} bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200`,
}

/** The page-relative index is unbounded server-side: the fourth household onward wears the neutral chip. */
export const HOUSEHOLD_CHIP_NEUTRAL = `${CHIP_SHAPE} bg-muted text-muted-foreground`

export function householdChipClass(index: number): string {
  return HOUSEHOLD_CHIP[index] ?? HOUSEHOLD_CHIP_NEUTRAL
}

/** A matched CampMinder id under a name (D27). */
export const ID_CHIP =
  'inline-flex items-center rounded bg-amber-100 px-1 font-mono text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'

// ── The table (§4.3; D18, D25, D28, D29, D31; mockups/round7.html) ────────────

/**
 * The grid's search box (design-language §2–3; kit .cf-search): the one 26px control height at
 * 12.5px on card white, the glyph 8px in.
 */
export const AID_SEARCH_INPUT =
  'bg-card border-border text-foreground placeholder:text-muted-foreground box-border h-[26px] w-full rounded-lg border pr-2.5 pl-[26px] text-[12.5px] leading-[18px] shadow-[0_1px_2px_hsl(var(--shadow-color)/0.07)] focus:border-[color-mix(in_oklab,var(--color-primary)_50%,var(--color-border))] focus:ring-2 focus:ring-primary/15 focus:outline-none'

export const TABLE_CARD = 'bg-card border-border shadow-lodge-sm overflow-x-auto rounded-xl border'
/**
 * The opt-in screen box (grid layout T1): one box scrolling both ways. It never holds the wheel
 * (§23): at its end the page scrolls on, so the notes below stay reachable.
 */
export const SCROLL_BOX = 'bg-card border-border shadow-lodge-sm overflow-auto rounded-xl border'
export const TABLE = 'w-full table-fixed border-separate border-spacing-0 text-sm'
/** The header (§8): 12/15 600 muted on bg-muted, padded 5px 8px, the light column rule. */
export const TH = `bg-muted text-muted-foreground border-border border-b px-2 py-[5px] align-bottom text-left text-xs leading-tight font-semibold whitespace-normal ${CS_RULE} first:border-l-0`
/**
 * A cell (§2, §8): padded 5px 8px, the light column rule on every column but the first. No
 * `white-space` here: the cell picks nowrap, or normal on the highlighted flexible column (Ruling
 * 2026-10-01 (plan review): no two classes setting one property).
 */
export const TD = `border-border overflow-hidden border-b px-2 py-[5px] align-top text-ellipsis ${CS_RULE} first:border-l-0`
/** Cells are opaque, so pinned columns hide what scrolls under them. */
export const CELL_BG = 'bg-card'
/** The highlighted row (D31): amber tint, opaque in both themes. */
export const ROW_HIGHLIGHT =
  'bg-amber-50 dark:bg-[color-mix(in_oklab,var(--color-amber-900)_30%,var(--color-card))]'
export const HIGHLIGHT_EDGE = 'shadow-[inset_3px_0_0_var(--color-amber-500)]'
/** The soft shadow on the last pinned column's edge (D25). */
export const PINNED_EDGE = 'shadow-[6px_0_6px_-6px_rgb(0_0_0/0.16)]'
/** The soft shadow on the left edge of a column frozen on the right (batch 4: Needs attention). */
export const RIGHT_PINNED_EDGE = 'shadow-[-6px_0_6px_-6px_rgb(0_0_0/0.16)]'
/** Both on one cell (a highlighted row's first cell is also the last pinned one): one shadow class, not two. */
export const HIGHLIGHT_PINNED_EDGE =
  'shadow-[inset_3px_0_0_var(--color-amber-500),6px_0_6px_-6px_rgb(0_0_0/0.16)]'
/** A total row (§10): the green band, bold, its edge on top. */
export const TFOOT_CELL = `${CS_BAND} ${CS_BAND_EDGE} px-2 py-[5px] font-bold whitespace-nowrap ${CS_RULE} first:border-l-0`
/** The totals label's cell in the screen box: it wraps within the pinned column rather than printing over the next total. */
export const TFOOT_CELL_WRAP = `${CS_BAND} ${CS_BAND_EDGE} px-2 py-[5px] font-bold whitespace-normal ${CS_RULE} first:border-l-0`
/** A section row (§9): the green band. */
export const GROUP_ROW = `${CS_BAND} ${CS_BAND_EDGE} text-foreground border-border border-b px-2 py-[5px] text-[13.5px] font-bold`
/**
 * The opened row's detail line (batch 4, grid-layout-options.html round 6): the highlighted row's
 * tint with an amber rule under it. Its cell must not clip (`overflow-visible`) and carries no side
 * padding, or the sticky line inside would be trapped by it or pushed off the box's left edge.
 */
export const DETAIL_ROW = `${ROW_HIGHLIGHT} overflow-visible border-b border-amber-300 px-0 py-1.5 dark:border-amber-800`
/** The line itself: stuck at the box's left, as wide as the box (set inline), wrapping. */
export const DETAIL_LINE = 'sticky left-0 box-border px-3 whitespace-normal'

/** A row's own tick (the Tick column, and the detail line's Tick Accepted). */
export const TICK_BUTTON =
  'border-border hover:bg-muted rounded border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap'
/** The editor row under the highlighted row (D22; `renderBelowHighlighted`, money's To place). */
export const EDITOR_ROW = 'bg-forest-50 dark:bg-forest-900 border-border border-b px-3 py-2.5'
export const TOTAL_BUTTON = 'tabular-nums hover:underline'
/** A total that opens its lines, said so by its title: a link in the band (kit `.cf-grid tfoot a`). */
export const TOTAL_LINK =
  'text-primary cursor-pointer font-bold tabular-nums underline decoration-dotted underline-offset-[3px] disabled:cursor-not-allowed disabled:opacity-60'

// ── The receipt (§4.7, §6.5; D33) ─────────────────────────────────────────────

/** The line whose limit decided the amount, and the words naming it. */
export const BINDING_LINE = 'bg-amber-50 dark:bg-amber-900/20'
export const BINDING_TEXT = 'font-medium text-amber-700 dark:text-amber-400'

// ── The Requests views strip (slice 1 grid layout T4; grid-layout-options.html v=f) ────────

/**
 * One line, never wrapping: lenses │ pipeline │ exception badges, the trailing badges folding into
 * +N when they do not fit (owner 2026-10-04). `relative` anchors the badges' measuring copy.
 */
export const STRIP =
  'border-border bg-card relative flex items-center gap-1 rounded-[10px] border p-[3px] whitespace-nowrap shadow-[0_1px_2px_hsl(var(--shadow-color)/0.07)]'
export const STRIP_LENSES = 'mr-1.5 flex gap-0.5'
const STRIP_LENS_SHAPE =
  'inline-flex items-center gap-1 rounded-lg px-[7px] py-[5px] text-[12.5px] leading-[18px]'
/** All reads in ink, Appeals muted, as the mock's lenses do. (The Scenarios and History chips.) */
export const STRIP_LENS = {
  all: `${STRIP_LENS_SHAPE} text-foreground font-semibold`,
  appeals: `${STRIP_LENS_SHAPE} text-muted-foreground font-medium`,
} as const
/** The chip picked: filled. (Scenarios and History; Requests outlines its lens, `REQ_LENS`.) */
export const STRIP_LENS_ON = `${STRIP_LENS_SHAPE} bg-primary text-primary-foreground font-semibold`

/**
 * The Requests strip's own lenses (ux3 requests-4; mock `.cf-strip .lens button`): 24px, 7px radius,
 * a 1px border that is transparent while idle and primary while picked, in both views. Never filled.
 */
const REQ_LENS_SHAPE =
  'inline-flex h-6 items-center gap-1 rounded-[7px] border px-[7px] text-[12.5px] leading-[18px]'
export const REQ_LENS = {
  idle: `${REQ_LENS_SHAPE} text-muted-foreground border-transparent font-normal`,
  on: `${REQ_LENS_SHAPE} border-primary text-primary font-bold`,
} as const

export const STRIP_PIPE = 'flex'
const SEG_SHAPE =
  'inline-flex h-[26px] items-center gap-0 pr-5 pl-[18px] -ml-1.5 text-[12.5px] leading-[18px] [clip-path:polygon(0_0,calc(100%_-_10px)_0,100%_50%,calc(100%_-_10px)_100%,0_100%,10px_50%)] first:ml-0 first:rounded-l-md first:pl-3 first:[clip-path:polygon(0_0,calc(100%_-_10px)_0,100%_50%,calc(100%_-_10px)_100%,0_100%)]'
const SEG_FILL = 'bg-[color-mix(in_oklab,var(--color-muted)_80%,var(--color-card))]'
/** A chevron: to do (ink), watched (muted: Waiting on the family, rv=todo), or picked (forest). */
export const STRIP_SEG = {
  todo: `${SEG_SHAPE} ${SEG_FILL} text-foreground font-semibold`,
  watch: `${SEG_SHAPE} ${SEG_FILL} text-muted-foreground font-normal`,
  on: `${SEG_SHAPE} bg-forest-700 dark:bg-forest-600 font-semibold text-white`,
} as const

const COUNT = 'not-italic tabular-nums'
/** A chevron's count (mock `.stg .n`): 11px bold muted, a pill only where a tone below says so. */
const STRIP_COUNT_BASE = `${COUNT} ml-1.5 inline-block min-w-[14px] rounded-full px-[5px] text-center text-[11px] leading-4 font-bold`
export const STRIP_COUNT_PLAIN = `${STRIP_COUNT_BASE} text-muted-foreground`
/** Not reconciled's count: the amber pill, at any count (mock `.stg.amber .n`). */
export const STRIP_COUNT_AMBER = `${STRIP_COUNT_BASE} bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300`
/** The picked stage's count: amber-400 on forest-900 in both themes (mock `.stg.on .n`). */
export const STRIP_COUNT_PICKED = `${STRIP_COUNT_BASE} bg-amber-400 dark:bg-amber-400 text-forest-900`
/** A lens or chip count: plain, in the lens's own ink. */
export const STRIP_COUNT_WATCH = `${COUNT} text-xs opacity-85`
export const STRIP_COUNT_LENS = `${COUNT} ml-px`

export const STRIP_EXCEPTIONS = 'border-border ml-auto flex gap-1 border-l pl-2'
const BADGE_SHAPE =
  'inline-flex h-[22px] items-center gap-1 rounded-full border px-[9px] py-0 text-xs leading-[18px] font-semibold [&>i]:font-bold [&>i]:not-italic [&>i]:tabular-nums'
/** An exception badge (k-pill tones): a hold or duplicate red, an unsettled session amber, none muted. */
export const STRIP_BADGE = {
  red: `${BADGE_SHAPE} border-red-200 bg-red-50 text-red-700 dark:border-red-700/60 dark:bg-red-900/40 dark:text-red-200`,
  amber: `${BADGE_SHAPE} border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-700/60 dark:bg-amber-900/40 dark:text-amber-300`,
  zero: `${BADGE_SHAPE} text-muted-foreground border-transparent bg-transparent font-medium opacity-70`,
} as const
/** The badge picked: the mock's 1.5px inset ring in the badge's own ink. */
export const STRIP_BADGE_ON = 'shadow-[inset_0_0_0_1.5px_currentColor]'
/**
 * The badges' measuring copy: every badge at its natural width, laid out where nothing sees it. A
 * 0×0 box clipping its content, so it neither shows nor widens the strip, and folding never reads
 * a width it changed itself.
 */
export const STRIP_MEASURE =
  'pointer-events-none invisible absolute top-0 left-0 h-0 w-0 overflow-hidden'
/** The +N chip's list of folded badges, anchored under the chip. */
export const STRIP_FOLDED =
  'bg-popover border-border fixed z-[200] flex flex-col items-stretch gap-1 rounded-lg border p-1.5 whitespace-nowrap shadow-lg'
