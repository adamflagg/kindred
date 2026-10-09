import { Fragment } from 'react'
import { Link } from 'react-router'

import { Permission } from '../../../constants/permissions'
import { useAidAsOf } from '../../../hooks/camperships/useAidAsOf'
import { useAidRemaining } from '../../../hooks/camperships/useAidRemaining'
import { useYear } from '../../../hooks/useCurrentYear'
import { usePermissions } from '../../../hooks/usePermissions'
import { aidHref } from '../kit/asOf'
import { MoneyCompact } from '../kit/MoneyText'

/**
 * Each pool's name on this crowded bar, by rules key (owner 2026-10-08), the way `sessionName`'s
 * `tiny` form shortens sessions. A key not listed reads its label whole, and the hover always
 * carries the full label. Pools change at most once a season; a renamed one is a one-line edit here.
 */
const POOL_SHORT_NAMES: Readonly<Record<string, string>> = {
  camp_quest: 'C&Q',
  tbm: 'TBM',
  weekend: 'Weekend',
}

// A block of inline figures, not a flex row, so a crowded bar can end it in an ellipsis (a flex row clips mid-figure).
const LINE = 'text-muted-foreground block min-w-0 truncate text-xs [&>*+*]:ml-1.5'

/**
 * The Remaining line (D48, D75; spec §7.3; mockups/remaining-bar.html B): one figure per pool,
 * summed over Rounds 1–3 (§5.3), each opening Rounds & budget filtered to that pool for a `view`
 * holder. For a summary-only user the figures open nothing (D65). Under ?as_of the band's amber
 * pill covers it; until 3c-2 rebuilds past Remaining, each pool shows "—" there. A season with no
 * approved rules has no pools yet: "Remaining —". A pool's negative is amber, "over its share" (D74 amended).
 */
export function RemainingLine() {
  const { data, isPending, error } = useAidRemaining()
  const { hasPermission } = usePermissions()
  const asOf = useAidAsOf()
  const year = useYear()
  const opens = hasPermission(Permission.FINANCIAL_AID_VIEW)
  const label = <span className="font-semibold">Remaining</span>

  if (error)
    return (
      <span data-testid="remaining-line" className={LINE}>
        {label}
        <span>unavailable</span>
      </span>
    )
  if (isPending)
    return (
      <span data-testid="remaining-line" className={LINE}>
        {label}
        <span>…</span>
      </span>
    )
  if (data.pools.length === 0)
    return (
      <span data-testid="remaining-line" className={LINE}>
        {label}
        <span>—</span>
      </span>
    )

  return (
    <span data-testid="remaining-line" className={LINE}>
      {label}
      {data.pools.map((pool, index) => {
        const figure = (
          <>
            {POOL_SHORT_NAMES[pool.pool] ?? pool.label}{' '}
            <MoneyCompact value={pool.remaining} tone="pool" className="font-semibold" />
          </>
        )
        return (
          <Fragment key={pool.pool}>
            {index > 0 && <span>·</span>}
            {opens ? (
              <Link
                to={aidHref('/aid/season/rounds-budget', { year, asOf }, { pool: pool.pool })}
                title={pool.label}
                className="text-foreground border-border border-b border-dotted"
              >
                {figure}
              </Link>
            ) : (
              <span title={pool.label} className="text-foreground">
                {figure}
              </span>
            )}
          </Fragment>
        )
      })}
    </span>
  )
}
