import { STATUS_TONE } from './kitStyles'
import { StatusPill } from './Pills'

/** Hold = it stops the award until released with a note; note = it never stops anything (main spec §10.5). */
export interface AttentionItem {
  readonly level: 'hold' | 'note'
  /** Why, in a word or two: "Income conflict". */
  readonly pill: string
  /** The long-form fact: "$120,000 vs $95,000 on the two forms. Call the family and enter the figure." */
  readonly fact: string
}

/** An item's chip: red for a hold, amber for a note. */
export function AttentionChip({ item }: { item: AttentionItem }) {
  return (
    <StatusPill tone={item.level === 'hold' ? STATUS_TONE.hold : STATUS_TONE.note}>
      {item.pill}
    </StatusPill>
  )
}

/**
 * The needs-attention cell (§4.4; D24; batch 4, owner LOCKED grid-layout-options.html#or=i): the
 * chip only. The full text and the next step live in the opened row's detail line, so the
 * highlighted row no longer grows tall (D31's full text moved there). A row that needs nothing
 * draws nothing.
 */
export function NeedsAttentionCell({ item }: { item: AttentionItem | null }) {
  return item === null ? null : <AttentionChip item={item} />
}
