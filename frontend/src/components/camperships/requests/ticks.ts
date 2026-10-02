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

interface TickRowBase {
  readonly requestId: string
  readonly round: 1 | 2 | 3
  readonly householdCmId: number
  /** The camper's name, with the session when the same camper has two requests in the plan. */
  readonly label: string
  /** Ticked, but not on screen: a search, the view or a filter hides it. The dialog says so. */
  readonly hidden: boolean
}

/** A Posted row always carries the decided amount it locks, so none is ever sent as $0. */
export interface PostedTick extends TickRowBase {
  readonly action: 'posted'
  readonly amount: number
  /** An appeal (Round 2/3): the request's total_decided, what CampMinder holds after a repost. Else null. */
  readonly newTotal: number | null
}

export interface AcceptedTick extends TickRowBase {
  readonly action: 'accepted'
  readonly amount: null
}

export type TickRow = PostedTick | AcceptedTick

/** A selected row left out for a reason staff can act on. */
export interface BlockedRow {
  readonly label: string
  readonly why: string
}

export interface TickPlan {
  readonly action: TickAction
  readonly rows: readonly TickRow[]
  readonly families: number
  /** Posted: the total it locks, to the cent. Accepted: null. */
  readonly total: number | null
  /** Selected rows with nothing to tick, by name. */
  readonly skipped: readonly string[]
  /** Selected rows the server would refuse: the reason, so one such row never fails the whole tick. */
  readonly blocked: readonly BlockedRow[]
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
 * The lowest round that needs an offer and has a decided amount, if the request can take a tick at all.
 * The one rule for "the round a Posted tick would post": the grid's New total cell reads it too.
 */
export function offerRound(row: ApiAidGridRow): ApiAidRound | undefined {
  if (cancelledInKindred(row)) return undefined
  const round = lowestWhere(row, (r) => r.status === 'needs_offer' && r.decided !== null)
  return round
}

/**
 * Why a round that needs an offer still can't be ticked: an earlier round isn't posted (the server's
 * "tick Round m Posted before Round n"; `tick_posted`). A row ticks one round, so an earlier round
 * that needs an offer would itself be the lowest, and only a held or pending one blocks here.
 */
export function postedBlock(row: ApiAidGridRow): string | null {
  const round = offerRound(row)
  if (round === undefined) return null
  const earlier = row.rounds.find((r) => r.round < round.round && r.status !== 'posted')
  return earlier === undefined ? null : `Round ${String(earlier.round)} isn't posted yet`
}

/** Posted ticks the row's lowest round that needs an offer, at its decided amount (Decision 15). */
export function postedTarget(
  row: ApiAidGridRow
): { readonly round: 1 | 2 | 3; readonly amount: number } | null {
  const round = offerRound(row)
  // Narrowed again here: the filter's test doesn't carry into the result's type.
  const decided = round?.decided ?? null
  if (round === undefined || decided === null || postedBlock(row) !== null) return null
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
  const blocked: BlockedRow[] = []
  for (const row of rows) {
    const base = {
      requestId: row.request_id,
      householdCmId: row.household_cm_id,
      label: labelOf(row),
      hidden: hiddenKeys.has(row.request_id),
    }
    if (action === 'posted') {
      const target = postedTarget(row)
      if (target !== null) {
        ticks.push({
          ...base,
          action: 'posted',
          round: target.round,
          amount: target.amount,
          newTotal: target.round > 1 ? row.total_decided : null,
        })
        continue
      }
      const why = postedBlock(row)
      if (why !== null) blocked.push({ label: base.label, why })
      else skipped.push(base.label)
    } else {
      const target = acceptedTarget(row)
      if (target !== null)
        ticks.push({ ...base, action: 'accepted', round: target.round, amount: null })
      else skipped.push(base.label)
    }
  }
  const total =
    action === 'posted' ? ticks.reduce((cents, t) => cents + toCents(t.amount ?? 0), 0) / 100 : null
  return {
    action,
    rows: ticks,
    families: new Set(ticks.map((t) => t.householdCmId)).size,
    total,
    skipped,
    blocked,
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
  // The server wrote nothing: everything sent was already ticked.
  if (out.written === 0 && out.unchanged > 0) {
    return `Nothing changed: ${plural(out.unchanged, 'was', 'were')} already ticked`
  }
  const verb = action === 'posted' ? 'Ticked Posted' : 'Ticked Accepted'
  const lockedAmount = out.total_locked ?? null
  const locked =
    action === 'posted' && lockedAmount !== null ? ` · ${formatMoney(lockedAmount)} locked` : ''
  const same = out.unchanged > 0 ? ` (${plural(out.unchanged, 'was', 'were')} already ticked)` : ''
  // The tick stands, and says so (SP10a Decision 11): the sections it could not lock, in plain words.
  const sections = out.sections_not_locked ?? []
  const unlocked =
    sections.length > 0
      ? ` · rules not locked yet: ${sections.map((n) => n.replaceAll('_', ' ')).join(', ')}`
      : ''
  return `${verb} on ${plural(out.written, 'request', 'requests')}${locked}${unlocked}${same}`
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
