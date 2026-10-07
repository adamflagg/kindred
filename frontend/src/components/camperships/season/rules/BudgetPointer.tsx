import { Link } from 'react-router'

import { CS_BODY, CS_LINK, CS_PILL } from '../../kit/csType'

/** The budget lives on Rounds & budget (owner open item 5, B): Rules keeps one pointer line (spec §6.2 G). */
export function BudgetPointer({
  href,
  draftPill,
  errors,
}: {
  href: string
  draftPill: string | null
  errors: number
}) {
  return (
    <div id="budget-pointer" className={`${CS_BODY} flex flex-wrap items-baseline gap-2`}>
      <span>
        The budget plan is on{' '}
        <Link to={href} className={CS_LINK}>
          Rounds &amp; budget ›
        </Link>
      </span>
      {draftPill !== null && (
        <span className={CS_PILL.amber}>{`Budget and pools: ${draftPill}`}</span>
      )}
      {errors > 0 && (
        <span
          className={CS_PILL.red}
        >{`${String(errors)} ${errors === 1 ? 'error' : 'errors'}`}</span>
      )}
    </div>
  )
}
