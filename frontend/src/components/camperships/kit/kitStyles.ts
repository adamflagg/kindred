/**
 * The finance kit's own class strings (pills, chips, table, receipt), kept apart from aidStyles.ts
 * so the shell's eager path (AppLayout -> RemainingLine -> MoneyText) pulls in only NEGATIVE_INK
 * and none of this. Same rules as aidStyles.ts: every raw palette colour has its `dark:` partner
 * (aidStyles.test.ts holds that line for both modules); `text-xs` is the floor.
 */

// ── Pills (§4.5; D19, D59) ────────────────────────────────────────────────────

const PILL_SHAPE =
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap'

export type PillTone = 'red' | 'amber' | 'emerald' | 'sky' | 'purple' | 'stone' | 'muted'

export const PILL: Record<PillTone, string> = {
  red: `${PILL_SHAPE} bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300`,
  amber: `${PILL_SHAPE} bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300`,
  emerald: `${PILL_SHAPE} bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300`,
  sky: `${PILL_SHAPE} bg-sky-100 text-sky-700 dark:bg-sky-900/35 dark:text-sky-300`,
  purple: `${PILL_SHAPE} bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300`,
  stone: `${PILL_SHAPE} bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300`,
  muted: `${PILL_SHAPE} bg-muted text-muted-foreground`,
}

/** What each state wears (§4.5): hold red, note amber, accepted emerald, R2 sky, R3 purple, cancelled stone. */
export const STATUS_TONE = {
  hold: 'red',
  note: 'amber',
  accepted: 'emerald',
  round2: 'sky',
  round3: 'purple',
  cancelled: 'stone',
} as const satisfies Record<string, PillTone>

// ── Household chips (§4.9; D32: sky / purple / emerald) ───────────────────────

const CHIP_SHAPE =
  'inline-flex items-center rounded-md px-1.5 py-px text-xs font-bold whitespace-nowrap'

export const HOUSEHOLD_CHIP: Record<1 | 2 | 3, string> = {
  1: `${CHIP_SHAPE} bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200`,
  2: `${CHIP_SHAPE} bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200`,
  3: `${CHIP_SHAPE} bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200`,
}

/** A matched CampMinder id under a name (D27). */
export const ID_CHIP =
  'inline-flex items-center rounded bg-amber-100 px-1 font-mono text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'

// ── The table (§4.3; D18, D25, D28, D29, D31; mockups/round7.html) ────────────

export const TABLE_CARD = 'bg-card border-border shadow-lodge-sm overflow-x-auto rounded-xl border'
export const TABLE = 'w-full table-fixed border-separate border-spacing-0 text-sm'
export const TH =
  'bg-muted text-muted-foreground border-border border-b px-2 py-1.5 text-left text-xs font-semibold whitespace-nowrap'
/** No `white-space` here: the cell picks nowrap, or normal on the highlighted flexible column (Ruling 2026-10-01 (plan review): no two classes setting one property). */
export const TD = 'border-border overflow-hidden border-b px-2 py-1.5 align-top text-ellipsis'
/** Cells are opaque, so pinned columns hide what scrolls under them. */
export const CELL_BG = 'bg-card'
/** The highlighted row (D31): amber tint, opaque in both themes. */
export const ROW_HIGHLIGHT =
  'bg-amber-50 dark:bg-[color-mix(in_oklab,var(--color-amber-900)_30%,var(--color-card))]'
export const HIGHLIGHT_EDGE = 'shadow-[inset_3px_0_0_var(--color-amber-500)]'
/** The soft shadow on the last pinned column's edge (D25). */
export const PINNED_EDGE = 'shadow-[6px_0_6px_-6px_rgb(0_0_0/0.25)]'
/** Both on one cell (a highlighted row's first cell is also the last pinned one): one shadow class, not two. */
export const HIGHLIGHT_PINNED_EDGE =
  'shadow-[inset_3px_0_0_var(--color-amber-500),6px_0_6px_-6px_rgb(0_0_0/0.25)]'
export const TFOOT_CELL =
  'bg-muted border-border border-t px-2 py-1.5 font-semibold whitespace-nowrap'
export const GROUP_ROW =
  'bg-muted text-muted-foreground border-border border-b px-2 py-1.5 text-xs font-semibold'
/** The editor row under the highlighted row (D22). */
export const EDITOR_ROW = 'bg-forest-50 dark:bg-forest-900 border-border border-b px-3 py-2.5'
export const TOTAL_BUTTON = 'tabular-nums hover:underline'

// ── The receipt (§4.7, §6.5; D33) ─────────────────────────────────────────────

/** The line whose limit decided the amount, and the words naming it. */
export const BINDING_LINE = 'bg-amber-50 dark:bg-amber-900/20'
export const BINDING_TEXT = 'font-medium text-amber-700 dark:text-amber-400'
