/**
 * Season's tables and cards (slice 2), in the kit's compact admin dialect (D19; kitStyles.ts).
 * Semantic tokens only, so both themes resolve on their own; amber notes reuse lodgingStyles'
 * AMBER_NOTE, which carries its `dark:` partner. One text-align per class string: a header never
 * carries both `text-left` and `text-right` (the kit ledger's lesson), seasonStyles.test.ts holds it.
 */
import { TH } from '../kit/kitStyles'

/** A left-aligned header cell: the kit's TH, 12/15 (spec §1.1). */
export const TH_LABEL = TH
/** A money header: the same, right-aligned like its figures (§4.2). One text-align per string. */
export const TH_MONEY = TH.replace('text-left', 'text-right')
/** A right-aligned header that takes its own background (a column tint): no bg. */
export const TH_MONEY_TEXT = TH_MONEY.replace('bg-muted ', '')
export const TD_LABEL = 'border-border border-b px-2 py-1.5 text-left whitespace-nowrap'
/** A left-aligned cell that may wrap: free text (what changed), where TD_LABEL keeps one line. */
export const TD_TEXT = 'border-border border-b px-2 py-1.5 text-left'
export const TD_MONEY =
  'border-border border-b px-2 py-1.5 text-right whitespace-nowrap tabular-nums'
/** The heading over the lines shown below the line (§5.3). */
export const BELOW_HEADING =
  'bg-muted/40 text-muted-foreground border-border border-b px-2 py-1.5 text-left text-xs font-semibold tracking-wide uppercase'
/** A figure that opens its rows (D20). */
export const FIGURE_LINK = 'hover:underline'
/** A small card for a strip or a block under the table. */
export const SEASON_CARD = 'card-lodge px-3 py-2 text-sm'
