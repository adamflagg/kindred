/**
 * Reports' table grammar (spec §9; the compact admin dialect, D19). One text-align per class string:
 * a header or cell takes `…_LABEL` or `…_NUMBER`, never the kit's `TH` plus `text-right` (slice 2's
 * styling rule: no two classes setting one property). Indents are inline padding for the same reason.
 */
// Headers wrap to two lines (bottom-aligned) so a 15-column table fits 1440 px (slice 4 refresh, the
// statistics-v2 mock measured at 1440): figures never wrap.
const TH_SHAPE =
  'text-muted-foreground border-border border-b px-2 py-1.5 align-bottom text-xs font-semibold'
const TH_BASE = `bg-muted ${TH_SHAPE}`
export const TH_LABEL = `${TH_BASE} text-left`
export const TH_NUMBER = `${TH_BASE} text-right`
/** A heading over several columns ("Round 1"). */
export const TH_GROUP = `${TH_BASE} text-center`

const TD_BASE = 'border-border border-b px-2 py-1 align-top'
/** A row's label may wrap (a long Development line, "All award tables · Round 1"); it keeps 7rem. */
export const TD_LABEL = `${TD_BASE} min-w-28 text-left`
export const TD_NUMBER = `${TD_BASE} text-right tabular-nums whitespace-nowrap`

/** "Decided (not yet offered)": an amber column, header and cells (D130; slice 4 K; the mock's `.dec`). */
const DECIDED_FILL = 'bg-amber-50 dark:bg-amber-900/20'
export const TH_DECIDED = `${DECIDED_FILL} ${TH_SHAPE} text-right`
export const TD_DECIDED = `${TD_NUMBER} ${DECIDED_FILL}`

/** A group's name over its rows (Programs' pools; Development's sections). */
export const ROW_HEADING =
  'bg-muted/60 text-muted-foreground border-border border-b px-2 py-1 text-left text-xs font-semibold'
export const ROW_SUBTOTAL = 'font-semibold'
export const ROW_TOTAL = 'bg-muted font-semibold'

/** "P" or "r" beside a table's or a season's name (§9.7: every figure prints its basis). */
export const BASIS_BADGE =
  'ml-1.5 rounded bg-sky-100 px-1 text-xs font-semibold text-sky-800 dark:bg-sky-900/40 dark:text-sky-200'
export const REPORT_TITLE = 'font-display text-foreground text-sm font-semibold'
/** A small line of words under a table or a control. */
export const REPORT_NOTE = 'text-muted-foreground text-xs'
/** The reporting controls' bar. */
export const CONTROL_BAR =
  'bg-card border-border flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-3 py-2 text-sm'
/** "Decided (not yet offered)": amber, never "awarded" (D130; S4-3). */
export const DECIDED_INK = 'text-amber-700 dark:text-amber-400'
