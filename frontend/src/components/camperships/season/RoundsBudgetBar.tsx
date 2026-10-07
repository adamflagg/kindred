import type { BarSegment, PoolCardModel } from './budgetCards'
import { poolBar } from './budgetCards'

export const AMBER_STRIPES =
  'bg-[repeating-linear-gradient(45deg,var(--color-amber-500)_0_3px,var(--color-amber-200)_3px_6px)] dark:bg-[repeating-linear-gradient(45deg,var(--color-amber-400)_0_3px,var(--color-amber-800)_3px_6px)]'
const RED_STRIPES =
  'bg-[repeating-linear-gradient(45deg,var(--color-red-600)_0_3px,var(--color-red-300)_3px_6px)] dark:bg-[repeating-linear-gradient(45deg,var(--color-red-400)_0_3px,var(--color-red-800)_3px_6px)]'
/** Round 1 in primary, Round 2 at 55% into the card, Round 3 at 28% (budget-v9). */
const ROUND_FILL: Readonly<Record<1 | 2 | 3, string>> = {
  1: 'bg-primary',
  2: 'bg-[color-mix(in_oklab,var(--color-primary)_55%,var(--color-card))]',
  3: 'bg-[color-mix(in_oklab,var(--color-primary)_28%,var(--color-card))]',
}
export const ROUND_SWATCH = ROUND_FILL

/** The Budget card's bar (§5.2 A): 12px, 3px gaps; one segment per pool; a red overage segment past the total. */
export function BudgetBarView({
  segments,
  overGrow,
}: {
  segments: readonly BarSegment[]
  overGrow: number | null
}) {
  return (
    <div data-testid="budget-bar" className="flex h-3 gap-[3px]">
      {segments.map((s) => (
        <div
          key={s.key}
          className="bg-muted relative overflow-hidden rounded-sm"
          style={{ flex: `${String(s.grow)} 1 0` }}
        >
          <i
            className="bg-primary absolute inset-y-0 left-0"
            style={{ width: `${String(s.fillPct)}%` }}
          />
          {s.overPct > 0 && (
            <i
              className={`absolute inset-y-0 ${AMBER_STRIPES}`}
              style={{ left: `${String(s.fillPct)}%`, width: `${String(s.overPct)}%` }}
            />
          )}
        </div>
      ))}
      {overGrow !== null && (
        <div
          className={`relative rounded-sm border-l-2 border-dashed border-red-700 dark:border-red-300 ${RED_STRIPES}`}
          style={{ flex: `${String(overGrow)} 1 0` }}
        />
      )}
    </div>
  )
}

/** A pool's bar (§5.2 C): rounds end to end, then the track; past Allocated, amber stripes and a dashed end marker. */
export function PoolBarView({ card }: { card: PoolCardModel }) {
  const bar = poolBar(card)
  return (
    <div data-testid={`pool-bar-${card.key}`} className="relative h-3">
      <div className="bg-muted relative h-3 overflow-hidden rounded-full">
        {bar.fills.map((f) => (
          <i
            key={f.round}
            className={`absolute inset-y-0 ${ROUND_FILL[f.round]}`}
            style={{ left: `${String(f.leftPct)}%`, width: `${String(f.widthPct)}%` }}
          />
        ))}
        {bar.overLeftPct !== null && (
          <i
            className={`absolute inset-y-0 ${AMBER_STRIPES}`}
            style={{ left: `${String(bar.overLeftPct)}%`, width: `${String(bar.overWidthPct)}%` }}
          />
        )}
      </div>
      {bar.overLeftPct !== null && (
        <b
          data-testid="pool-bar-over"
          className="absolute -top-[3px] -bottom-[3px] border-l-2 border-dashed border-amber-600 dark:border-amber-300"
          style={{ left: `${String(bar.overLeftPct)}%` }}
        />
      )}
    </div>
  )
}
