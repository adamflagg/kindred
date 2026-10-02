/**
 * Rounds & budget's rows, words and links (spec §7.2; D44, D53, D79, D82, D153; budget-v5.html C,
 * running-rounds.html). Pure: the server did every sum (D21, `BudgetResponse`); this only lays the
 * figures out and says where each one opens. Nothing here adds, subtracts or recomputes a figure.
 */
import type {
  ApiAidBudget,
  ApiAidBudgetCell,
  ApiAidBudgetPool,
  ApiAidCount,
  ApiAidDecisionTypeLine,
  ApiAidRoundCounts,
} from '../../../types/api-types'
import { aidHref, type AidView } from '../kit/asOf'
import { aidCsvFilename } from '../kit/csv'
import { formatMoney, moneyCsv, toCents } from '../kit/money'
import { REQUEST_VIEWS, type RequestViewKey } from '../requests/views'

/** The server's pool key for money on a program the rules give no pool (budget.py NO_POOL). */
export const NO_POOL = ''
/** The total's pool key (budget.py TOTAL). */
export const TOTAL_POOL = '*'

/** A Requests view's `?view=`, read from slice 1's table, so no link spells a slug of its own. */
export function viewSlug(key: RequestViewKey): string {
  const view = REQUEST_VIEWS.find((v) => v.key === key)
  if (view === undefined) throw new Error(`no Requests view "${key}"`)
  return view.slug
}

/** Today's rule: a count opens its rows only when it holds something. */
function holds(count: ApiAidCount | null): boolean {
  return count !== null && count.requests > 0
}

const requests = (view: AidView, extra: Record<string, string>) =>
  aidHref('/aid/requests', view, extra)

/**
 * Needs an offer, Holds and Pending approval list today's queues, and a past date rebuilds none, so
 * the Requests page refuses them there ("…needs today's data"). A figure the server still sends on
 * a past date opens nothing rather than that refusal; Posted and Accepted open All, which keeps it.
 */
export const opensQueueViews = (view: AidView) => view.asOf.kind !== 'past'

// ── The strip (§7.2; D153) ────────────────────────────────────────────────────

export type StripMeasure = 'needs_offer' | 'posted' | 'accepted' | 'held' | 'pending_approval'

export interface StripCount {
  readonly measure: StripMeasure
  readonly label: string
  readonly count: ApiAidCount | null
  readonly href: string | null
}

export interface StripRound {
  readonly round: number
  readonly counts: readonly StripCount[]
}

const STRIP_LABELS: Readonly<Record<StripMeasure, string>> = {
  needs_offer: 'needs an offer',
  posted: 'posted',
  accepted: 'accepted',
  held: 'held',
  pending_approval: 'pending approval',
}

/**
 * Where a strip count opens (§7.2; D153, owner ruling Group 2c Q3): needs an offer, held and pending
 * approval open their Requests views; posted and accepted open All filtered to that round and tick,
 * slice 1's `round=` and `tick=`, so the list holds the rows the count counts. Every count but held
 * also carries `counted=1` (Decision 6): only rounds that count toward the budget make these figures.
 * Needs an offer and pending approval carry the count's round too: the grid binds `counted` and
 * `round=` to the round in that status (views.ts), so the list is that round's. Held carries no
 * round (its view isn't bound to one). Null where it opens nothing: a queue view on a past date
 * (`opensQueueViews`).
 */
function stripTarget(
  measure: StripMeasure,
  round: number,
  view: AidView
): Record<string, string> | null {
  const queues = opensQueueViews(view)
  switch (measure) {
    case 'needs_offer':
      return queues ? { view: viewSlug('needs_offer'), round: String(round), counted: '1' } : null
    case 'posted':
      return { view: viewSlug('all'), round: String(round), tick: 'posted', counted: '1' }
    case 'accepted':
      return { view: viewSlug('all'), round: String(round), tick: 'accepted', counted: '1' }
    case 'held':
      return queues ? { view: viewSlug('holds') } : null
    case 'pending_approval':
      return queues
        ? { view: viewSlug('pending_approval'), round: String(round), counted: '1' }
        : null
  }
}

/** One line per round: needs an offer · posted · accepted · held, and Round 3's pending approval (D79). */
export function stripRounds(strip: readonly ApiAidRoundCounts[], view: AidView): StripRound[] {
  return [...strip]
    .sort((a, b) => a.round - b.round)
    .map((row) => {
      const measures: StripMeasure[] = ['needs_offer', 'posted', 'accepted', 'held']
      // D79: pending approval is Round 3's; any other round that carries one shows it too.
      if (row.round === 3 || holds(row.pending_approval)) measures.push('pending_approval')
      return {
        round: row.round,
        counts: measures.map((measure) => {
          const count = row[measure]
          const target = stripTarget(measure, row.round, view)
          return {
            measure,
            label: STRIP_LABELS[measure],
            count,
            href: holds(count) && target !== null ? requests(view, target) : null,
          }
        }),
      }
    })
}

// ── The table: pools × rounds (§7.2; D53) ─────────────────────────────────────

export type BudgetColumn = 'allocated' | 'posted' | 'accepted' | 'needs_offer' | 'remaining'

export const BUDGET_COLUMNS: readonly BudgetColumn[] = [
  'allocated',
  'posted',
  'accepted',
  'needs_offer',
  'remaining',
]

/** Each column's header and its note in the registry's `season-rounds-budget` surface (§4.8). */
export const COLUMN_HEADERS: Readonly<Record<BudgetColumn, { header: string; note: string }>> = {
  allocated: { header: 'Allocated', note: 'allocated' },
  posted: { header: 'Posted', note: 'budget_posted' },
  accepted: { header: 'Accepted', note: 'accepted' },
  needs_offer: { header: 'Needs an offer', note: 'needs_offer' },
  remaining: { header: 'Remaining', note: 'remaining' },
}

export type BudgetRowKind = 'pool' | 'round' | 'pending' | 'total'

export interface BudgetRow {
  readonly key: string
  readonly kind: BudgetRowKind
  readonly pool: string
  /** The pool's own label on every line of it, for the CSV. */
  readonly poolLabel: string
  readonly label: string
  readonly round: number | null
  readonly cell: ApiAidBudgetCell
}

export interface BudgetScope {
  /** `?pool=`: the Remaining line opens Rounds & budget on one pool (D48). Null: every pool. */
  readonly pool: string | null
  /** `?fold=`: pools shown as their total line only. */
  readonly folded: ReadonlySet<string>
}

const hasMoney = (value: number | null) => value !== null && toCents(value) !== 0

/**
 * The table's rows, in the server's pool order: each pool's total line, then (unless folded) its
 * rounds, with Pending approval as its own line under the round that holds it (D79); then the
 * total, unless the page is on one pool.
 */
export function budgetRows(budget: ApiAidBudget, scope: BudgetScope): BudgetRow[] {
  const rows: BudgetRow[] = []
  const pools =
    scope.pool === null ? budget.pools : budget.pools.filter((p) => p.pool === scope.pool)
  for (const pool of pools) {
    rows.push({
      key: `${pool.pool}:all`,
      kind: 'pool',
      pool: pool.pool,
      poolLabel: pool.label,
      label: pool.label,
      round: null,
      cell: pool.total,
    })
    if (scope.folded.has(pool.pool)) continue
    for (const round of [...pool.rounds].sort((a, b) => a.round - b.round)) {
      const id = `${pool.pool}:${String(round.round)}`
      rows.push({
        key: id,
        kind: 'round',
        pool: pool.pool,
        poolLabel: pool.label,
        label: `Round ${String(round.round)}`,
        round: round.round,
        cell: round,
      })
      if (hasMoney(round.pending_approval)) {
        rows.push({
          key: `${id}:pending`,
          kind: 'pending',
          pool: pool.pool,
          poolLabel: pool.label,
          label: 'Pending approval',
          round: round.round,
          cell: round,
        })
      }
    }
  }
  if (scope.pool === null) {
    rows.push({
      key: 'total',
      kind: 'total',
      pool: TOTAL_POOL,
      poolLabel: budget.total.label,
      label: budget.total.label,
      round: null,
      cell: budget.total.total,
    })
  }
  return rows
}

/**
 * The figure a row shows in a column. A Pending approval line carries its own amount in the Needs
 * an offer column, and nothing elsewhere (budget-v5.html, running-rounds.html).
 */
export function cellValue(row: BudgetRow, column: BudgetColumn): number | null {
  if (row.kind === 'pending') return column === 'needs_offer' ? row.cell.pending_approval : null
  return row.cell[column]
}

/** Remaining below zero (§4.2): "over allocation" on a pool or round, "over budget" on the total (D119). */
export function overWords(row: BudgetRow, column: BudgetColumn): string | null {
  if (column !== 'remaining' || row.kind === 'pending') return null
  const value = row.cell.remaining
  if (value === null || toCents(value) >= 0) return null
  return row.kind === 'total' ? 'over budget' : 'over allocation'
}

/**
 * Where a figure opens (D20: every figure opens its rows, from the same server query).
 * - Posted and Accepted: All, filtered to the pool, the round and the tick (D153).
 * - Needs an offer and Pending approval: their Requests views, on the pool and, on a round line
 *   (and the Pending approval line under it), that round; the grid binds `counted` and `round=`
 *   to the round in that status (views.ts), so the list is exactly the figure's. A pool or total
 *   line covers every round and carries none.
 * - Allocated: the budget section of the approved version that priced the figure (`?version=`),
 *   keeping the page's past date like every Season tab (I6), and nothing while no version is
 *   approved (Decision 6; plan review I1).
 * Every request link but Holds carries `counted=1`, so it opens only rounds that count (Decision 6).
 * - Remaining: nothing; it is the others' arithmetic.
 * A "No pool" figure opens nothing: no request can be filtered to having no pool. Nor does "—" or $0,
 * nor Needs an offer or Pending approval on a past date (`opensQueueViews`).
 */
export function cellHref(
  row: BudgetRow,
  column: BudgetColumn,
  view: AidView,
  rulesVersion: number | null
): string | null {
  if (!hasMoney(cellValue(row, column)) || row.pool === NO_POOL) return null
  const pool: Record<string, string> = row.pool === TOTAL_POOL ? {} : { pool: row.pool }
  const round: Record<string, string> = row.round === null ? {} : { round: String(row.round) }
  if (row.kind === 'pending') {
    if (!opensQueueViews(view)) return null
    return requests(view, {
      view: viewSlug('pending_approval'),
      ...pool,
      ...round,
      counted: '1',
    })
  }
  switch (column) {
    case 'posted':
      return requests(view, {
        view: viewSlug('all'),
        ...pool,
        ...round,
        tick: 'posted',
        counted: '1',
      })
    case 'accepted':
      return requests(view, {
        view: viewSlug('all'),
        ...pool,
        ...round,
        tick: 'accepted',
        counted: '1',
      })
    case 'needs_offer':
      if (!opensQueueViews(view)) return null
      return requests(view, { view: viewSlug('needs_offer'), ...pool, ...round, counted: '1' })
    case 'allocated':
      // The version that priced the figure: `?version=` always opens the approved read (Decision 31).
      // The page's date rides along, as on every Season tab (I6).
      if (rulesVersion === null) return null
      return aidHref('/aid/season/rules', view, {
        version: String(rulesVersion),
        section: 'budget',
      })
    case 'remaining':
      return null
  }
}

/**
 * The request count a cell shows beside its dollars (read 2; the mock's "nn · $n"). Needs an offer
 * carries `needs_offer_count`, a Pending approval line carries `pending_approval_count`, and every
 * other column has none. Null too where the server sent none (a past date).
 */
export function cellCount(row: BudgetRow, column: BudgetColumn): ApiAidCount | null {
  if (column !== 'needs_offer') return null
  const count =
    row.kind === 'pending' ? row.cell.pending_approval_count : row.cell.needs_offer_count
  return count ?? null
}

/** A cell as the mock words it: "n · $X" with n = requests, or the dollars alone when there is no count. */
export function cellWords(row: BudgetRow, column: BudgetColumn): string {
  const money = formatMoney(cellValue(row, column))
  const count = cellCount(row, column)
  return count === null ? money : `${String(count.requests)} · ${money}`
}

/** A pool or total line's Pending approval, under its Needs an offer (running-rounds.html). */
export function pendingNote(row: BudgetRow): string | null {
  if (row.kind !== 'pool' && row.kind !== 'total') return null
  const pending = row.cell.pending_approval
  if (!hasMoney(pending)) return null
  const count = row.cell.pending_approval_count
  const lead = count == null ? '' : `${String(count.requests)} · `
  return `and ${lead}${formatMoney(pending)} pending approval`
}

/**
 * The amber line under Posted (D153; owner ruling 2026-10-02): "N not yet confirmed · $X", N the
 * server's request count and X the part of the posted rounds' locked money CampMinder's live camp aid
 * doesn't cover yet. Null with nothing to say (no read, or a count of 0), and on the Pending approval
 * line, which shares its round's cell and would say it twice.
 */
export function confirmedWords(row: BudgetRow): string | null {
  const unconfirmed = row.cell.unconfirmed
  if (row.kind === 'pending' || unconfirmed == null || unconfirmed.count === 0) return null
  return `${String(unconfirmed.count)} not yet confirmed · ${formatMoney(unconfirmed.amount)}`
}

/**
 * Where the amber line opens: Requests › Not reconciled, filtered as the Posted figure beside it is
 * (`cellHref`): the row's pool (none for the total), a round line's round, `tick=posted` and
 * `counted=1`, so it keeps only rounds that are posted and count toward the budget, which are the
 * ones the figure counts. Residue the grid can't close: confirmation is per request, not per round,
 * so an over-confirmed request (nothing unconfirmed) or one whose round N is filled while a later
 * round is short can still list. Oldest-first filling makes the second uncommon.
 * Null for the No pool line (no request filters to having no pool), where there is nothing to say,
 * and on a past date, since Not reconciled is today's queue (`opensQueueViews`).
 */
export function confirmedHref(row: BudgetRow, view: AidView): string | null {
  if (confirmedWords(row) === null || row.pool === NO_POOL || !opensQueueViews(view)) return null
  const pool: Record<string, string> = row.pool === TOTAL_POOL ? {} : { pool: row.pool }
  const round: Record<string, string> = row.round === null ? {} : { round: String(row.round) }
  return requests(view, {
    view: viewSlug('not_reconciled'),
    ...pool,
    ...round,
    tick: 'posted',
    counted: '1',
  })
}

// ── Below the line (§5.3, §7.2; D44, D121) ────────────────────────────────────

export interface BelowLine {
  readonly key: string
  readonly label: string
  readonly amount: number | null
  readonly count: ApiAidCount | null
  readonly note: string | null
  readonly href: string | null
}

/** The scope's pool (null: the total), or undefined when `?pool=` names no pool this season has. */
export function scopePool(budget: ApiAidBudget, pool: string | null): ApiAidBudgetPool | undefined {
  return pool === null ? budget.total : budget.pools.find((p) => p.pool === pool)
}

const OUTSIDE_AGGREGATE_LABEL = "Decision types that don't count toward the budget"

const postedNote = (posted: number | null): string | null =>
  posted === null ? null : `${formatMoney(posted)} of it posted`

/**
 * Shown, never counted in Remaining: outside grants (on requests, and on no request for the
 * total), one line per decision type outside the camp's budget (read 3; owner ⚠2: the type's
 * `amount`), and held requests, whose amount isn't known until they are resolved. A scope whose
 * read carries no outside-budget type line but still has outside money keeps one aggregate line;
 * never both.
 */
export function belowTheLine(
  budget: ApiAidBudget,
  pool: string | null,
  view: AidView
): BelowLine[] {
  const scope = scopePool(budget, pool)
  if (scope === undefined) return []
  const below = scope.below
  const onPool: Record<string, string> = pool === null ? {} : { pool }
  const lines: BelowLine[] = [
    {
      key: 'grants',
      label: 'Outside grants on requests',
      amount: below.outside_grants,
      count: below.outside_grants_requests ?? null,
      note: null,
      href: null,
    },
  ]
  if (pool === null) {
    lines.push({
      key: 'grants_off_requests',
      label: 'Outside grants on no request',
      amount: budget.outside_grants_off_requests,
      count: null,
      note: null,
      href: null,
    })
  }
  const outsideTypes = (scope.decision_types ?? []).filter((t) => !t.counts_toward_budget)
  if (outsideTypes.length > 0) {
    for (const type of outsideTypes) {
      lines.push({
        key: `outside_type:${type.key ?? 'none'}`,
        label: type.label,
        amount: type.amount,
        count: type.requests,
        note: postedNote(type.posted),
        href: null,
      })
    }
  } else if (below.outside_budget !== null && toCents(below.outside_budget) !== 0) {
    lines.push({
      key: 'outside_budget',
      label: OUTSIDE_AGGREGATE_LABEL,
      amount: below.outside_budget,
      count: null,
      note: postedNote(below.outside_budget_posted),
      href: null,
    })
  }
  lines.push({
    key: 'held',
    label: 'Held requests',
    amount: null,
    count: below.held,
    note: 'amount unknown until resolved',
    href:
      holds(below.held) && pool !== NO_POOL && opensQueueViews(view)
        ? requests(view, { view: viewSlug('holds'), ...onPool })
        : null,
  })
  return lines
}

// ── In the budget, by decision type (read 3; owner ⚠2) ────────────────────────

export interface TypeLine {
  readonly key: string
  readonly label: string
  /**
   * The type's `own`, which the line leads with (owner ⚠2): its own top-up and discretionary money
   * inside its rounds, posted or not (budget.py DecisionTypeLine.own). Often small or $0; always $0
   * on the "No named decision type" line, which the server sends as it is.
   */
  readonly lead: number | null
  /** The type's `amount`, the Rounds total column: all the money in the rounds it touches. */
  readonly amount: number | null
  /** Requests, not families. */
  readonly count: ApiAidCount | null
}

function typeLine(type: ApiAidDecisionTypeLine): TypeLine {
  return {
    key: `type:${type.key ?? 'none'}`,
    label: type.label,
    lead: type.own,
    amount: type.amount,
    count: type.requests,
  }
}

/**
 * The scope's decision types that count toward the budget, in the server's order, key-null
 * "No named decision type" included (§7.2: unclassified requests get an explicit line). Nothing is
 * added here: each figure is the read's own, null where a past date masks it.
 */
export function budgetTypeLines(budget: ApiAidBudget, pool: string | null): TypeLine[] {
  const scope = scopePool(budget, pool)
  if (scope === undefined) return []
  return (scope.decision_types ?? []).filter((t) => t.counts_toward_budget).map(typeLine)
}

// ── The view's state in the URL (D15) ─────────────────────────────────────────

/** `?fold=pool_a,pool_b`. The No pool line has an empty key, so it never folds. */
export function parseFolded(raw: string | null): ReadonlySet<string> {
  return new Set((raw ?? '').split(',').filter((key) => key !== ''))
}

/** The `fold` parameter after toggling one pool; null when nothing stays folded. */
export function toggleFolded(folded: ReadonlySet<string>, pool: string): string | null {
  const next = new Set(folded)
  if (next.has(pool)) next.delete(pool)
  else next.add(pool)
  return next.size === 0 ? null : [...next].join(',')
}

// ── Download CSV (§11; D70) ───────────────────────────────────────────────────

export const BUDGET_CSV_HEADERS = [
  'Pool',
  'Round',
  'Allocated',
  'Posted',
  'Accepted',
  'Needs an offer',
  'Needs an offer requests',
  'Pending approval',
  'Pending approval requests',
  'Remaining',
]

const countCsv = (count: ApiAidCount | null | undefined): string =>
  count == null ? '' : String(count.requests)

/**
 * The table's lines on screen (§11), one per pool, round and total, as folded and scoped; Pending
 * approval as its own column, each dollar column followed by its request count (empty where the
 * server sent none). The strip, below the line and the decision-type block are not in it (plan
 * Decision 7, M8).
 */
export function budgetCsvRows(rows: readonly BudgetRow[]): string[][] {
  return rows
    .filter((row) => row.kind !== 'pending')
    .map((row) => [
      row.poolLabel,
      row.round === null ? '' : String(row.round),
      moneyCsv(row.cell.allocated),
      moneyCsv(row.cell.posted),
      moneyCsv(row.cell.accepted),
      moneyCsv(row.cell.needs_offer),
      countCsv(row.cell.needs_offer_count),
      moneyCsv(row.cell.pending_approval),
      countCsv(row.cell.pending_approval_count),
      moneyCsv(row.cell.remaining),
    ])
}

/** `camperships-season-rounds-budget[-<pool>]-<season>[-as-of-<date>].csv` (D70). */
export function budgetCsvName(
  season: number,
  poolLabel: string | null,
  asOf: string | null
): string {
  return aidCsvFilename({
    surface: 'season',
    view: 'rounds-budget',
    filters: poolLabel === null ? [] : [poolLabel],
    season,
    asOf,
  })
}
