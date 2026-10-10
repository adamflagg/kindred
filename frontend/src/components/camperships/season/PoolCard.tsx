import type { ApiAidBudget } from '../../../types/api-types'
import { AidFoldCard, AidMeter, type MeterSegment } from '../kit/Cards'
import type { AidView } from '../kit/asOf'
import { CS_PILL } from '../kit/csType'
import { formatMoney } from '../kit/money'
import { poolBar, withPreview, type PoolCardModel } from './budgetCards'
import { cardFigures } from './BudgetCard'
import type { Preview } from './planModel'

const OVER_WORDS =
  'Over its share: this pool has committed more than its share while the season may still have money'

/** A pool's compact card (kit §10): its share, a meter of its rounds against its allocation, Allocated · Committed · Remaining. */
export function PoolCard({
  card,
  budget,
  view,
  numberOf,
  preview,
}: {
  card: PoolCardModel
  budget: ApiAidBudget
  view: AidView
  numberOf: (key: string) => number | null
  preview: Preview | null
}) {
  // The card as the typed plan draws it (spec §5.2 B): figures AND meter move while Edit Plan… is open.
  const drawn = withPreview([card], preview)[0] ?? card
  const remaining = drawn.remaining
  const over = remaining !== null && remaining < 0
  const bar = poolBar(drawn)
  const segments: MeterSegment[] =
    drawn.allocated === null
      ? []
      : [
          ...bar.fills.map((f) => ({
            tone: `r${String(f.round)}` as 'r1' | 'r2' | 'r3',
            left: f.leftPct,
            width: f.widthPct,
          })),
          ...(bar.overLeftPct === null
            ? []
            : [{ tone: 'over' as const, left: bar.overLeftPct, width: bar.overWidthPct }]),
        ]
  const title =
    drawn.allocated === null
      ? `${card.label}: no allocation yet, so nothing to measure against`
      : `${card.label}: ${String(
          drawn.allocated === 0 ? 0 : Math.round((100 * (drawn.committed ?? 0)) / drawn.allocated)
        )}% of its allocation committed · ${
          card.parts
            .map((p) => `Round ${String(p.round)} ${formatMoney(p.committed)}`)
            .join(' · ') || 'nothing committed yet'
        }`
  return (
    <AidFoldCard
      shape="compact"
      testId={`pool-card-${card.key}`}
      title={card.label}
      meta={card.share === null ? '' : `${String(card.share)}%`}
      metaTitle={`${card.label}: ${String(card.share)}% of the budget`}
      pills={[
        over && (
          <span
            key="over"
            className={CS_PILL.amber}
            title="Committed is past this pool's share. Only the season total is a cap; Edit Plan… moves money between pools"
          >
            over its share
          </span>
        ),
      ]}
      figures={cardFigures({
        budget,
        view,
        numberOf,
        allocated: drawn.allocated,
        serverAllocated: card.allocated,
        committed: card.committed,
        remaining,
        serverRemaining: card.remaining,
        tone: 'pool',
        remainingId: 'pool-remaining',
        remainingTitle: over ? OVER_WORDS : undefined,
      })}
      bar={<AidMeter segments={segments} title={title} />}
    />
  )
}
