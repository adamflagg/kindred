import { ACTION_LINK, BUTTON_SECONDARY } from '../../admin/lodging/lodgingStyles'
import type { TickAction } from './ticks'

/** What the last tick did: its words, and exactly the lines it ticked (bulk ruling Q4). */
export interface TickResult {
  readonly words: string
  readonly lines: readonly string[]
  /**
   * Some of what was sent was already ticked. The server says how many, not which, so the list is
   * headed "Sent" rather than claimed as ticked.
   */
  readonly someAlreadyTicked: boolean
}

const LISTED = 12

/** The bulk actions over selected rows (§4.10; Decision 16: Posted and Accepted; there's no stage to move). */
export function BulkBar({
  count,
  hidden,
  onTick,
  onClear,
  result,
}: {
  count: number
  /** Ticked rows a search, the view or a filter hides: still ticked, and still in the tick. */
  hidden: number
  onTick: (action: TickAction) => void
  onClear: () => void
  result: TickResult | null
}) {
  if (count === 0 && result === null) return null
  return (
    <div className="space-y-1 text-sm">
      {count > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">
            {count} selected
            {hidden > 0 ? ` · ${String(hidden)} hidden by the search or filters` : ''}
          </span>
          <button type="button" className={BUTTON_SECONDARY} onClick={() => onTick('posted')}>
            Tick Posted…
          </button>
          <button type="button" className={BUTTON_SECONDARY} onClick={() => onTick('accepted')}>
            Tick Accepted…
          </button>
          <button type="button" className={ACTION_LINK} onClick={onClear}>
            Clear
          </button>
        </div>
      )}
      {result !== null && (
        <p className="text-muted-foreground text-xs">
          {result.words}
          {result.lines.length > 0 &&
            `${result.someAlreadyTicked ? '. Sent: ' : ': '}${result.lines.slice(0, LISTED).join(', ')}${
              result.lines.length > LISTED
                ? ` and ${String(result.lines.length - LISTED)} more`
                : ''
            }`}
        </p>
      )}
    </div>
  )
}
