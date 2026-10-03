import { Link } from 'react-router'

import { countWords } from '../requests/views'
import type { StripRound } from './budgetModel'
import { FIGURE_LINK, SEASON_CARD } from './seasonStyles'

/**
 * The strip (§7.2; D44, D153; running-rounds.html): each round's live counts on its own line, in
 * Today's "fam · req" words (principle 7). Each count opens the rows it counts; a zero, or a count
 * a past date can't rebuild ("—"), opens nothing. The read's strip is the whole season's, so on a
 * page scoped to one pool (`scoped`) it says so above its lines (Task 4 I1); no figure changes.
 */
export function BudgetStrip({
  rounds,
  scoped,
}: {
  rounds: readonly StripRound[]
  scoped: boolean
}) {
  return (
    <div className={`${SEASON_CARD} space-y-0.5`} data-testid="budget-strip">
      {scoped && (
        <div className="text-muted-foreground text-xs font-semibold">
          All pools · the whole season
        </div>
      )}
      {rounds.map((round) => (
        <div key={round.round} className="flex flex-wrap items-baseline gap-x-2">
          <b>Round {round.round}</b>
          {round.counts.map((count, index) => (
            <span key={count.measure} className="whitespace-nowrap">
              {index > 0 && <span className="text-muted-foreground mr-2">·</span>}
              <span className="text-muted-foreground">{count.label}</span>{' '}
              {count.href === null ? (
                <span className="tabular-nums">{countWords(count.count)}</span>
              ) : (
                <Link
                  to={count.href}
                  className={`text-primary font-semibold tabular-nums ${FIGURE_LINK}`}
                >
                  {countWords(count.count)}
                </Link>
              )}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}
