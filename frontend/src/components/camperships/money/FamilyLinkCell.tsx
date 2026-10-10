import { Home } from 'lucide-react'
import { Link } from 'react-router'

import type { HouseholdLabel } from '../household/householdModel'
import { CS_LINK_CELL } from '../kit/csType'

/**
 * A Ledger family cell's household link, as the Requests grid draws a ⌂ household (#3120, final audit
 * M-E2): the label shrinks and truncates WITH its own "…" (`min-w-0 truncate`, never `flex-none`), and the
 * muted tiebreak gives way first (`shrink-[999]`). ⌂ leads a Family Camp household. The full label rides
 * in the cell's title.
 */
export function FamilyLinkCell({
  label,
  to,
  household,
}: {
  label: HouseholdLabel
  to: string
  /** A Family Camp household reads ⌂ before its label (§15). */
  household: boolean
}) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      {household && <Home className="text-muted-foreground h-3 w-3 flex-none" />}
      <Link
        className={`${CS_LINK_CELL} min-w-0 truncate`}
        to={to}
        onClick={(event) => event.stopPropagation()}
      >
        {label.text}
      </Link>
      {label.tiebreak !== '' && (
        <span className="text-muted-foreground min-w-0 shrink-[999] truncate font-normal">
          {label.tiebreak}
        </span>
      )}
    </span>
  )
}
