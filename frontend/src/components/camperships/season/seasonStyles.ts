/**
 * Season's tables and cards (slice 2), in the kit's compact admin dialect (D19; kitStyles.ts).
 * Semantic tokens only, so both themes resolve on their own; amber notes reuse lodgingStyles'
 * AMBER_NOTE, which carries its `dark:` partner. One text-align per class string: a header never
 * carries both `text-left` and `text-right` (the kit ledger's lesson), seasonStyles.test.ts holds it.
 */

/** A left-aligned header cell: the label column. */
export const TH_LABEL =
  'bg-muted text-muted-foreground border-border border-b px-2 py-1.5 text-left text-xs font-semibold whitespace-nowrap'
/** A money header: right-aligned, like its figures (§4.2). */
export const TH_MONEY =
  'bg-muted text-muted-foreground border-border border-b px-2 py-1.5 text-right text-xs font-semibold whitespace-nowrap'
export const TD_LABEL = 'border-border border-b px-2 py-1.5 text-left whitespace-nowrap'
export const TD_MONEY =
  'border-border border-b px-2 py-1.5 text-right whitespace-nowrap tabular-nums'
/** A pool's total line, and the season's total. */
export const POOL_LINE = 'bg-muted/40 font-semibold'
export const TOTAL_LINE = 'bg-muted font-semibold'
/** The heading over the lines shown below the line (§5.3). */
export const BELOW_HEADING =
  'bg-muted/40 text-muted-foreground border-border border-b px-2 py-1.5 text-left text-xs font-semibold tracking-wide uppercase'
/** A figure that opens its rows (D20). */
export const FIGURE_LINK = 'hover:underline'
/** A small card for a strip or a block under the table. */
export const SEASON_CARD = 'card-lodge px-3 py-2 text-sm'
