import type { ReactNode } from 'react'
import { Link } from 'react-router'

import type { ApiAidBudget } from '../../../types/api-types'
import { DefRef } from '../kit/DefinitionNotes'
import { aidHref, type AidView } from '../kit/asOf'
import { CS_BTN_SM, CS_CARD, CS_CARD_TITLE, CS_MUTED, CS_PILL, CS_SMALL } from '../kit/csType'
import { Money } from '../kit/MoneyText'
import { roundLegend, withPreview, type PoolCardModel } from './budgetCards'
import { Figure } from './BudgetCard'
import type { Preview } from './planModel'
import { PoolBarView, ROUND_SWATCH } from './RoundsBudgetBar'
import { RoundsTable } from './RoundsTable'

export function PoolCard({
  card,
  budget,
  view,
  open,
  onToggle,
  numberOf,
  preview,
  editing,
  canPlan,
  onEditPlan,
  scopedPills,
}: {
  card: PoolCardModel
  budget: ApiAidBudget
  view: AidView
  open: ReadonlySet<string>
  onToggle: (key: string) => void
  numberOf: (key: string) => number | null
  preview: Preview | null
  editing: boolean
  canPlan: boolean
  onEditPlan: () => void
  /** On a one-pool page, the scope's pills (no rules, past date). */
  scopedPills: ReactNode
}) {
  const n = (key: string) => {
    const at = numberOf(key)
    return at === null ? null : <DefRef n={at} />
  }
  // The card as the typed plan draws it (spec §5.2 B): figures AND bar move while Edit Plan… is open.
  const drawn = withPreview([card], preview)[0] ?? card
  const allocated = drawn.allocated
  const remaining = drawn.remaining
  const over = remaining !== null && remaining < 0
  const legend = roundLegend(card)
  const isOpen = open.has(card.key)
  return (
    <section data-testid={`pool-card-${card.key}`} className={CS_CARD}>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <button type="button" className={CS_CARD_TITLE} onClick={() => onToggle(card.key)}>
          {`${isOpen ? '▾' : '▸'} ${card.label}`}
        </button>
        {card.share !== null && (
          <span className={CS_MUTED}>{`${String(card.share)}% of the budget`}</span>
        )}
        {scopedPills}
        {editing && <span className={CS_PILL.amber}>preview</span>}
        <span className="ml-auto flex flex-wrap items-baseline gap-x-3.5">
          <span>
            <span className="text-muted-foreground">Allocated{n('allocated')}</span>{' '}
            {allocated === null || budget.rules_version === null ? (
              <Money value={allocated} />
            ) : (
              <Link
                to={aidHref('/aid/season/rules', view, {
                  version: String(budget.rules_version),
                  section: 'budget',
                })}
                className="text-primary border-primary/60 border-b border-dotted"
              >
                <Figure value={allocated} server={card.allocated} />
              </Link>
            )}
          </span>
          <span>
            <span className="text-muted-foreground">Committed{n('committed')}</span>{' '}
            <Money value={card.committed} />
          </span>
          <span data-testid="pool-remaining">
            <span className="text-muted-foreground">Remaining{n('remaining')}</span>{' '}
            <b>
              <Figure value={remaining} server={card.remaining} tone="pool" />
            </b>
            {over && <span className={`${CS_PILL.amber} ml-1.5`}>over its share</span>}
            {over && canPlan && !editing && (
              <button type="button" className={`${CS_BTN_SM} ml-1.5`} onClick={onEditPlan}>
                Edit Plan…
              </button>
            )}
          </span>
        </span>
      </div>
      <div className="mt-2">
        <PoolBarView card={drawn} />
      </div>
      <div className={`${CS_SMALL} mt-1`}>
        {legend === null
          ? 'nothing committed yet'
          : card.parts.map((part, i) => (
              <span key={part.round}>
                {i > 0 && ' · '}
                <i
                  className={`mr-1 inline-block size-2 rounded-[2px] ${ROUND_SWATCH[part.round]}`}
                />
                {legend[i]}
              </span>
            ))}
      </div>
      {isOpen && <RoundsTable budget={budget} poolKey={card.key} view={view} numberOf={numberOf} />}
    </section>
  )
}

/** Money on a program the rules give no pool (§5.2 E): a slim card, only when it holds money; its figures open nothing. */
const NO_POOL_CARD = CS_CARD.replace('py-3', 'py-2')

export function NoPoolCard({ committed }: { committed: number }) {
  return (
    <section data-testid="no-pool-card" className={NO_POOL_CARD}>
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        <span className={`${CS_CARD_TITLE} text-muted-foreground`}>No pool</span>
        <span className={CS_MUTED}>no allocation of its own · counted in the total only</span>
        <span className="ml-auto flex gap-x-3.5">
          <span>
            <span className="text-muted-foreground">Committed</span> <Money value={committed} />
          </span>
          <span>
            <span className="text-muted-foreground">Remaining</span> —
          </span>
        </span>
      </div>
    </section>
  )
}
