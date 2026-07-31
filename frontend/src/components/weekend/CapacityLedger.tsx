/**
 * Does this weekend fit in the site?
 *
 * A camper list cannot ask this — campers do not consume a fixed pool. A
 * weekend does, and the unit of that pool is the SPACE, not the bed. A family
 * holds a whole cabin whether or not it fills it, so a cabin sleeping 8 that
 * houses a family of 3 leaves five beds no other family can use. Counting beds
 * would report comfortable headroom on a weekend that has run out of rooms.
 *
 * Beds are still real, they just answer a different question — whether a
 * PARTICULAR family fits a PARTICULAR cabin — which belongs to the board. Here
 * they are a footnote.
 *
 * The space count is provisional. Merging two cabins into one slot, or
 * splitting one back into two, changes it, and those are board actions. The
 * ledger says so rather than presenting the number as settled.
 */
import { Layers } from 'lucide-react'

export interface CapacityLedgerProps {
  families: number
  spaces: number
  /** Spaces whose capacity nobody has recorded. Still spaces; just unsized. */
  spacesUnmeasured: number
  bedsNeeded: number
  bedsAvailable: number
}

export function CapacityLedger({
  families,
  spaces,
  spacesUnmeasured,
  bedsNeeded,
  bedsAvailable,
}: CapacityLedgerProps) {
  const spare = spaces - families
  const isShort = spare < 0
  const filledPercent =
    spaces > 0 ? Math.min(100, (families / spaces) * 100) : families > 0 ? 100 : 0
  const fillTone = isShort ? 'bg-red-500 dark:bg-red-500/80' : 'bg-forest-500 dark:bg-forest-400'

  const spareLabel = isShort
    ? `${String(Math.abs(spare))} more families than spaces`
    : spare === 0
      ? 'No spare spaces'
      : `${String(spare)} spaces spare`

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-foreground text-5xl leading-none font-bold tabular-nums">
          {families}
        </span>
        <div className="flex flex-col">
          <span className="text-foreground text-sm font-semibold">families</span>
          <span className="text-muted-foreground text-xs">into {spaces} spaces</span>
        </div>
      </div>

      <div
        role="img"
        aria-label={`${String(families)} families in ${String(spaces)} spaces`}
        className="bg-muted/70 h-2.5 w-full overflow-hidden rounded-full"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${fillTone}`}
          style={{ width: `${String(filledPercent)}%` }}
        />
      </div>

      <div className="flex flex-col gap-1 text-xs">
        <span
          className={
            isShort ? 'font-semibold text-red-700 dark:text-red-400' : 'text-foreground font-medium'
          }
        >
          {spareLabel}
          {spacesUnmeasured > 0 && (
            <span className="text-muted-foreground font-normal">
              {' · '}
              {spacesUnmeasured} space{spacesUnmeasured === 1 ? '' : 's'} of unknown size
            </span>
          )}
        </span>

        <span className="text-muted-foreground inline-flex items-start gap-1.5">
          <Layers className="mt-0.5 h-3 w-3 flex-shrink-0" />
          Merging or splitting cabins on the board changes the space count.
        </span>

        {/* Beds answer "does this family fit this cabin", which is the board's
            question. Kept visible, kept small. */}
        <span className="text-muted-foreground/80">
          {bedsNeeded} beds needed across {bedsAvailable} in those spaces
        </span>
      </div>
    </div>
  )
}
