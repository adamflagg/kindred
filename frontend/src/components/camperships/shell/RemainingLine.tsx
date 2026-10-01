import { Fragment } from 'react'
import { Link } from 'react-router'

import { Permission } from '../../../constants/permissions'
import { useAidAsOf } from '../../../hooks/camperships/useAidAsOf'
import { useAidRemaining } from '../../../hooks/camperships/useAidRemaining'
import { useYear } from '../../../hooks/useCurrentYear'
import { usePermissions } from '../../../hooks/usePermissions'
import { aidHref } from '../kit/asOf'
import { MoneyCompact } from '../kit/MoneyText'

const LINE = 'text-muted-foreground flex items-baseline gap-1.5 text-xs whitespace-nowrap'

/**
 * The Remaining line (D48, D75; spec §7.3; mockups/remaining-bar.html B): one figure per pool,
 * summed over Rounds 1–3 (§5.3), each opening Rounds & budget filtered to that pool for a `view`
 * holder. For a summary-only user the figures open nothing (D65). Under ?as_of the band's amber
 * pill covers it; until 3c-2 rebuilds past Remaining, each pool shows "—" there. A season with no
 * approved rules has no pools yet: "Remaining —".
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
            {pool.label} <MoneyCompact value={pool.remaining} className="font-semibold" />
          </>
        )
        return (
          <Fragment key={pool.pool}>
            {index > 0 && <span>·</span>}
            {opens ? (
              <Link
                to={aidHref('/aid/season/rounds-budget', { year, asOf }, { pool: pool.pool })}
                className="text-foreground border-border border-b border-dotted"
              >
                {figure}
              </Link>
            ) : (
              <span className="text-foreground">{figure}</span>
            )}
          </Fragment>
        )
      })}
    </span>
  )
}
