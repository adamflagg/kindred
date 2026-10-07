import type { ReactNode } from 'react'
import { Link } from 'react-router'

import type { ApiAidBudget } from '../../../types/api-types'
import { DefRef } from '../kit/DefinitionNotes'
import { aidHref, type AidView } from '../kit/asOf'
import { CS_BTN_SM, CS_CARD, CS_CARD_TITLE, CS_META, CS_PILL, CS_SMALL } from '../kit/csType'
import { NEGATIVE_INK, POOL_NEGATIVE_INK } from '../kit/aidStyles'
import { formatMoney, isNegativeMoney, toCents } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { budgetBar, poolCards, shareCaption, withPreview } from './budgetCards'
import { moved, type Preview } from './planModel'
import { BudgetBarView } from './RoundsBudgetBar'
import { RoundsTable } from './RoundsTable'

/** A figure the typed plan moved (§5.2 B): amber-100 at 75% with a 2px amber-500 underline. */
export const MOVED =
  'rounded-sm bg-amber-100/75 shadow-[inset_0_-2px_0_var(--color-amber-500)] dark:bg-amber-900/55 dark:text-amber-100'

export function Figure({
  value,
  server,
  tone,
}: {
  value: number | null
  server: number | null
  tone?: 'pool' | undefined
}) {
  const isMoved = moved(server, value)
  return (
    <span
      data-moved={isMoved ? '' : undefined}
      className={[
        'tabular-nums',
        isNegativeMoney(value) ? (tone === 'pool' ? POOL_NEGATIVE_INK : NEGATIVE_INK) : '',
        isMoved ? MOVED : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {formatMoney(value)}
    </span>
  )
}

export function BudgetCard({
  budget,
  view,
  open,
  onToggle,
  numberOf,
  preview,
  editing,
  draftPill,
  canPlan,
  onEditPlan,
  children,
}: {
  budget: ApiAidBudget
  view: AidView
  open: ReadonlySet<string>
  onToggle: (key: string) => void
  numberOf: (key: string) => number | null
  preview: Preview | null
  editing: boolean
  draftPill: string | null
  canPlan: boolean
  onEditPlan: () => void
  children?: ReactNode
}) {
  const n = (key: string) => {
    const at = numberOf(key)
    return at === null ? null : <DefRef n={at} />
  }
  const rules = budget.rules_version !== null
  const total = budget.total.total
  const allocated = preview?.total.allocated ?? total.allocated
  const remaining = preview?.total.remaining ?? total.remaining
  const past = view.asOf.kind === 'past'
  const cards = withPreview(poolCards(budget, null), preview)
  const bar = budgetBar(cards, remaining)
  const caption = shareCaption(cards)
  const isOpen = open.has('budget')
  const over = remaining !== null && toCents(remaining) < 0
  return (
    <section data-testid="budget-card" className={CS_CARD}>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        {rules ? (
          <button type="button" className={CS_CARD_TITLE} onClick={() => onToggle('budget')}>
            {`${isOpen ? '▾' : '▸'} Budget, ${String(view.year)}`}
          </button>
        ) : (
          <span className={CS_CARD_TITLE}>{`Budget, ${String(view.year)}`}</span>
        )}
        {rules && <span className={CS_META}>{`rules v${String(budget.rules_version)}`}</span>}
        {!rules && <span className={CS_PILL.amber}>no approved rules: nothing allocated yet</span>}
        {past && (
          <span className={CS_PILL.muted}>past date: exact figures only{n('past_date')}</span>
        )}
        {editing && <span className={CS_PILL.amber}>preview</span>}
        {!editing && draftPill !== null && <span className={CS_PILL.amber}>{draftPill}</span>}
        <span className="ml-auto flex flex-wrap items-baseline gap-x-3.5">
          <span>
            <span className="text-muted-foreground">Allocated{n('allocated')}</span>{' '}
            {rules && allocated !== null ? (
              <Link
                to={aidHref('/aid/season/rules', view, {
                  version: String(budget.rules_version),
                  section: 'budget',
                })}
                className="text-primary border-primary/60 border-b border-dotted"
              >
                <Figure value={allocated} server={total.allocated} />
              </Link>
            ) : (
              formatMoney(allocated)
            )}
          </span>
          <span>
            <span className="text-muted-foreground">Committed{n('committed')}</span>{' '}
            <Money value={total.committed ?? null} />
          </span>
          <span data-testid="budget-remaining">
            <span className="text-muted-foreground">Remaining{n('remaining')}</span>{' '}
            <b>
              <Figure value={remaining} server={total.remaining} />
            </b>
            {over && <span className={`${CS_PILL.red} ml-1.5`}>over budget</span>}
          </span>
          {canPlan && rules && !editing && (
            <button type="button" className={CS_BTN_SM} onClick={onEditPlan}>
              Edit Plan…
            </button>
          )}
        </span>
      </div>
      {rules && (
        <>
          <div className="mt-2">
            <BudgetBarView segments={bar.segments} overGrow={bar.overGrow} />
          </div>
          <div className={`${CS_SMALL} mt-1 flex justify-between`}>
            <span>{caption.first}</span>
            <span>{caption.rest}</span>
          </div>
        </>
      )}
      {children}
      {rules && isOpen && (
        <RoundsTable budget={budget} poolKey="*" view={view} numberOf={numberOf} />
      )}
    </section>
  )
}
