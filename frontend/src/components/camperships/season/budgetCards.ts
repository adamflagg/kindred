/**
 * Rounds & budget's cards (spec §5.2; budget-v9.html, Last year's split off): lead with the budget, then one card per
 * pool, rounds folded inside. Pure layout over the server's figures (D21): widths, captions, legends, links. Rounds
 * carry what they committed and never an Allocated or a Remaining (§8.1); a pool past its share is amber (§8.3).
 */
import type { ApiAidBudget, ApiAidBudgetPool } from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import { formatMoney, moneyCsv, toCents } from '../kit/money'
import {
  budgetRows,
  cellCount,
  cellHref,
  cellValue,
  confirmedHref,
  confirmedWords,
  NO_POOL,
  TOTAL_POOL,
  type BudgetRow,
} from './budgetModel'
import type { Preview } from './planModel'

export interface RoundPart {
  readonly round: 1 | 2 | 3
  readonly committed: number
}

export interface PoolCardModel {
  readonly key: string
  readonly label: string
  readonly share: number | null
  readonly allocated: number | null
  readonly committed: number | null
  readonly remaining: number | null
  /** Remaining below $0 on a pool: amber "over its share" (D74 amended). */
  readonly overShare: boolean
  /** Each round's committed above $0, in round order. */
  readonly parts: RoundPart[]
}

const below = (value: number | null | undefined) =>
  value !== null && value !== undefined && toCents(value) < 0

function partsOf(pool: ApiAidBudgetPool): RoundPart[] {
  return [...pool.rounds]
    .sort((a, b) => a.round - b.round)
    .filter((r) => (r.committed ?? 0) > 0)
    .map((r) => ({ round: r.round as 1 | 2 | 3, committed: r.committed ?? 0 }))
}

function cardOf(pool: ApiAidBudgetPool): PoolCardModel {
  return {
    key: pool.pool,
    label: pool.label,
    share: pool.share_pct ?? null,
    allocated: pool.total.allocated,
    committed: pool.total.committed ?? null,
    remaining: pool.total.remaining,
    overShare: below(pool.total.remaining),
    parts: partsOf(pool),
  }
}

/** One card per rules pool (those the rules allocate), in the server's order; No pool is its own slim card. */
export function poolCards(budget: ApiAidBudget, pool: string | null): PoolCardModel[] {
  return budget.pools
    .filter((p) => p.pool !== NO_POOL && (pool === null || p.pool === pool))
    .filter((p) => pool !== null || p.total.allocated !== null || p.share_pct != null)
    .map(cardOf)
}

/** What No pool committed, when money sits there (§5.2 E); else null and the card is absent. */
export function noPoolCommitted(budget: ApiAidBudget): number | null {
  const none = budget.pools.find((p) => p.pool === NO_POOL)
  const committed = none?.total.committed ?? null
  return committed !== null && toCents(committed) !== 0 ? committed : null
}

export interface BarSegment {
  readonly key: string
  readonly grow: number
  /** The fill, % of the segment: min(Committed, Allocated) on max(Allocated, Committed). */
  readonly fillPct: number
  /** Past Allocated, % of the segment: amber stripes. */
  readonly overPct: number
}

/** The budget bar (§5.2 A): a segment per pool grown by its Allocated; a red overage segment when the total is below $0. */
export function budgetBar(
  cards: readonly PoolCardModel[],
  totalRemaining: number | null
): { segments: BarSegment[]; overGrow: number | null } {
  const segments = cards.map((card) => {
    const allocated = card.allocated ?? 0
    const committed = card.committed ?? 0
    const base = Math.max(allocated, committed) || 1
    return {
      key: card.key,
      grow: Math.max(allocated, 1),
      fillPct: (100 * Math.min(committed, allocated)) / base,
      overPct: committed > allocated ? (100 * (committed - allocated)) / base : 0,
    }
  })
  return { segments, overGrow: below(totalRemaining) ? -(totalRemaining ?? 0) : null }
}

/** A pool's bar (§5.2 C): Round 1, 2, 3 end to end on max(Allocated, Committed); stripes and an end marker past Allocated. */
export function poolBar(card: PoolCardModel): {
  fills: Array<{ round: 1 | 2 | 3; leftPct: number; widthPct: number }>
  overLeftPct: number | null
  overWidthPct: number
} {
  const allocated = card.allocated ?? 0
  const committed = card.committed ?? 0
  const base = Math.max(allocated, committed) || 1
  let left = 0
  const fills = card.parts.map((part) => {
    const fill = {
      round: part.round,
      leftPct: (100 * left) / base,
      widthPct: (100 * part.committed) / base,
    }
    left += part.committed
    return fill
  })
  const over = committed > allocated && allocated > 0
  return {
    fills,
    overLeftPct: over ? (100 * allocated) / base : null,
    overWidthPct: over ? (100 * (committed - allocated)) / base : 0,
  }
}

const pct = (share: number | null) => (share === null ? '' : `${String(share)}%`)

export function shareCaption(cards: readonly PoolCardModel[]): { first: string; rest: string } {
  const [first, ...rest] = cards
  return {
    first: first === undefined ? '' : `${first.label} ${pct(first.share)}`,
    rest: rest.map((c) => `${c.label} ${pct(c.share)}`).join(' · '),
  }
}

/** "Round 1 $684,353" per round above $0; null when nothing is committed ("nothing committed yet"). */
export function roundLegend(card: PoolCardModel): string[] | null {
  if (card.parts.length === 0) return null
  return card.parts.map((part) => `Round ${String(part.round)} ${formatMoney(part.committed)}`)
}

export interface RoundLine {
  readonly round: number
  readonly committed: number | null
  readonly parts: Array<{ label: string; note: string; words: string; href: string | null }>
  readonly confirmed: { words: string; href: string | null } | null
}

const words = (row: BudgetRow, column: 'posted' | 'accepted' | 'needs_offer') => {
  const money = formatMoney(cellValue(row, column))
  const count = cellCount(row, column)
  return count === null ? money : `${String(count.requests)} · ${money}`
}

/**
 * The folded rounds table (§5.2 D): Round · Committed · What is committed. Every figure links as today's cellHref:
 * Posted and Accepted open All on the round's figure; Needs an offer and Pending approval their views, live only.
 * Pending approval shows on Round 3 and on any round where it is above $0 (D79).
 */
export function roundLines(budget: ApiAidBudget, poolKey: string, view: AidView): RoundLine[] {
  const rows = budgetRows(budget, {
    pool: poolKey === TOTAL_POOL ? null : poolKey,
    folded: new Set(),
  })
  const scoped = rows.filter((r) => r.pool === poolKey)
  return scoped
    .filter((r) => r.kind === 'round')
    .map((row) => {
      const pending = scoped.find((r) => r.kind === 'pending' && r.round === row.round)
      const parts = [
        {
          label: 'Posted',
          note: 'budget_posted',
          words: formatMoney(cellValue(row, 'posted')),
          href: cellHref(row, 'posted', view, null),
        },
        {
          label: 'of it accepted',
          note: 'accepted',
          words: formatMoney(cellValue(row, 'accepted')),
          href: cellHref(row, 'accepted', view, null),
        },
        {
          label: 'needs an offer',
          note: 'needs_offer',
          words: words(row, 'needs_offer'),
          href: cellHref(row, 'needs_offer', view, null),
        },
      ]
      if (row.round === 3 || pending !== undefined) {
        const target = pending ?? { ...row, kind: 'pending' as const }
        const count = target.cell.pending_approval_count
        parts.push({
          label: 'pending approval',
          note: 'pending_approval',
          words: `${count == null ? '' : `${String(count.requests)} · `}${formatMoney(target.cell.pending_approval)}`,
          href: cellHref(target, 'needs_offer', view, null),
        })
      }
      const confirmed = confirmedWords(row)
      return {
        round: row.round ?? 0,
        committed: row.cell.committed ?? null,
        parts,
        confirmed: confirmed === null ? null : { words: confirmed, href: confirmedHref(row, view) },
      }
    })
}

export const BUDGET_CSV_HEADERS = [
  'Pool',
  'Round',
  'Share %',
  'Allocated',
  'Committed',
  'Posted',
  'Accepted',
  'Needs an offer',
  'Needs an offer requests',
  'Pending approval',
  'Pending approval requests',
  'Remaining',
]

const countCsv = (count: { requests: number } | null | undefined) =>
  count == null ? '' : String(count.requests)

/** Every pool, its three rounds and the total, whatever is folded (§5.2 H); a one-pool page: that pool and its rounds. */
export function budgetCsvRows(budget: ApiAidBudget, pool: string | null): string[][] {
  const pools =
    pool === null ? [...budget.pools, budget.total] : budget.pools.filter((p) => p.pool === pool)
  return pools.flatMap((p) => [
    [
      p.label,
      '',
      p.share_pct == null ? '' : String(p.share_pct),
      moneyCsv(p.total.allocated),
      moneyCsv(p.total.committed),
      moneyCsv(p.total.posted),
      moneyCsv(p.total.accepted),
      moneyCsv(p.total.needs_offer),
      countCsv(p.total.needs_offer_count),
      moneyCsv(p.total.pending_approval),
      countCsv(p.total.pending_approval_count),
      moneyCsv(p.total.remaining),
    ],
    ...[...p.rounds]
      .sort((a, b) => a.round - b.round)
      .map((r) => [
        p.label,
        String(r.round),
        '',
        '',
        moneyCsv(r.committed),
        moneyCsv(r.posted),
        moneyCsv(r.accepted),
        moneyCsv(r.needs_offer),
        countCsv(r.needs_offer_count),
        moneyCsv(r.pending_approval),
        countCsv(r.pending_approval_count),
        '',
      ]),
  ])
}

/** The cards as the typed plan would draw them (§5.2 B): Allocated and Remaining move, Committed never does. */
export function withPreview(
  cards: readonly PoolCardModel[],
  preview: Preview | null
): PoolCardModel[] {
  if (preview === null) return [...cards]
  return cards.map((card) => {
    const shown = preview.pools[card.key]
    return shown === undefined
      ? card
      : {
          ...card,
          allocated: shown.allocated,
          remaining: shown.remaining,
          overShare: toCents(shown.remaining) < 0,
        }
  })
}
