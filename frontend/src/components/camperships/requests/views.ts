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
import { formatShortDate } from '../kit/dates'
import { formatGap, formatMoney, toCents } from '../kit/money'
import type { PillTone } from '../kit/kitStyles'
import type { CellValue, FitContent } from '../kit/table'
import { attentionFor, daysBetween, waitingSince } from './attention'
import { latestRound, requestStage, roundOf } from './stage'

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
  | 'daysWaiting'
  | 'cancelledOn'
  | 'daysSinceCancelled'
  | 'attention'

export interface RequestView {
  readonly key: RequestViewKey
  /** The URL's `?view=` (D15). */
  readonly slug: string
  readonly label: string
  /** Beyond the Camper, which every view pins, and the Family, which sits before Needs attention (D25, T2). */
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
    columns: ['session', 'stage', 'round', 'decided', 'attention'],
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
    columns: ['session', 'round', 'roundPosted', 'daysWaiting', 'attention'],
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
  /** Whether the visible columns include Cancelled on; when not, the needs-attention text keeps the date (O2). */
  readonly cancelledOnShown?: boolean
}

/** The column context for a shown view; its column set, not its key, says whether Cancelled on is visible (the Appeals lens swaps the columns). */
export function columnContext(view: RequestView, today: string): ColumnContext {
  return { view: view.key, today, cancelledOnShown: view.columns.includes('cancelledOn') }
}

export interface GridColumnSpec {
  readonly header: string
  readonly width?: number
  readonly align?: 'right'
  readonly flex?: true
  readonly pinned?: true
  /** Frozen on the right edge (batch 4: Needs attention). */
  readonly pinnedRight?: true
  /** Width from the chips drawn: the widest plus `pad`, never under `min` (batch 4). */
  readonly fitContent?: FitContent
  /** A money column: the footer totals it, and the CSV writes it through moneyCsv. */
  readonly money?: true
  /** False keeps an action column out of the CSV (M16). */
  readonly inCsv?: false
  /** What the header says on hover and on click; the header then does not sort. */
  readonly help?: string
  /** The CSV's own, fuller header name when the screen's is short. */
  readonly csvHeader?: string
  /** The CSV's own text when it says more than the screen's (CM ✓'s full detail, batch 4). */
  readonly csv?: (row: ApiAidGridRow, ctx: ColumnContext) => string
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

/**
 * The word CM ✓ shows while a tick waits for tonight's sync (owner ruling A2: "pending"). One
 * constant, used by the chip, the header's explanation and the CSV, because the owner may rename it.
 */
export const CM_PENDING_WORD = 'pending'

/**
 * CM ✓'s cell (owner rulings A2, batch 4): a chip of one word, no amount or date. The amount and
 * date are in the opened row's detail line and the CSV (confirmationDetail).
 */
export function confirmationChip(confirmation: ApiAidConfirmation): {
  readonly word: string
  readonly tone: PillTone
} {
  switch (confirmation.status) {
    case 'confirmed':
      return { word: '✓', tone: 'emerald' }
    case 'short':
    case 'over':
      return { word: confirmation.status, tone: 'amber' }
    case 'not_in_campminder':
      return { word: 'missing', tone: 'amber' }
    case 'reversed':
      return { word: 'reversed', tone: 'stone' }
    case 'awaiting_sync':
      return { word: CM_PENDING_WORD, tone: 'muted' }
  }
}

/**
 * CM ✓ in full (owner ruling, batch 4), for the detail line and the CSV's "Confirmed by
 * CampMinder": "✓ confirmed Sep 29", "CampMinder shows $1,450; short $50", "reversed Oct 2",
 * "Ticked today; tonight's sync checks it.", "Posted $1,800; the last sync found nothing in
 * CampMinder for it."
 */
export function confirmationDetail(confirmation: ApiAidConfirmation): string {
  const on = confirmation.on ? ` ${formatShortDate(confirmation.on)}` : ''
  switch (confirmation.status) {
    case 'confirmed':
      return `✓ confirmed${on}`
    case 'short':
    case 'over':
      return `CampMinder shows ${formatMoney(confirmation.in_campminder)}; ${
        formatGap(confirmation.locked, confirmation.in_campminder) ?? confirmation.status
      }`
    case 'not_in_campminder':
      return `Posted ${formatMoney(confirmation.locked)}; the last sync found nothing in CampMinder for it.`
    case 'reversed':
      return `reversed${on}`
    case 'awaiting_sync':
      return "Ticked today; tonight's sync checks it."
  }
}

/** The CM ✓ header's explanation (owner ruling, batch 4), verbatim but for the pending word. */
export const CM_CHECK_HELP = `CampMinder check: did the money posted in CampMinder match what was ticked Posted? ✓ = matched; short/over = CampMinder's ledger differs; missing = nothing in CampMinder for it; reversed = the posting was reversed; ${CM_PENDING_WORD} = waiting for tonight's sync.`

export const GRID_COLUMNS: Readonly<Record<GridColumnKey, GridColumnSpec>> = {
  // Takes the spare width (batch 4): Needs attention is now only as wide as its chips, so in a
  // narrow view the gap opens here, beside it, and never at 130 or under.
  family: { header: 'Family', width: 130, flex: true, value: (r) => r.family_name },
  camper: { header: 'Camper', width: 130, pinned: true, value: (r) => r.camper_name },
  householdId: {
    header: 'Household',
    width: 84,
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
  stage: { header: 'Stage', width: 150, value: (r) => requestStage(r)?.text ?? null },
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
  // As wide as its widest chip, "reversed" (batch 4): the words are a closed set of six, so the
  // width is fixed, not measured, and the column never shifts as rows change.
  confirmed: {
    header: 'CM ✓',
    csvHeader: 'Confirmed by CampMinder',
    help: CM_CHECK_HELP,
    width: 84,
    value: (r) => (r.confirmation ? confirmationChip(r.confirmation).word : null),
    csv: (r) => (r.confirmation ? confirmationDetail(r.confirmation) : ''),
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
  daysWaiting: {
    header: 'Days waiting',
    width: 84,
    align: 'right',
    value: (r, { today }) => {
      const since = waitingSince(r)
      return since === null ? null : daysBetween(since, today)
    },
  },
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
  // Frozen on the right and as wide as the widest chip on screen plus 18px, never under 84px (owner
  // LOCKED batch 4, round 6). The cell is the chip; the full text is in the opened row's detail line.
  attention: {
    header: 'Needs attention',
    pinnedRight: true,
    fitContent: { pad: 18, min: 84 },
    value: (r, { view, today, cancelledOnShown }) => {
      const found = attentionFor(r, view, today, cancelledOnShown)
      if (!found) return null
      return found.item.fact === '' ? found.item.pill : `${found.item.pill}: ${found.item.fact}`
    },
  },
}

/**
 * Grid layout T2 (owner lock L3 d): the Camper (and Person id) pin; the Family and Household id sit
 * just left of Needs attention, where Requested by will go (T3).
 */
export function viewColumns(
  view: RequestView,
  showIds: boolean,
  tickedSeason: boolean
): GridColumnKey[] {
  const tail: GridColumnKey[] = ['family', ...(showIds ? (['householdId'] as const) : [])]
  // A season before the first ticked one (the read's `ticked_season`, #2994) has nothing to
  // confirm, so no CM ✓ (and no CSV column).
  const middle = view.columns.filter(
    (key) => key !== 'attention' && (key !== 'confirmed' || tickedSeason)
  )
  const attention = view.columns.filter((key) => key === 'attention')
  return ['camper', ...(showIds ? (['personId'] as const) : []), ...middle, ...tail, ...attention]
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
}

export const NO_FILTERS: GridFilters = {
  program: null,
  pool: null,
  round: null,
  tick: null,
  ids: null,
}

function matchesRound(
  row: ApiAidGridRow,
  round: RoundFilter | null,
  tick: TickFilter | null
): boolean {
  if (round === null && tick === null) return true
  const rounds = round === null ? row.rounds : row.rounds.filter((r) => r.round === round)
  if (tick === null) return rounds.length > 0
  return rounds.some(
    (r) => r.status === 'posted' && r.clawed_back !== true && (tick === 'posted' || r.accepted)
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
      matchesRound(row, filters.round, filters.tick) &&
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

/** "5 fam · 7 req" (§6.4's form, on group headings; a view link now shows requests only); "—" when not counted. */
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
  asOf: string | null
): string {
  const words = [
    filters.program,
    filters.pool,
    filters.round === null ? null : `round ${String(filters.round)}`,
    filters.tick,
  ]
  return aidCsvFilename({
    surface: 'requests',
    view: view.slug,
    filters: words.filter((f): f is string => f !== null),
    season,
    asOf,
  })
}
