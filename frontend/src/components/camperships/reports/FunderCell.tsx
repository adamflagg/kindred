import { Link } from 'react-router'

import { CS_CUT, CS_LINK_CELL } from '../kit/csType'
import { StatusPill } from '../kit/Pills'
import type { FunderFacts } from './developmentModel'

/**
 * A funder line on Development, on ONE line (final mock reports-development): the name (a link to Money ›
 * Funders when the user can open it, cut with an ellipsis) and, at the right of the cell, its facts:
 * `need-based` (muted) or an `incentive` pill, then "· C&Q" by the pool's short name (its full name in the
 * title) or a "needs a group" pill, and a "no funder yet" pill when no funder claims the source.
 */
export function FunderCell({
  name,
  facts,
  href,
}: {
  readonly name: string
  readonly facts: FunderFacts
  readonly href: string | undefined
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={`${CS_CUT} min-w-0 flex-initial`}>
        {href === undefined ? (
          name
        ) : (
          <Link to={href} className={CS_LINK_CELL}>
            {name}
          </Link>
        )}
      </span>
      <span className="text-muted-foreground ml-auto flex flex-none items-center gap-1.5 text-xs">
        {facts.kind === 'incentive' ? (
          <StatusPill tone="purple">incentive</StatusPill>
        ) : (
          <span>need-based</span>
        )}
        {facts.pool === null ? (
          <StatusPill tone="amber" title="No reporting group yet: set one in Money › Funders">
            needs a group
          </StatusPill>
        ) : (
          <span title={facts.pool.full}>· {facts.pool.short}</span>
        )}
        {facts.noFunder && (
          <StatusPill tone="amber" title="A CampMinder description no funder claims yet">
            no funder yet
          </StatusPill>
        )}
      </span>
    </span>
  )
}
