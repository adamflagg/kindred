import { ACTION_LINK, BUTTON_SECONDARY } from '../../admin/lodging/lodgingStyles'
import type { TickAction } from './ticks'

/** What the last tick did: its words, and exactly the lines it ticked (bulk ruling Q4). */
export interface TickResult {
  readonly words: string
  readonly ticked: readonly string[]
}

const LISTED = 12

/** The bulk actions over selected rows (§4.10; Decision 16: Posted and Accepted; there's no stage to move). */
export function BulkBar({
  count,
  onTick,
  onClear,
  result,
}: {
  count: number
  onTick: (action: TickAction) => void
  onClear: () => void
  result: TickResult | null
}) {
  if (count === 0 && result === null) return null
  return (
    <div className="space-y-1 text-sm">
      {count > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">{count} selected</span>
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
          {result.ticked.length > 0 &&
            `: ${result.ticked.slice(0, LISTED).join(', ')}${
              result.ticked.length > LISTED
                ? ` and ${String(result.ticked.length - LISTED)} more`
                : ''
            }`}
        </p>
      )}
    </div>
  )
}
