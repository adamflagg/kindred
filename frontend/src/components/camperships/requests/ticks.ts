/**
 * Accepted ticks on grid rows (§4.10, §5.2; D47; slice 1 Decisions 15–17). The dialog shows what the
 * click will write, and the write sends exactly that. Posted is not ticked from the grid: the ledger
 * sync ticks it, and a hand tick belongs to the exception rows and the household page (owner ruling
 * 2026-10-02, posted-tick investigation option B).
 */
import type { ApiAidGridRow, ApiAidRound, ApiAidWriteOut } from '../../../types/api-types'

export type TickAction = 'accepted'

/** The server's cap on one tick (`AcceptedIn.rows`, max_length). It is all or nothing, so we never split. */
export const MAX_TICK_ROWS = 900

interface TickRowBase {
  readonly requestId: string
  readonly round: 1 | 2 | 3
  readonly householdCmId: number
  /** The camper's name, with the session when the same camper has two requests in the plan. */
  readonly label: string
  /** Ticked, but not on screen: a search, the view or a filter hides it. The dialog says so. */
  readonly hidden: boolean
}

export interface AcceptedTick extends TickRowBase {
  readonly action: 'accepted'
}

export type TickRow = AcceptedTick

export interface TickPlan {
  readonly action: TickAction
  readonly rows: readonly TickRow[]
  readonly families: number
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
export const cancelledInKindred = (row: ApiAidGridRow) => row.cancellation?.by === 'kindred'

/**
 * Accepted ticks the lowest posted round the family hasn't accepted (Decision 15; D47), or a C1
 * round (#2996, `cm_pending`: CampMinder covers it in full and tonight's tick posts it), which the
 * server lets be ticked Accepted the same day (owner 10-03).
 */
export function acceptedTarget(row: ApiAidGridRow): { readonly round: 1 | 2 | 3 } | null {
  if (cancelledInKindred(row)) return null
  const round = lowestWhere(
    row,
    (r) => (r.status === 'posted' || r.cm_pending === true) && !r.accepted && r.clawed_back !== true
  )
  const n = round === undefined ? null : asRound(round.round)
  return n === null ? null : { round: n }
}

const nameOf = (row: ApiAidGridRow) => (row.camper_name !== '' ? row.camper_name : row.family_name)

/**
 * What a tick would write on these rows as they stand now. Called at the click, never later.
 * `hiddenKeys` are the request ids not on screen (a search, the view or a filter hides them).
 */
export function tickPlan(
  rows: readonly ApiAidGridRow[],
  action: TickAction,
  hiddenKeys: ReadonlySet<string> = new Set()
): TickPlan {
  // A camper with two requests would read twice: the session tells them apart.
  const seen = new Map<string, number>()
  for (const row of rows) seen.set(nameOf(row), (seen.get(nameOf(row)) ?? 0) + 1)
  const labelOf = (row: ApiAidGridRow) =>
    (seen.get(nameOf(row)) ?? 0) > 1 && row.session_name !== ''
      ? `${nameOf(row)} (${row.session_name})`
      : nameOf(row)

  const ticks: TickRow[] = []
  const skipped: string[] = []
  for (const row of rows) {
    const base = {
      requestId: row.request_id,
      householdCmId: row.household_cm_id,
      label: labelOf(row),
      hidden: hiddenKeys.has(row.request_id),
    }
    const target = acceptedTarget(row)
    if (target !== null) ticks.push({ ...base, action: 'accepted', round: target.round })
    else skipped.push(base.label)
  }
  return {
    action,
    rows: ticks,
    families: new Set(ticks.map((t) => t.householdCmId)).size,
    skipped,
  }
}

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`

/** "Tick Accepted on 379 requests · 212 families" (§4.10; Decision 17). */
export function tickWords(plan: TickPlan): string {
  return `Tick Accepted on ${plural(plan.rows.length, 'request', 'requests')} · ${plural(plan.families, 'family', 'families')}`
}

/** What the write did, for the line by the bar: "Ticked Accepted on 379 requests". */
export function doneWords(out: ApiAidWriteOut): string {
  // The server wrote nothing: everything sent was already ticked.
  if (out.written === 0 && out.unchanged > 0) {
    return `Nothing changed: ${plural(out.unchanged, 'was', 'were')} already ticked`
  }
  const same = out.unchanged > 0 ? ` (${plural(out.unchanged, 'was', 'were')} already ticked)` : ''
  return `Ticked Accepted on ${plural(out.written, 'request', 'requests')}${same}`
}

/** "Emma Johnson R1": one ticked line, for the result that lists exactly what was ticked. */
export const tickedLine = (row: TickRow) => `${row.label} R${String(row.round)}`

/**
 * Whether a refused tick certainly wrote nothing: the server checks every row before it commits (all
 * or nothing), so any 4xx answer means nothing moved. A dropped connection or a 5xx doesn't say.
 */
export const wroteNothing = (status: number) => status >= 400 && status < 500

/**
 * The ticked keys not on screen: not in the table's matching rows AND the page's visible rows. The
 * table's set lags a render behind a view or filter change, so it is never trusted past the page's
 * own (null: the table hasn't spoken yet).
 */
export function hiddenTicks(
  tickedKeys: readonly string[],
  matching: ReadonlySet<string> | null,
  visibleKeys: ReadonlySet<string>
): ReadonlySet<string> {
  return new Set(
    tickedKeys.filter((key) => !visibleKeys.has(key) || (matching !== null && !matching.has(key)))
  )
}
