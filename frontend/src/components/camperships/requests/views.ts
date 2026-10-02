/**
 * The Requests views (§6.2; D23–D25, D27, D59; slice 1 Decision 8): each is the rows whose `queues`
 * name it (the server decides membership, D21), its own column set, and its default grouping. Pure:
 * RequestsGrid adds only how each cell draws.
 */
import type {
  ApiAidConfirmation,
  ApiAidGridRow,
  ApiAidQueue,
  ApiAidRound,
} from '../../../types/api-types'
import { aidCsvFilename } from '../kit/csv'
import { toCents } from '../kit/money'
import type { CellValue } from '../kit/table'
import { attentionFor, daysBetween, waitingSince } from './attention'
import { LIVE_REQUEST_STATUSES } from './gridEditor'
import { latestRound, requestStage, roundOf } from './stage'
import { offerRound } from './ticks'

export type RequestViewKey = 'all' | ApiAidQueue

export type GridColumnKey =
  | 'family'
  | 'camper'
  | 'householdId'
  | 'personId'
  | 'session'
  | 'stage'
  | 'tier'
  | 'ask'
  | 'cost'
  | 'r1'
  | 'appealAsk'
  | 'r2'
  | 'r3'
  | 'r3Ask'
  | 'total'
  | 'posted'
  | 'roundPosted'
  | 'confirmed'
  | 'round'
  | 'decided'
  | 'newTotal'
  | 'daysWaiting'
  | 'tick'
  | 'cancelledOn'
  | 'daysSinceCancelled'
  | 'attention'

export interface RequestView {
  readonly key: RequestViewKey
  /** The URL's `?view=` (D15). */
  readonly slug: string
  readonly label: string
  /** Beyond Family and Camper, which every view pins (D25). */
  readonly columns: readonly GridColumnKey[]
  /** How it opens: by the reason, by round, all one group, or flat (null: All, D23). */
  readonly groupBy: 'reason' | 'round' | 'one' | null
}

const ALL: RequestView = {
  key: 'all',
  slug: 'all',
  label: 'All',
  groupBy: null,
  columns: [
    'session',
    'stage',
    'tier',
    'ask',
    'cost',
    'r1',
    'appealAsk',
    'r2',
    'r3',
    'total',
    'posted',
    'confirmed',
    'attention',
  ],
}

export const REQUEST_VIEWS: readonly RequestView[] = [
  ALL,
  {
    key: 'needs_offer',
    slug: 'needs-offer',
    label: 'Needs an offer',
    groupBy: 'round',
    columns: ['session', 'stage', 'round', 'decided', 'newTotal', 'tick', 'attention'],
  },
  {
    key: 'holds',
    slug: 'holds',
    label: 'Holds',
    groupBy: 'reason',
    columns: ['session', 'ask', 'cost', 'tier', 'attention'],
  },
  {
    key: 'pending_approval',
    slug: 'pending-approval',
    label: 'Pending approval',
    groupBy: 'one',
    columns: ['session', 'r2', 'r3Ask', 'attention'],
  },
  {
    key: 'waiting_on_family',
    slug: 'waiting',
    label: 'Waiting on the family',
    groupBy: 'one',
    columns: ['session', 'round', 'roundPosted', 'daysWaiting', 'tick', 'attention'],
  },
  {
    key: 'appeals',
    slug: 'appeals',
    label: 'Appeals',
    groupBy: 'one',
    columns: ['session', 'stage', 'r1', 'appealAsk', 'r2', 'total', 'posted', 'attention'],
  },
  {
    key: 'not_reconciled',
    slug: 'not-reconciled',
    label: 'Not reconciled',
    groupBy: 'reason',
    columns: ['session', 'stage', 'total', 'posted', 'confirmed', 'attention'],
  },
  {
    key: 'to_reverse',
    slug: 'to-reverse',
    label: 'To reverse',
    groupBy: 'one',
    columns: ['session', 'cancelledOn', 'posted', 'daysSinceCancelled', 'attention'],
  },
  {
    key: 'session_not_settled',
    slug: 'session-not-settled',
    label: 'Session not settled',
    groupBy: 'reason',
    columns: ['session', 'attention'],
  },
  {
    key: 'duplicates',
    slug: 'duplicates',
    label: 'Duplicates',
    groupBy: 'reason',
    columns: ['session', 'stage', 'attention'],
  },
  {
    key: 'cancel_reason',
    slug: 'cancel-reason',
    label: 'Cancelled: give a reason',
    groupBy: 'one',
    columns: ['session', 'stage', 'posted', 'attention'],
  },
]

export function requestView(slug: string | null): RequestView {
  return REQUEST_VIEWS.find((view) => view.slug === slug) ?? ALL
}

export interface ColumnContext {
  readonly view: RequestViewKey
  readonly today: string
}

export interface GridColumnSpec {
  readonly header: string
  readonly width?: number
  readonly align?: 'right'
  readonly flex?: true
  readonly pinned?: true
  /** A money column: the footer totals it, and the CSV writes it through moneyCsv. */
  readonly money?: true
  /** True: still money in the cell and the CSV, but the footer shows no total (no ruled figure to sum). */
  readonly noTotal?: true
  /** False keeps an action column out of the CSV (M16). */
  readonly inCsv?: false
  readonly value: (row: ApiAidGridRow, ctx: ColumnContext) => CellValue
}

function lowest(rounds: readonly ApiAidRound[]): ApiAidRound | undefined {
  return rounds.reduce<ApiAidRound | undefined>(
    (low, r) => (low === undefined || r.round < low.round ? r : low),
    undefined
  )
}

/** The round a per-round view is about (§13; Decision 15): Needs an offer's lowest round to offer, Waiting's oldest round awaiting the family. */
export function viewRound(row: ApiAidGridRow, view: RequestViewKey): ApiAidRound | undefined {
  if (view === 'needs_offer') return lowest(row.rounds.filter((r) => r.status === 'needs_offer'))
  if (view === 'waiting_on_family') {
    return lowest(
      row.rounds.filter((r) => r.status === 'posted' && !r.accepted && r.clawed_back !== true)
    )
  }
  return latestRound(row)
}

const CONFIRMATION_WORDS: Readonly<Record<ApiAidConfirmation['status'], string>> = {
  awaiting_sync: "awaiting tonight's sync",
  confirmed: 'confirmed',
  short: 'short',
  over: 'over',
  not_in_campminder: 'not in CampMinder',
  reversed: 'reversed',
}

export const GRID_COLUMNS: Readonly<Record<GridColumnKey, GridColumnSpec>> = {
  family: { header: 'Family', width: 110, pinned: true, value: (r) => r.family_name },
  camper: { header: 'Camper', width: 130, pinned: true, value: (r) => r.camper_name },
  householdId: {
    header: 'Household',
    width: 84,
    pinned: true,
    align: 'right',
    value: (r) => r.household_cm_id,
  },
  personId: {
    header: 'Person',
    width: 84,
    pinned: true,
    align: 'right',
    value: (r) => r.person_cm_id,
  },
  // Blank when the session didn't match (an unsettled request): the cell draws "—".
  session: { header: 'Session', width: 96, value: (r) => r.session_name || null },
  stage: { header: 'Stage', width: 104, value: (r) => requestStage(r)?.text ?? null },
  tier: { header: 'Tier', width: 44, align: 'right', value: (r) => r.tier },
  ask: {
    header: 'Ask',
    width: 74,
    align: 'right',
    money: true,
    value: (r) => roundOf(r, 1)?.ask ?? null,
  },
  cost: { header: 'Cost', width: 78, align: 'right', money: true, value: (r) => r.cost },
  r1: {
    header: 'R1',
    width: 72,
    align: 'right',
    money: true,
    value: (r) => roundOf(r, 1)?.decided ?? null,
  },
  appealAsk: {
    header: 'Appeal ask',
    width: 84,
    align: 'right',
    money: true,
    value: (r) => roundOf(r, 2)?.ask ?? null,
  },
  r2: {
    header: 'R2',
    width: 72,
    align: 'right',
    money: true,
    value: (r) => roundOf(r, 2)?.decided ?? null,
  },
  // A pending approval's amount is drawn in the cell, never summed (§5.3, D79).
  r3: {
    header: 'R3',
    width: 60,
    align: 'right',
    money: true,
    value: (r) => roundOf(r, 3)?.decided ?? null,
  },
  r3Ask: {
    header: 'R3 ask',
    width: 74,
    align: 'right',
    money: true,
    value: (r) => roundOf(r, 3)?.ask ?? null,
  },
  total: { header: 'Total', width: 78, align: 'right', money: true, value: (r) => r.total_decided },
  posted: {
    header: 'Posted',
    width: 78,
    align: 'right',
    money: true,
    value: (r) => r.total_posted,
  },
  // Waiting on the family: the waiting round's own posted amount (owner ruling I2), so the footer is
  // the money posted and not yet accepted; the Round column names the same round.
  roundPosted: {
    header: 'Posted',
    width: 78,
    align: 'right',
    money: true,
    value: (r) => viewRound(r, 'waiting_on_family')?.posted ?? null,
  },
  confirmed: {
    header: 'Confirmed by the ledger',
    width: 100,
    value: (r) => (r.confirmation ? CONFIRMATION_WORDS[r.confirmation.status] : null),
  },
  round: {
    header: 'Round',
    width: 56,
    value: (r, { view }) => {
      const round = viewRound(r, view)
      return round ? `R${String(round.round)}` : null
    },
  },
  decided: {
    header: 'Decided',
    width: 78,
    align: 'right',
    money: true,
    value: (r, { view }) => viewRound(r, view)?.decided ?? null,
  },
  // ⚠ Decision 40 (owner approved): under reverse-and-repost, what is typed into CampMinder for an
  // appeal is the request's new total, so it sits beside the round's own amount on Round 2/3 rows.
  // It is the server's `total_decided` as it stands, clawed-back rounds included (owner ruling
  // 2026-10-02: a reversal mid-appeal, before the repost syncs, leaves R1 + R2 to type).
  newTotal: {
    header: 'New total',
    width: 78,
    align: 'right',
    money: true,
    // The ruling covered the per-row cell; a sum of these is a new figure nobody ruled (PR 4 review I1).
    noTotal: true,
    value: (r) => ((offerRound(r)?.round ?? 1) > 1 ? r.total_decided : null),
  },
  daysWaiting: {
    header: 'Days waiting',
    width: 84,
    align: 'right',
    value: (r, { today }) => {
      const since = waitingSince(r)
      return since === null ? null : daysBetween(since, today)
    },
  },
  // A button has nothing to export (M16; build ruling 3).
  tick: { header: 'Tick', width: 150, inCsv: false, value: () => null },
  cancelledOn: { header: 'Cancelled on', width: 96, value: (r) => r.cancellation?.on ?? null },
  daysSinceCancelled: {
    header: 'Days since cancelled',
    width: 96,
    align: 'right',
    value: (r, { today }) => {
      const on = r.cancellation?.on ?? null
      return on === null ? null : daysBetween(on, today)
    },
  },
  attention: {
    header: 'Needs attention',
    flex: true,
    value: (r, { view, today }) => {
      const found = attentionFor(r, view, today)
      return found ? `${found.item.pill}: ${found.item.fact}` : null
    },
  },
}

const IDENTITY: readonly GridColumnKey[] = ['family', 'camper']
const IDS: readonly GridColumnKey[] = ['householdId', 'personId']

/** A view's columns. Tick shows only for someone who can tick (`casework`, on a live read). */
export function viewColumns(view: RequestView, showIds: boolean, canTick = false): GridColumnKey[] {
  const columns = view.columns.filter((key) => canTick || key !== 'tick')
  return [...IDENTITY, ...(showIds ? IDS : []), ...columns]
}

export type RoundFilter = 1 | 2 | 3
/** A round's checklist state (§5.2): posted, or posted and accepted. */
export type TickFilter = 'posted' | 'accepted'

export function parseRoundFilter(raw: string | null): RoundFilter | null {
  return raw === '1' ? 1 : raw === '2' ? 2 : raw === '3' ? 3 : null
}

export function parseTickFilter(raw: string | null): TickFilter | null {
  return raw === 'posted' || raw === 'accepted' ? raw : null
}

export interface GridFilters {
  readonly program: string | null
  readonly pool: string | null
  /** Rows with this round (Decision 9; owner ruling Group 2c Q3). */
  readonly round: RoundFilter | null
  /** Rows whose round (this one, or any) is posted, or posted and accepted. */
  readonly tick: TickFilter | null
  /** Today's listed lines (Decision 10): exactly these requests, or null for no such filter. */
  readonly ids: ReadonlySet<string> | null
  /** Only rounds whose money counts toward the budget (Rounds & budget's figures; plan review I5). */
  readonly counted: boolean
  /** Only live requests, as the budget's demand counts them (owner, Decision 6(b)); arrives on a link. */
  readonly live: boolean
}

/** A live request, as the budget's demand counts one: a live status and not cancelled (`request.live`). */
export function isLiveRow(row: ApiAidGridRow): boolean {
  return (
    row.request_status !== null &&
    LIVE_REQUEST_STATUSES.includes(row.request_status) &&
    (row.cancellation ?? null) === null
  )
}

export const NO_FILTERS: GridFilters = {
  program: null,
  pool: null,
  round: null,
  tick: null,
  ids: null,
  counted: false,
  live: false,
}

function matchesRound(
  row: ApiAidGridRow,
  round: RoundFilter | null,
  tick: TickFilter | null,
  counted: boolean
): boolean {
  if (round === null && tick === null && !counted) return true
  const rounds = row.rounds.filter(
    (r) => (round === null || r.round === round) && (!counted || r.counts_toward_budget)
  )
  if (tick === null) return rounds.length > 0
  return rounds.some(
    (r) => r.status === 'posted' && r.clawed_back !== true && (tick === 'posted' || r.accepted)
  )
}

/**
 * Needs an offer and Pending approval hold a row for a round in that status, and the budget counts
 * that round's money only when the round counts toward it (budget.py). So `counted` binds to that
 * round, on `round=` too: a counted posted Round 1 doesn't let in a Round 2 needing an offer outside
 * the budget (final review I2). Other views are unchanged.
 */
function countedInView(row: ApiAidGridRow, view: RequestViewKey, filters: GridFilters): boolean {
  if (!filters.counted || (view !== 'needs_offer' && view !== 'pending_approval')) return true
  return row.rounds.some(
    (r) =>
      r.status === view &&
      r.counts_toward_budget &&
      (filters.round === null || r.round === filters.round)
  )
}

export function filterRows(
  rows: readonly ApiAidGridRow[],
  view: RequestViewKey,
  filters: GridFilters
): ApiAidGridRow[] {
  return rows.filter(
    (row) =>
      (view === 'all' || (row.queues?.includes(view) ?? false)) &&
      (filters.program === null || row.program_key === filters.program) &&
      (filters.pool === null || row.pool === filters.pool) &&
      (!filters.live || isLiveRow(row)) &&
      matchesRound(row, filters.round, filters.tick, filters.counted) &&
      countedInView(row, view, filters) &&
      (filters.ids === null || filters.ids.has(row.request_id))
  )
}

export interface ViewCount {
  readonly families: number
  readonly requests: number
}

export function viewCount(rows: readonly ApiAidGridRow[]): ViewCount {
  return { families: new Set(rows.map((r) => r.household_cm_id)).size, requests: rows.length }
}

/** Each view's count; on a past date only All's, since queues aren't rebuilt (Decision 11). */
export function viewCounts(
  rows: readonly ApiAidGridRow[],
  filters: GridFilters,
  live: boolean
): ReadonlyMap<RequestViewKey, ViewCount> {
  const counts = new Map<RequestViewKey, ViewCount>()
  for (const view of REQUEST_VIEWS) {
    if (live || view.key === 'all')
      counts.set(view.key, viewCount(filterRows(rows, view.key, filters)))
  }
  return counts
}

/** "5 fam · 7 req" (§6.4's form, on view links and group headings); "—" when not counted. */
export function countWords(count: ViewCount | null): string {
  if (count === null) return '—'
  return `${String(count.families)} fam · ${String(count.requests)} req`
}

/** "6 requests · 5 families" (the grid's footer, round7.html). */
export function footerWords(count: ViewCount): string {
  const requests = `${String(count.requests)} ${count.requests === 1 ? 'request' : 'requests'}`
  const families = `${String(count.families)} ${count.families === 1 ? 'family' : 'families'}`
  return `${requests} · ${families}`
}

/** The states Today counts as not reconciled (financial_aid_queues.UNRECONCILED). */
const UNRECONCILED: ReadonlySet<string> = new Set([
  'awaiting_sync',
  'short',
  'over',
  'not_in_campminder',
])

const STATE_HEADINGS: Readonly<Record<ApiAidConfirmation['status'], string>> = {
  awaiting_sync: "Awaiting tonight's sync",
  // Confirmed as a request, but not reconciled: a payer share is what is open (D59, D81).
  confirmed: 'A payer share',
  short: 'Short',
  over: 'Over',
  not_in_campminder: 'Not in CampMinder',
  reversed: 'Reversed',
}

/** A view's "by reason" grouping (D24): the hold, the round, the confirmation state, or the view itself. */
export function reasonGroup(view: RequestView, today: string) {
  return (row: ApiAidGridRow): { id: string; heading: string } => {
    if (view.groupBy === 'one') return { id: view.key, heading: view.label }
    if (view.groupBy === 'round') {
      const n = viewRound(row, view.key)?.round
      const text = n === undefined ? '?' : String(n)
      return { id: `r${text}`, heading: `Round ${text}` }
    }
    if (view.key === 'not_reconciled' && row.confirmation) {
      const c = row.confirmation
      // A confirmed request is here for a share: head the group by that share's own state, as
      // Today's reasons do (financial_aid_today._unreconciled), not a vague "A payer share".
      const open =
        c.status === 'confirmed' ? c.shares.find((s) => UNRECONCILED.has(s.status)) : undefined
      const heading = STATE_HEADINGS[open?.status ?? c.status]
      return { id: heading, heading }
    }
    const heading = attentionFor(row, view.key, today)?.item.pill ?? 'Nothing waiting'
    return { id: heading, heading }
  }
}

export function familyGroup(row: ApiAidGridRow): { id: string; heading: string } {
  return { id: String(row.household_cm_id), heading: row.family_name }
}

/** A money column's footer (D20, D74): the sum to the cent of what is there; null ("—") when nothing is. */
export function moneyTotal(values: readonly CellValue[]): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number')
  if (numbers.length === 0) return null
  return numbers.reduce((cents, value) => cents + toCents(value), 0) / 100
}

/** D70's file name (Decision 32): camperships-requests-<view>[-<program>][-<pool>][-round-<n>][-<tick>]-<season>[-as-of-<date>].csv. */
export function requestsCsvName(
  view: RequestView,
  filters: Pick<GridFilters, 'program' | 'pool' | 'round' | 'tick'>,
  season: number,
  asOf: string | null,
  /** An active Today line (Decision 10), so its partial export is not named like the season's. */
  todayKey: string | null = null
): string {
  const words = [
    filters.program,
    filters.pool,
    filters.round === null ? null : `round ${String(filters.round)}`,
    filters.tick,
    todayKey === null ? null : `today ${todayKey.replaceAll('_', ' ')}`,
  ]
  return aidCsvFilename({
    surface: 'requests',
    view: view.slug,
    filters: words.filter((f): f is string => f !== null),
    season,
    asOf,
  })
}
