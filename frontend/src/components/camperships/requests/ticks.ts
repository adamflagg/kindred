/**
 * Posted and Accepted ticks on grid rows (§4.10, §5.2; D41, D47, D51; slice 1 Decisions 15–17). The
 * dialog shows what the click will write, and the write sends exactly that: a Posted row carries the
 * decided amount the person confirmed, which the server refuses if it moved (a 409 naming the rows).
 */
import type { ApiAidGridRow, ApiAidRound, ApiAidWriteOut } from '../../../types/api-types'
import { formatMoney, toCents } from '../kit/money'

export type TickAction = 'posted' | 'accepted'

/** The server's cap on one tick (`PostedIn.rows` / `AcceptedIn.rows`, max_length). It is all or nothing, so we never split. */
export const MAX_TICK_ROWS = 900

export interface TickRow {
  readonly requestId: string
  readonly round: 1 | 2 | 3
  /** Posted: the decided amount it locks. Accepted: null. */
  readonly amount: number | null
  readonly householdCmId: number
  readonly label: string
}

export interface TickPlan {
  readonly action: TickAction
  readonly rows: readonly TickRow[]
  readonly families: number
  /** Posted: the total it locks, to the cent. Accepted: null. */
  readonly total: number | null
  /** Selected rows with nothing to tick, by name. */
  readonly skipped: readonly string[]
}

const asRound = (n: number): 1 | 2 | 3 | null => (n === 1 || n === 2 || n === 3 ? n : null)

function lowestWhere(
  row: ApiAidGridRow,
  test: (round: ApiAidRound) => boolean
): ApiAidRound | undefined {
  return row.rounds
    .filter(test)
    .reduce<ApiAidRound | undefined>(
      (low, r) => (low === undefined || r.round < low.round ? r : low),
      undefined
    )
}

// A request cancelled in Kindred takes no tick (the server's CANCELLED_IN_KINDRED refusal).
const cancelledInKindred = (row: ApiAidGridRow) => row.cancellation?.by === 'kindred'

/** Posted ticks the row's lowest round that needs an offer, at its decided amount (Decision 15). */
export function postedTarget(
  row: ApiAidGridRow
): { readonly round: 1 | 2 | 3; readonly amount: number } | null {
  if (cancelledInKindred(row)) return null
  const round = lowestWhere(row, (r) => r.status === 'needs_offer' && r.decided !== null)
  // Narrowed again here: the filter's test doesn't carry into the result's type.
  const decided = round?.decided ?? null
  if (round === undefined || decided === null) return null
  const n = asRound(round.round)
  return n === null ? null : { round: n, amount: decided }
}

/** Accepted ticks the lowest posted round the family hasn't accepted (Decision 15; D47). */
export function acceptedTarget(row: ApiAidGridRow): { readonly round: 1 | 2 | 3 } | null {
  if (cancelledInKindred(row)) return null
  const round = lowestWhere(
    row,
    (r) => r.status === 'posted' && !r.accepted && r.clawed_back !== true
  )
  const n = round === undefined ? null : asRound(round.round)
  return n === null ? null : { round: n }
}

const nameOf = (row: ApiAidGridRow) => (row.camper_name !== '' ? row.camper_name : row.family_name)

/** What a tick would write on these rows as they stand now. Called at the click, never later. */
export function tickPlan(rows: readonly ApiAidGridRow[], action: TickAction): TickPlan {
  const ticks: TickRow[] = []
  const skipped: string[] = []
  for (const row of rows) {
    // Branch on the action so each target keeps its own type.
    const posted = action === 'posted' ? postedTarget(row) : null
    const accepted = action === 'accepted' ? acceptedTarget(row) : null
    const round = posted?.round ?? accepted?.round ?? null
    if (round === null) {
      skipped.push(nameOf(row))
      continue
    }
    ticks.push({
      requestId: row.request_id,
      round,
      amount: posted?.amount ?? null,
      householdCmId: row.household_cm_id,
      label: nameOf(row),
    })
  }
  const total =
    action === 'posted' ? ticks.reduce((cents, t) => cents + toCents(t.amount ?? 0), 0) / 100 : null
  return {
    action,
    rows: ticks,
    families: new Set(ticks.map((t) => t.householdCmId)).size,
    total,
    skipped,
  }
}

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`

/** "Tick Posted on 379 requests · 212 families · $412,380 locked" (§4.10; Decision 17). */
export function tickWords(plan: TickPlan): string {
  const verb = plan.action === 'posted' ? 'Posted' : 'Accepted'
  const base = `Tick ${verb} on ${plural(plan.rows.length, 'request', 'requests')} · ${plural(plan.families, 'family', 'families')}`
  return plan.action === 'posted' ? `${base} · ${formatMoney(plan.total)} locked` : base
}

/** What the write did, for the line by the bar: "Ticked Posted on 379 requests · $412,380 locked". */
export function doneWords(action: TickAction, out: ApiAidWriteOut): string {
  const verb = action === 'posted' ? 'Ticked Posted' : 'Ticked Accepted'
  const lockedAmount = out.total_locked ?? null
  const locked =
    action === 'posted' && lockedAmount !== null ? ` · ${formatMoney(lockedAmount)} locked` : ''
  const same = out.unchanged > 0 ? ` (${plural(out.unchanged, 'was', 'were')} already ticked)` : ''
  return `${verb} on ${plural(out.written, 'request', 'requests')}${locked}${same}`
}

/** "Emma Johnson R1": one ticked line, for the result that lists exactly what was ticked. */
export const tickedLine = (row: TickRow) => `${row.label} R${String(row.round)}`

/**
 * Whether a refused tick certainly wrote nothing: the server checks every row before it commits (all
 * or nothing), so any 4xx answer means nothing moved. A dropped connection or a 5xx doesn't say.
 */
export const wroteNothing = (status: number) => status >= 400 && status < 500
