/**
 * The household page's own classes. Each card's stripe matches its chip (D32: sky / purple /
 * emerald). Every raw palette colour has its `dark:` partner.
 *
 * The polish PR (sitting B's true-up) trues this page to the mock's grammar
 * (docs mock household-v2, "trued"): 1px cards at radius 12 with the small lodge shadow and no
 * hover; 13.5px cards, 13px tables, 12.5px buttons, links and notes; 24px buttons in forest-700.
 * These are household-local on purpose: the kit's PILL, TABLE_CARD and lodgingStyles' buttons
 * also dress the approved Requests grid, so they are imported or left alone, never edited.
 */
import type { RoundStateTone } from './householdModel'

const STRIPE: Readonly<Record<number, string>> = {
  1: 'shadow-[inset_4px_0_0_var(--color-sky-400),0_1px_2px_hsl(var(--shadow-color)/0.04),0_2px_8px_hsl(var(--shadow-color)/0.06)] dark:shadow-[inset_4px_0_0_var(--color-sky-500),0_1px_2px_hsl(var(--shadow-color)/0.04),0_2px_8px_hsl(var(--shadow-color)/0.06)]',
  2: 'shadow-[inset_4px_0_0_var(--color-purple-400),0_1px_2px_hsl(var(--shadow-color)/0.04),0_2px_8px_hsl(var(--shadow-color)/0.06)] dark:shadow-[inset_4px_0_0_var(--color-purple-500),0_1px_2px_hsl(var(--shadow-color)/0.04),0_2px_8px_hsl(var(--shadow-color)/0.06)]',
  3: 'shadow-[inset_4px_0_0_var(--color-emerald-400),0_1px_2px_hsl(var(--shadow-color)/0.04),0_2px_8px_hsl(var(--shadow-color)/0.06)] dark:shadow-[inset_4px_0_0_var(--color-emerald-500),0_1px_2px_hsl(var(--shadow-color)/0.04),0_2px_8px_hsl(var(--shadow-color)/0.06)]',
}

/** Each stripe carries shadow-lodge-sm's two layers too: a box-shadow utility replaces, it doesn't stack. */
/** The fourth household onward wears the neutral stripe, as the chips do (D3: an inset stripe, not a curved border). */
export function stripeOf(chip: number): string {
  return (
    STRIPE[chip] ??
    'shadow-[inset_4px_0_0_var(--color-border),0_1px_2px_hsl(var(--shadow-color)/0.04),0_2px_8px_hsl(var(--shadow-color)/0.06)]'
  )
}

/** The family's share is the band's answer (D77): amber on the forest band. */
export const FAMILY_SHARE_INK = 'text-amber-300 dark:text-amber-300'

// ── Cards (D1, D2) ────────────────────────────────────────────────────────────

/** A request card or a section (the mock's .reqc / .sec): 1px, radius 12, still. */
export const HH_CARD =
  'bg-card border-border shadow-lodge-sm rounded-xl border px-3.5 py-3 text-[13.5px] leading-normal'
/** A household card (the mock's .hhcard): 13px; pair it with stripeOf(chip) for the inset stripe and the shadow. */
export const HH_HOUSEHOLD_CARD =
  'bg-card border-border rounded-xl border px-3 py-2.5 text-[13px] leading-normal'

// ── Words: notes and links (D1, D22, D29) ─────────────────────────────────────

/** A muted 12.5px note (the mock's .note). */
export const HH_NOTE = 'text-muted-foreground text-[12.5px]'
/** A forest text link with a visible dotted underline (the mock's .lnk); no hover reveal. */
export const HH_LINK =
  'text-forest-700 dark:text-forest-300 border-forest-700 dark:border-forest-300 cursor-pointer border-b border-dotted text-[12.5px] font-semibold whitespace-nowrap'
/** A CampMinder "Person" link (N7; the mock's .cml): forest-700 600 12.5px, the CM icon first. */
export const HH_LINK_CM =
  'text-forest-700 dark:text-forest-300 inline-flex items-center gap-[3px] align-middle text-[12.5px] font-semibold whitespace-nowrap'
/** A forest toggle with no underline (the mock's .fold / .more): "Show the receipt ▾", "N more answers match ▸". */
export const HH_TOGGLE =
  'text-forest-700 dark:text-forest-300 cursor-pointer text-[12.5px] font-semibold'

// ── Buttons (D4, D5, N6): 24px, 12.5px, forest-700 ────────────────────────────

const BUTTON_SHAPE =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] border px-2.5 py-[3px] text-[12.5px] leading-[1.5] font-semibold disabled:cursor-not-allowed disabled:opacity-50'
/** A card action, a Download, a form's Back (the mock's .btn). */
export const HH_BUTTON = `${BUTTON_SHAPE} bg-card border-border text-forest-700 hover:bg-muted dark:text-forest-300`
/** Mark Posted, Approve, a form's submit (the mock's .btn.pri). */
export const HH_BUTTON_PRIMARY = `${BUTTON_SHAPE} border-forest-700 bg-forest-700 text-white hover:bg-forest-800 dark:border-forest-500 dark:bg-forest-500 dark:hover:bg-forest-600`

// ── Tables (D9, D28, D29) ─────────────────────────────────────────────────────

/** The mock's table.rounds / table.t: 13px, 1px bottom rules; size the columns, don't stretch values away from labels. */
export const HH_TABLE = 'border-collapse text-[13px]'
export const HH_TH =
  'text-muted-foreground border-border border-b px-2 py-1 text-left text-xs font-semibold whitespace-nowrap'
export const HH_TH_NUM = `${HH_TH} text-right`
export const HH_TD = 'border-border border-b px-2 py-[5px] align-middle whitespace-nowrap'
export const HH_TD_NUM = `${HH_TD} text-right tabular-nums`

/** An uppercase sub-label inside a card (the mock's .eyebrow): "Grants", "Postings", "What priced it". */
export const HH_EYEBROW =
  'text-muted-foreground text-[11.5px] font-bold tracking-[0.05em] uppercase'

/** A 12.5px amber line (the mock's .amberline): the server's notes, a refusal. */
export const HH_AMBER_NOTE = 'text-[12.5px] text-amber-700 dark:text-amber-400'

// ── The decision panel's round line (D6–D10; O1) ──────────────────────────────

/**
 * The round-state pill (the mock's .pill): 11.5px bold, padding 1/9, fully round, in the state's
 * meaning tone. Household-local: the kit's PILL shape (12/500) stays on the grid and the header.
 */
const ROUND_PILL_SHAPE =
  'inline-flex items-center whitespace-nowrap rounded-full px-[9px] py-px text-[11.5px] leading-[1.5] font-bold'
export const HH_ROUND_PILL: Readonly<Record<RoundStateTone, string>> = {
  posted: `${ROUND_PILL_SHAPE} bg-forest-200/60 text-forest-900 dark:bg-forest-800/60 dark:text-forest-100`,
  offer: `${ROUND_PILL_SHAPE} bg-sky-200/60 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100`,
  finance: `${ROUND_PILL_SHAPE} border border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200`,
  hold: `${ROUND_PILL_SHAPE} bg-red-200/70 text-red-800 dark:bg-red-900/50 dark:text-red-200`,
  stone: `${ROUND_PILL_SHAPE} bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300`,
}

/** The panel's cells (the mock's table.rounds): padding 6/8, a bottom rule, 13px. */
export const HH_PANEL_TD = 'border-border border-b px-2 py-1.5 align-middle whitespace-nowrap'
/** The actionable Needs an offer row (D10): amber-100 at 45% over the card. */
export const HH_PANEL_ACTIONABLE = 'bg-amber-100/45 dark:bg-amber-900/20'
/** A round's lock words ("locked Mar 9 · Riley"): 11.5px muted. */
export const HH_LOCK = 'text-muted-foreground text-[11.5px]'

/**
 * A checklist tick (the mock's .tick): 12.5px, the box and its label, the date muted. A tick whose
 * real checkbox is disabled greys its label and shows cursor-not-allowed (owner rule: a box that
 * can't be clicked must look it); the decision panel's read-only Tick has no input, so is unchanged.
 */
export const HH_TICK =
  'inline-flex items-center gap-[5px] whitespace-nowrap text-[12.5px] has-[:disabled]:cursor-not-allowed has-[:disabled]:text-muted-foreground'
/** The tick's 14px box: forest-700 filled with a white ✓ when on (D6). On a real checkbox, the input itself. */
export const HH_TICK_BOX =
  'inline-flex size-3.5 shrink-0 appearance-none items-center justify-center rounded-[3px] border-[1.5px] border-muted-foreground text-[11px] leading-none text-white checked:border-forest-700 checked:bg-forest-700 disabled:cursor-not-allowed disabled:border-muted-foreground/50 disabled:opacity-50 dark:checked:border-forest-400 dark:checked:bg-forest-500'
export const HH_TICK_BOX_ON =
  'border-forest-700 bg-forest-700 dark:border-forest-400 dark:bg-forest-500'

// ── The editor box and its forms (D23, D24) ───────────────────────────────────

/** The card editor and every casework form (the mock's .editor): a forest border on a forest tint. */
export const HH_EDITOR_BOX =
  'rounded-[10px] border border-forest-700 bg-forest-200/20 px-3 py-2.5 whitespace-normal dark:border-forest-400 dark:bg-forest-900/25'
/** Its head (the mock's .ehd): uppercase forest-800; a muted aside keeps sentence case. */
export const HH_EDITOR_HEAD =
  'mb-1.5 flex flex-wrap gap-x-2.5 text-[11.5px] font-bold tracking-[0.05em] text-forest-800 uppercase dark:text-forest-200'
export const HH_EDITOR_ASIDE = 'text-muted-foreground font-normal tracking-normal normal-case'
/** A row of fields (the mock's .erow): 13px, labels that never wrap. */
export const HH_FORM_ROW = 'flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]'
export const HH_FORM_LABEL = 'inline-flex items-center gap-2 whitespace-nowrap'
/** A field (the mock's .erow input): sized to what it holds, never stretched to the row. */
export const HH_FIELD =
  'rounded-[7px] border border-forest-700 bg-white px-2 py-1 text-[13px] focus:ring-2 focus:ring-forest-700/30 focus:outline-none dark:border-forest-400 dark:focus:ring-forest-300/30 dark:bg-card'
/** A typed reason or note (the mock's input.t): 300px. */
export const HH_FIELD_TEXT = `${HH_FIELD} w-[300px] max-w-full`
/** A figure (the mock's input.n): 90px, right-aligned. */
export const HH_FIELD_NUMBER = `${HH_FIELD} w-[90px] text-right tabular-nums`
