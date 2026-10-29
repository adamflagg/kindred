import { STRIP_BADGE_CLOSED } from './kitStyles'
import { CLOSED_CHIP_TITLE } from './words'

/**
 * A closed season's count of its requests (CLOSED-SEASONS-DONE, owner ruling CSD-4; design-language "Closed
 * seasons"): every working count reads 0, and this one stone chip says the requests are still there. Not a link:
 * nothing about a closed season needs opening from the strip.
 */
export function ClosedChip({ count }: { readonly count: number }) {
  return (
    <span data-testid="closed-chip" className={STRIP_BADGE_CLOSED} title={CLOSED_CHIP_TITLE}>
      Closed <i>{count}</i>
    </span>
  )
}
