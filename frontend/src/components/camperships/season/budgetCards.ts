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
  NO_POOL,
  TOTAL_POOL,
  type BudgetRow,
} from './budgetModel'
import { moved, type Preview } from './planModel'

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

/** One card per rules pool (those the rules allocate, plus any with Committed money), in the server's order; No pool is its own slim card. */
export function poolCards(budget: ApiAidBudget, pool: string | null): PoolCardModel[] {
  return budget.pools
    .filter((p) => p.pool !== NO_POOL && (pool === null || p.pool === pool))
    .filter(
      (p) =>
        pool !== null ||
        p.total.allocated !== null ||
        p.share_pct != null ||
        // A pool the rules dropped after a round posted to it keeps its Committed money on show.
        (budget.rules_version !== null && toCents(p.total.committed ?? 0) !== 0)
    )
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

const words = (row: BudgetRow, column: 'posted' | 'accepted' | 'needs_offer') => {
  const money = formatMoney(cellValue(row, column))
  const count = cellCount(row, column)
  return count === null ? money : `${String(count.requests)} · ${money}`
}

/** One figure of the ledger: its words, where it opens (null: nothing), and the amber/title a Not yet confirmed carries. */
export interface LedgerFigure {
  readonly words: string
  readonly href: string | null
  readonly amber?: boolean
  readonly title?: string
}

export interface LedgerRow {
  readonly key: string
  readonly kind: 'pool' | 'round' | 'nopool' | 'foot'
  /** The pool this row belongs to (the toggle's key); '*' on the foot. */
  readonly pool: string
  readonly label: string
  readonly title?: string
  readonly committed: number | null
  readonly posted: LedgerFigure
  readonly accepted: LedgerFigure
  readonly needsOffer: LedgerFigure
  /** Null where the row has no Round 3 to hold one. */
  readonly pending: LedgerFigure | null
  /** Null on a round with nothing posted and nothing unconfirmed (an empty cell). */
  readonly unconfirmed: LedgerFigure | null
}

const holdsMoney = (value: number | null | undefined) =>
  value !== null && value !== undefined && toCents(value) !== 0

/** The five What-is-committed figures of one row; `links` is false on the totals and No pool, which open nothing. */
function ledgerRow(
  row: BudgetRow,
  kind: LedgerRow['kind'],
  view: AidView,
  opts: { links: boolean; pending: boolean; who: string; title?: string }
): LedgerRow {
  const href = (r: BudgetRow, column: 'posted' | 'accepted' | 'needs_offer') =>
    opts.links ? cellHref(r, column, view, null) : null
  const count = row.cell.pending_approval_count
  const pending = opts.pending
    ? {
        words: `${count == null ? '' : `${String(count.requests)} · `}${formatMoney(row.cell.pending_approval)}`,
        href: href({ ...row, kind: 'pending' }, 'needs_offer'),
      }
    : null
  const unc = row.cell.unconfirmed
  const amount = unc == null ? null : unc.amount
  const empty = kind === 'round' && !holdsMoney(amount) && !holdsMoney(cellValue(row, 'posted'))
  const amber = holdsMoney(amount) && (amount ?? 0) > 0
  const where = row.kind === 'round' ? `Round ${String(row.round)}` : 'rounds'
  return {
    key: row.key,
    kind,
    pool: row.pool,
    label: row.label,
    ...(opts.title === undefined ? {} : { title: opts.title }),
    committed: row.cell.committed ?? null,
    posted: { words: formatMoney(cellValue(row, 'posted')), href: href(row, 'posted') },
    accepted: { words: formatMoney(cellValue(row, 'accepted')), href: href(row, 'accepted') },
    needsOffer: { words: words(row, 'needs_offer'), href: href(row, 'needs_offer') },
    pending,
    unconfirmed: empty
      ? null
      : {
          words: unc == null ? (view.asOf.kind === 'past' ? '—' : '$0') : formatMoney(unc.amount),
          href: opts.links ? confirmedHref(row, view) : null,
          ...(amber
            ? {
                amber: true,
                title: `${formatMoney(amount)} of ${opts.who}'s posted ${where} isn't in CampMinder's camp aid yet. Remaining still subtracts all of Posted.`,
              }
            : {}),
        },
  }
}

const hasPending = (pool: ApiAidBudgetPool) =>
  pool.rounds.some((r) => r.round === 3 || holdsMoney(r.pending_approval))

/**
 * The ruled ledger (rounds-1, -2, -3): each pool as a row that opens into its rounds, a muted No pool row when money
 * sits there, then the season (or the one pool, "<Pool> only") in the green band. Every row carries the five
 * What-is-committed figures; a pool's and a round's link, a total's and No pool's do not. Allocated and Remaining are
 * the cards', never a round's (§8.1).
 */
export function ledgerRows(
  budget: ApiAidBudget,
  pool: string | null,
  view: AidView,
  open: ReadonlySet<string>
): LedgerRow[] {
  const out: LedgerRow[] = []
  for (const card of poolCards(budget, pool)) {
    const model = budget.pools.find((p) => p.pool === card.key)
    if (model === undefined) continue
    const rows = budgetRows(budget, { pool: card.key, folded: new Set() })
    const total = rows.find((r) => r.kind === 'pool')
    if (total === undefined) continue
    out.push(
      ledgerRow(total, 'pool', view, { links: true, pending: hasPending(model), who: card.label })
    )
    if (!open.has(card.key)) continue
    for (const row of rows.filter((r) => r.kind === 'round')) {
      out.push(
        ledgerRow(row, 'round', view, {
          links: true,
          pending: row.round === 3 || holdsMoney(row.cell.pending_approval),
          who: card.label,
        })
      )
    }
  }
  const none = budget.pools.find((p) => p.pool === NO_POOL)
  if (pool === null && none !== undefined && noPoolCommitted(budget) !== null) {
    out.push(
      ledgerRow(
        {
          key: 'nopool',
          kind: 'pool',
          pool: NO_POOL,
          poolLabel: none.label,
          label: none.label,
          round: null,
          cell: none.total,
        },
        'nopool',
        view,
        {
          links: false,
          pending: hasPending(none),
          who: 'No pool',
          title:
            'No pool: a program the rules give no pool. No allocation of its own; its money counts in the season total only',
        }
      )
    )
  }
  const scope = pool === null ? budget.total : budget.pools.find((p) => p.pool === pool)
  if (scope !== undefined) {
    out.push(
      ledgerRow(
        {
          key: 'total',
          kind: 'total',
          pool: TOTAL_POOL,
          poolLabel: scope.label,
          label: pool === null ? 'Season total' : `${scope.label} only`,
          round: null,
          cell: scope.total,
        },
        'foot',
        view,
        {
          links: false,
          pending: hasPending(scope),
          who: pool === null ? 'the season' : scope.label,
          title: pool === null ? 'Every pool, No pool included' : 'This page shows one pool',
        }
      )
    )
  }
  return out
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

/** Whether the typed plan moves any Allocated from the read's (the one amber "preview" pill says so, rounds-13). */
export function previewMoves(budget: ApiAidBudget, preview: Preview | null): boolean {
  if (preview === null) return false
  if (moved(budget.total.total.allocated, preview.total.allocated)) return true
  return budget.pools.some((p) => {
    const shown = preview.pools[p.pool]
    return shown !== undefined && moved(p.total.allocated, shown.allocated)
  })
}
