import type { ReactNode } from 'react'

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

/**
 * The needs-attention cell (§4.4; D24, D31): the pill and the long-form fact on one line, cut at
 * the column edge. The full text shows only on the highlighted row, never on hover. A row that
 * needs nothing draws nothing.
 */
export function NeedsAttentionCell({
  item,
  highlighted,
  action,
}: {
  item: AttentionItem | null
  highlighted: boolean
  action?: ReactNode | undefined
}) {
  if (item === null) return null
  return (
    <div className="flex min-w-0 items-start gap-1.5">
      <StatusPill tone={item.level === 'hold' ? STATUS_TONE.hold : STATUS_TONE.note}>
        {item.pill}
      </StatusPill>
      {item.fact !== '' && (
        <span className={highlighted ? 'min-w-0 whitespace-normal' : 'min-w-0 truncate'}>
          {item.fact}
        </span>
      )}
      {action}
    </div>
  )
}
