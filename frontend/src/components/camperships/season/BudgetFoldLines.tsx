import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'

import type { ApiAidBudget } from '../../../types/api-types'
import { countWords } from '../requests/views'
import { aidHref, type AidView } from '../kit/asOf'
import { AidFoldPanel, AidFoldToggle } from '../kit/FoldRow'
import { AidOnNoRequestPanel } from '../intake/AidOnNoRequestPanel'
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

/** D170's line (owner Q4-A): it opens in place, its open state in `?open=` beside the sections'. */
const CM_LINE = 'campminder_off_requests'
export const CM_LINE_OPEN = `below:${CM_LINE}`

function BelowTable({
  budget,
  pool,
  view,
  open,
  onToggle,
}: {
  budget: ApiAidBudget
  pool: string | null
  view: AidView
  open: ReadonlySet<string>
  onToggle: (key: string) => void
}) {
  const cmOpen = open.has(CM_LINE_OPEN)
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
            <Fragment key={line.key}>
              <tr data-below-line={line.key}>
                <td className={RG_TD}>
                  {line.key === CM_LINE ? (
                    <AidFoldToggle
                      open={cmOpen}
                      onToggle={() => onToggle(CM_LINE_OPEN)}
                      title={line.title ?? undefined}
                    >
                      {line.label}
                    </AidFoldToggle>
                  ) : (
                    <span title={line.title ?? undefined}>
                      {line.key.startsWith('outside_type:')
                        ? `${line.label} (outside the camp's budget)`
                        : line.label}
                    </span>
                  )}
                </td>
                <td className={RG_TD_NUM}>
                  {line.families !== null ? (
                    `${String(line.families)} fam`
                  ) : line.count === null ? null : line.href === null ? (
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
                <td className={RG_TD}>
                  <span title={line.title ?? undefined}>{line.note}</span>
                  {line.key === CM_LINE && (
                    <>
                      {' · '}
                      <Link
                        to={aidHref('/aid/requests/intake', view, { show: 'all', cmaid: '1' })}
                        className={CS_LINK_CELL}
                        title="Open Requests › Form intake, the families this line counts"
                      >
                        Form intake ›
                      </Link>
                    </>
                  )}
                </td>
              </tr>
              {line.key === CM_LINE && cmOpen && (
                <AidFoldPanel span={4}>
                  <AidOnNoRequestPanel />
                </AidFoldPanel>
              )}
            </Fragment>
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
        <BelowTable budget={budget} pool={pool} view={view} open={open} onToggle={onToggle} />
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
