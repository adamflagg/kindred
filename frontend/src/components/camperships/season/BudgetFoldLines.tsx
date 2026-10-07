import type { ReactNode } from 'react'
import { Link } from 'react-router'

import type { ApiAidBudget } from '../../../types/api-types'
import { countWords } from '../requests/views'
import { DefRef } from '../kit/DefinitionNotes'
import type { AidView } from '../kit/asOf'
import { CS_BODY, CS_CARD, CS_LABEL, CS_MUTED, CS_SMALL } from '../kit/csType'
import { formatMoney } from '../kit/money'
import { AidDefinitionNotes } from '../shell/AidDefinitionNotes'
import { belowTheLine, budgetTypeLines, scopePool, stripRounds } from './budgetModel'
import { BudgetTypeLines } from './BudgetTypeLines'
import { demandGroups } from './demandModel'
import {
  belowSummary,
  demandSummary,
  HOW_BODY,
  HOW_NO_RULES,
  HOW_SUMMARY,
  howLabel,
  lineKey,
  notesLabel,
  standsSummary,
  typesSummary,
  type FoldLineKey,
} from './foldLinesModel'
import { ForwardDemand } from './ForwardDemand'

const SURFACE = 'season-rounds-budget'
const NOTES_COUNT = 13

function Line({
  id,
  label,
  summary,
  open,
  onToggle,
  children,
}: {
  id: FoldLineKey
  label: ReactNode
  summary: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div data-fold-line={id} className="border-border border-b last:border-b-0">
      <div className="grid grid-cols-[300px_minmax(0,1fr)] items-baseline gap-x-3 py-1.5">
        <button type="button" className={`${CS_LABEL} text-left`} onClick={onToggle}>
          {open ? '▾ ' : '▸ '}
          {label}
        </button>
        <span className={CS_MUTED}>{summary}</span>
      </div>
      {open && <div className={`${CS_BODY} pb-2`}>{children}</div>}
    </div>
  )
}

/** Everything else on the tab, one line each, closed by default (spec §5.2 F). */
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
  const n = (key: string) => {
    const at = numberOf(key)
    return at === null ? null : <DefRef n={at} />
  }
  const is = (key: FoldLineKey) => open.has(lineKey(key))
  const toggle = (key: FoldLineKey) => () => onToggle(lineKey(key))
  const rules = budget.rules_version !== null
  const demand = demandGroups(budget, pool, view)
  const types = budgetTypeLines(budget, pool)
  return (
    <section data-testid="fold-lines" className={CS_CARD}>
      <Line
        id="how"
        label={
          <>
            {howLabel(budget.rules_version)}
            {rules && n('share')}
          </>
        }
        summary={rules ? HOW_SUMMARY : HOW_NO_RULES}
        open={is('how')}
        onToggle={toggle('how')}
      >
        {rules ? HOW_BODY : HOW_NO_RULES}
      </Line>
      <Line
        id="stands"
        label="Where each round stands"
        summary={standsSummary(budget.strip)}
        open={is('stands')}
        onToggle={toggle('stands')}
      >
        {pool !== null && (
          <div className={`${CS_SMALL} font-semibold`}>All pools · the whole season</div>
        )}
        {stripRounds(budget.strip, view).map((round) => (
          <div key={round.round} className="flex flex-wrap items-baseline gap-x-2">
            <b>{`Round ${String(round.round)}`}</b>
            {round.counts.map((count, i) => (
              <span key={count.measure} className="whitespace-nowrap">
                {i > 0 && <span className="text-muted-foreground mr-2">·</span>}
                <span className="text-muted-foreground">{count.label}</span>{' '}
                {count.href === null ? (
                  countWords(count.count)
                ) : (
                  <Link to={count.href} className="text-primary font-semibold hover:underline">
                    {countWords(count.count)}
                  </Link>
                )}
              </span>
            ))}
          </div>
        ))}
      </Line>
      <Line
        id="below"
        label={
          <>
            Shown, not counted against the budget
            {n('below_the_line')}
          </>
        }
        summary={belowSummary(budget, pool)}
        open={is('below')}
        onToggle={toggle('below')}
      >
        {belowTheLine(budget, pool, view).map((line) => {
          // Held carries a count and no amount (unknown until resolved); every other line is its dollars.
          const alone = line.amount === null && line.count !== null
          const figure = alone
            ? countWords(line.count)
            : line.amount !== null && formatMoney(line.amount)
          return (
            <div key={line.key} data-below-line={line.key} className="flex flex-wrap gap-x-2">
              <span>
                {!alone && line.count !== null
                  ? `${line.label} (${countWords(line.count)})`
                  : line.label}
              </span>
              {figure !== false && (
                <span className="tabular-nums">
                  {line.href === null ? (
                    figure
                  ) : (
                    <Link to={line.href} className="text-primary font-semibold hover:underline">
                      {figure}
                    </Link>
                  )}
                </span>
              )}
              {line.note !== null && <span className="text-muted-foreground">{line.note}</span>}
            </div>
          )
        })}
      </Line>
      {demand.length > 0 && (
        <Line
          id="demand"
          label="Demand still to come"
          summary={demandSummary(scope)}
          open={is('demand')}
          onToggle={toggle('demand')}
        >
          <ForwardDemand groups={demand} numberOf={numberOf} />
        </Line>
      )}
      {types.length > 0 && (
        <Line
          id="types"
          label="In the budget, by decision type"
          summary={typesSummary(scope)}
          open={is('types')}
          onToggle={toggle('types')}
        >
          <BudgetTypeLines lines={types} />
        </Line>
      )}
      <Line
        id="notes"
        label={notesLabel(NOTES_COUNT)}
        summary="what each figure means"
        open={is('notes')}
        onToggle={toggle('notes')}
      >
        <AidDefinitionNotes surface={SURFACE} />
      </Line>
    </section>
  )
}
