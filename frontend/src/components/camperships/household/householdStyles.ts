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

/** D27: a section title is the request card's title (DM Sans 13.5 bold); Fraunces belongs to the band alone. */
export const SECTION_TITLE = 'font-sans text-[13.5px] font-bold tracking-[-0.011em]'
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
