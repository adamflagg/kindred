import type { ReactNode } from 'react'
import { Link } from 'react-router'

import type { ApiAidBudget } from '../../../types/api-types'
import { countWords } from '../requests/views'
import type { AidView } from '../kit/asOf'
import { CS_LINK_CELL } from '../kit/csType'
import { TABLE_CARD } from '../kit/kitStyles'
import { formatMoney } from '../kit/money'
import { AidSectionHead } from '../kit/SectionHead'
import { noteMark } from './BudgetCard'
import {
  belowTheLine,
  budgetTypeLines,
  scopePool,
  stripRounds,
  type StripMeasure,
} from './budgetModel'
import { BudgetTypeLines } from './BudgetTypeLines'
import { demandGroups } from './demandModel'
import {
  belowSummary,
  demandSummary,
  lineKey,
  standsSummary,
  typesSummary,
  type FoldLineKey,
} from './foldLinesModel'
import { ForwardDemand } from './ForwardDemand'
import { RG_TABLE, RG_TD, RG_TD_NUM, RG_TH, RG_TH_NUM } from './rules/gridStyles'

const STANDS_SCOPE = 'All pools · the whole season'
const HELD_UNKNOWN = 'Amount unknown until each is resolved'

/** A lower section: its heading row folds, its ruled table draws only when open (rounds-10: the heading is the kit's). */
function Section({
  id,
  title,
  note,
  description,
  open,
  onToggle,
  children,
}: {
  id: FoldLineKey
  title: string
  note?: ReactNode
  description: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section data-fold-line={id}>
      <AidSectionHead
        title={title}
        note={note}
        description={description}
        open={open}
        onToggle={onToggle}
      />
      {open && children}
    </section>
  )
}

/** The stage columns of Where each round stands, in the mock's order; each count opens its rows. */
const STAGES: ReadonlyArray<{ measure: StripMeasure; label: string }> = [
  { measure: 'needs_offer', label: 'Needs an offer' },
  { measure: 'posted', label: 'Posted' },
  { measure: 'accepted', label: 'Accepted' },
  { measure: 'held', label: 'Held' },
  { measure: 'pending_approval', label: 'Pending approval' },
]

function StandsTable({ budget, view }: { budget: ApiAidBudget; view: AidView }) {
  return (
    <div className={TABLE_CARD}>
      <table className={RG_TABLE}>
        <thead>
          <tr>
            <th className={RG_TH}>Round</th>
            {STAGES.map((stage) => (
              <th key={stage.measure} className={RG_TH_NUM}>
                {stage.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stripRounds(budget.strip, view).map((round) => (
            <tr key={round.round} data-stands-round={round.round}>
              <td className={RG_TD}>
                <b>{`Round ${String(round.round)}`}</b>
              </td>
              {STAGES.map((stage) => {
                const count = round.counts.find((c) => c.measure === stage.measure)
                return (
                  <td key={stage.measure} className={RG_TD_NUM}>
                    {count === undefined ? null : count.href === null ? (
                      countWords(count.count)
                    ) : (
                      <Link to={count.href} className={CS_LINK_CELL}>
                        {countWords(count.count)}
                      </Link>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BelowTable({
  budget,
  pool,
  view,
}: {
  budget: ApiAidBudget
  pool: string | null
  view: AidView
}) {
  return (
    <div className={TABLE_CARD}>
      <table className={RG_TABLE}>
        <thead>
          <tr>
            <th className={RG_TH}>Line</th>
            <th className={RG_TH_NUM}>Families · requests</th>
            <th className={RG_TH_NUM}>Amount</th>
            <th className={RG_TH}>Of it</th>
          </tr>
        </thead>
        <tbody>
          {belowTheLine(budget, pool, view).map((line) => (
            <tr key={line.key} data-below-line={line.key}>
              <td className={RG_TD}>
                {line.key.startsWith('outside_type:')
                  ? `${line.label} (outside the camp's budget)`
                  : line.label}
              </td>
              <td className={RG_TD_NUM}>
                {line.count === null ? null : line.href === null ? (
                  countWords(line.count)
                ) : (
                  <Link to={line.href} className={CS_LINK_CELL}>
                    {countWords(line.count)}
                  </Link>
                )}
              </td>
              <td className={RG_TD_NUM} title={line.key === 'held' ? HELD_UNKNOWN : undefined}>
                {line.amount === null ? '—' : formatMoney(line.amount)}
              </td>
              <td className={RG_TD}>{line.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Everything below the ruled ledger (spec §5.2 F; kit §19): four sections, each a bold heading row with its summary right
 * after it, folding onto a ruled table. Where each round stands starts open (owner, 10-09); the other three start closed.
 */
export function BudgetFoldLines({
  budget,
  pool,
  view,
  open,
  onToggle,
  numberOf,
}: {
  budget: ApiAidBudget
  pool: string | null
  view: AidView
  open: ReadonlySet<string>
  onToggle: (key: string) => void
  numberOf: (key: string) => number | null
}) {
  const scope = scopePool(budget, pool)
  if (scope === undefined) return null
  const is = (key: FoldLineKey) => open.has(lineKey(key))
  const toggle = (key: FoldLineKey) => () => onToggle(lineKey(key))
  const demand = demandGroups(budget, pool, view)
  const types = budgetTypeLines(budget, pool)
  // A one-pool page names its pool on each pool-scoped summary (mock ?scope=tbm: "TBM · outside grants $800 · …").
  const scoped = (words: string) => (pool === null ? words : `${scope.label} · ${words}`)
  return (
    <div data-testid="fold-lines">
      <Section
        id="stands"
        title="Where each round stands"
        description={`${pool === null ? '' : `${STANDS_SCOPE} · `}${standsSummary(budget.strip)}`}
        open={is('stands')}
        onToggle={toggle('stands')}
      >
        <StandsTable budget={budget} view={view} />
      </Section>
      <Section
        id="below"
        title="Shown, not counted"
        note={noteMark(numberOf, 'below_the_line')}
        description={scoped(belowSummary(budget, pool))}
        open={is('below')}
        onToggle={toggle('below')}
      >
        <BelowTable budget={budget} pool={pool} view={view} />
      </Section>
      {demand.length > 0 && (
        <Section
          id="demand"
          title="Demand still to come"
          note={noteMark(numberOf, 'demand')}
          description={scoped(demandSummary(scope))}
          open={is('demand')}
          onToggle={toggle('demand')}
        >
          <ForwardDemand groups={demand} view={view} />
        </Section>
      )}
      {types.length > 0 && (
        <Section
          id="types"
          title="In the budget, by decision type"
          description={scoped(typesSummary(scope))}
          open={is('types')}
          onToggle={toggle('types')}
        >
          <BudgetTypeLines lines={types} />
        </Section>
      )}
    </div>
  )
}
