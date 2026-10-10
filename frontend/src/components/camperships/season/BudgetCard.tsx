import { Link } from 'react-router'

import type { ApiAidBudget } from '../../../types/api-types'
import { AidFoldCard, AidMeter, AidShareBar, type CardFigure } from '../kit/Cards'
import { DefRef } from '../kit/DefinitionNotes'
import { aidHref, type AidView } from '../kit/asOf'
import { CS_BTN2, CS_PILL } from '../kit/csType'
import { NEGATIVE_INK, POOL_NEGATIVE_INK } from '../kit/aidStyles'
import { formatMoney, isNegativeMoney, toCents } from '../kit/money'
import { AidFilterChip } from '../kit/Toolbar'
import { AidSectionHead } from '../kit/SectionHead'
import { budgetBar, poolCards, withPreview } from './budgetCards'
import { budgetDescription } from './foldLinesModel'
import { moved, type Preview } from './planModel'
import { roundsNote, type RoundsFigure } from './roundsNotes'

/** A figure the typed plan moved (§5.2 B): amber-100 at 75% with a 2px amber-500 underline. */
export const MOVED =
  'rounded-sm bg-amber-100/75 shadow-[inset_0_-2px_0_var(--color-amber-500)] dark:bg-amber-900/55 dark:text-amber-100'

/** The words on a figure that has nothing to measure against (mock NORULES_T). */
export const NO_RULES_TITLE =
  'No approved rules: nothing is allocated until a budget section is approved'

/** Allocated's link into the Rules budget section (the kit card's link ink). */
export const FIGURE_LINK_INK = 'text-primary border-primary/60 border-b border-dotted font-medium'

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

/** A note's mark beside a figure's label, when the registry numbers it on this surface. */
// eslint-disable-next-line react-refresh/only-export-components -- shared by the pool and season cards
export function noteMark(numberOf: (key: string) => number | null, figure: RoundsFigure) {
  const at = roundsNote(numberOf, figure)
  return at === null ? null : <DefRef n={at} />
}

/** Allocated · Committed · Remaining, as a card draws them (the Remaining bold, a link on Allocated). */
// eslint-disable-next-line react-refresh/only-export-components -- shared by the pool and season cards
export function cardFigures({
  budget,
  view,
  numberOf,
  allocated,
  serverAllocated,
  committed,
  remaining,
  serverRemaining,
  tone,
  remainingId,
  remainingTitle,
}: {
  budget: ApiAidBudget
  view: AidView
  numberOf: (key: string) => number | null
  allocated: number | null
  serverAllocated: number | null
  committed: number | null
  remaining: number | null
  serverRemaining: number | null
  tone?: 'pool'
  remainingId: string
  remainingTitle?: string | undefined
}): CardFigure[] {
  const linked = allocated !== null && budget.rules_version !== null
  return [
    {
      label: 'Allocated',
      note: noteMark(numberOf, 'allocated'),
      title: allocated === null ? NO_RULES_TITLE : undefined,
      value: linked ? (
        <Link
          to={aidHref('/aid/season/rules', view, {
            version: String(budget.rules_version),
            section: 'budget',
          })}
          className={FIGURE_LINK_INK}
        >
          <Figure value={allocated} server={serverAllocated} />
        </Link>
      ) : (
        <Figure value={allocated} server={serverAllocated} />
      ),
    },
    {
      label: 'Committed',
      note: noteMark(numberOf, 'committed'),
      value: <Figure value={committed} server={committed} />,
    },
    {
      label: 'Remaining',
      note: noteMark(numberOf, 'remaining'),
      testId: remainingId,
      title: remaining === null ? NO_RULES_TITLE : remainingTitle,
      value: (
        <b>
          <Figure
            value={remaining}
            server={serverRemaining}
            {...(tone === undefined ? {} : { tone })}
          />
        </b>
      ),
    },
  ]
}

/**
 * The Budget heading (kit §19 section head; mock `head()`): "Budget, 2027" and, right after it, the rules version and how the
 * rules count; at the right the amber pills (no approved rules, past date, ONE preview while typing, the rules draft), the
 * one-pool chip and Edit Plan…. Edit Plan… is the kit's 26px button; its editor mounts below this row.
 */
export function BudgetHead({
  budget,
  view,
  editing,
  previewing,
  draftPill,
  canPlan,
  onEditPlan,
  scope,
  onClearScope,
}: {
  budget: ApiAidBudget
  view: AidView
  editing: boolean
  /** The typed plan moves a figure: the one amber preview pill (rounds-13). */
  previewing: boolean
  draftPill: string | null
  canPlan: boolean
  onEditPlan: () => void
  /** The one pool the page shows, by label; null on All pools. */
  scope: string | null
  onClearScope: () => void
}) {
  const rules = budget.rules_version !== null
  const past = view.asOf.kind === 'past'
  return (
    <AidSectionHead
      testId="budget-head"
      title={`Budget, ${String(view.year)}`}
      description={budgetDescription(budget.rules_version)}
      right={
        <>
          {!rules && (
            <span className={CS_PILL.amber}>no approved rules: nothing allocated yet</span>
          )}
          {past && <span className={CS_PILL.muted}>past date: exact figures only</span>}
          {previewing && (
            <span
              className={CS_PILL.amber}
              title="Allocated and Remaining (amber-marked) show the plan you're typing; nothing is saved"
            >
              preview
            </span>
          )}
          {!editing && draftPill !== null && <span className={CS_PILL.amber}>{draftPill}</span>}
          {scope !== null && (
            <AidFilterChip
              title={`You came from a pool's link: this page shows ${scope} only. ✕ shows every pool.`}
              onClear={onClearScope}
            >
              {`${scope} only`}
            </AidFilterChip>
          )}
          {canPlan && !editing && (
            <button
              type="button"
              className={CS_BTN2}
              title="The total and the program split: saves to the rules draft, prices nothing until approved"
              onClick={onEditPlan}
            >
              Edit Plan…
            </button>
          )}
        </>
      }
    />
  )
}

/** The season's compact card in the green band: Allocated · Committed · Remaining over the shares bar (one segment per pool). */
export function SeasonCard({
  budget,
  view,
  numberOf,
  preview,
}: {
  budget: ApiAidBudget
  view: AidView
  numberOf: (key: string) => number | null
  preview: Preview | null
}) {
  const rules = budget.rules_version !== null
  const total = budget.total.total
  const allocated = preview?.total.allocated ?? total.allocated
  const remaining = preview?.total.remaining ?? total.remaining
  const cards = withPreview(poolCards(budget, null), preview)
  const bar = budgetBar(cards, remaining)
  const over = remaining !== null && toCents(remaining) < 0
  return (
    <AidFoldCard
      shape="compact"
      band
      testId="season-card"
      title="Season"
      meta={rules ? '100%' : ''}
      metaTitle="The whole budget: the pools, and any money in No pool"
      pills={[
        over && (
          <span key="over" className={CS_PILL.red}>
            over budget
          </span>
        ),
      ]}
      figures={cardFigures({
        budget,
        view,
        numberOf,
        allocated,
        serverAllocated: total.allocated,
        committed: total.committed ?? null,
        remaining,
        serverRemaining: total.remaining,
        remainingId: 'budget-remaining',
      })}
      bar={
        rules ? (
          <AidShareBar
            segments={[
              ...bar.segments.map((s, i) => ({
                key: s.key,
                grow: s.grow,
                fill: s.fillPct,
                over: s.overPct,
                tone: (['p0', 'p1', 'p2'] as const)[i % 3] ?? 'p0',
                title: `${cards[i]?.label ?? ''}: ${formatMoney(cards[i]?.committed ?? null)} of ${formatMoney(cards[i]?.allocated ?? null)} committed`,
              })),
              ...(bar.overGrow === null
                ? []
                : [
                    {
                      key: 'over',
                      grow: bar.overGrow,
                      fill: 100,
                      over: 0,
                      tone: 'red' as const,
                      title: 'Committed is past the season total',
                    },
                  ]),
            ]}
          />
        ) : (
          <AidMeter segments={[]} title={NO_RULES_TITLE} />
        )
      }
    />
  )
}
