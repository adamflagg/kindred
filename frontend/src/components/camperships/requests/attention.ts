/**
 * The needs-attention cell's items for a grid row (§4.4; D24, D31; slice 1 Decision 7). Each is a
 * pill (why, in a word or two) and a fact (the long form). A check's or hold's fact is always the
 * server's own message. The four queue items the row's own fields say (to reverse, pending
 * approval, not reconciled, waiting on the family) are worded here.
 */
import type { ApiAidGridRow, ApiAidQueue } from '../../../types/api-types'
import { formatShortDate, parseIsoDay } from '../kit/dates'
import { formatGap, formatMoney } from '../kit/money'
import type { AttentionItem } from '../kit/NeedsAttentionCell'
import { ROUND_STATUS_WORDS } from './stage'

/** Short words per check and hold code; an unknown code reads as its own words. */
const CODE_WORDS: Readonly<Record<string, string>> = {
  household_income_conflict: 'Income conflict',
  placeholder_income: 'Placeholder income',
  payer_shares_incomplete: 'Payer shares',
  py_confirm_tier_change: 'Tier change',
  family_cost_missing: 'Family Camp cost',
  implausible_dependents: 'Dependents',
  award_above_cost: 'Above cost',
  ask_above_cost: 'Ask above cost',
  appeal_above_ask: 'Appeal above ask',
  income_above: 'High income',
  expense_above: 'High expenses',
  multiple_grants: 'Several grants',
  unmatched_session: 'Session unclear',
  duplicate_survivor_withdrawn: 'Duplicate revived',
  awaiting_approved_rules: 'Awaiting rules',
  no_approved_rules: 'No approved rules',
  not_priceable: 'Not priceable',
  manual_hold: 'On hold',
  // Raw code words used to leak through as "No round1 table" and the like.
  no_round1_table: 'No Round 1 table',
  round3_not_allowed: 'No Round 3',
  round3_not_eligible: 'Round 3 not eligible',
  r2_cap_negative: 'Round 2 cap',
  unknown_override_reason: 'Unknown reason',
  // Already in CampMinder, not yet ticked here (owner ruling O4): the next step is to tick Posted.
  in_campminder_not_ticked: 'Mark posted',
}

export function codeWords(code: string): string {
  const words = CODE_WORDS[code]
  if (words !== undefined) return words
  const plain = code.replaceAll('_', ' ')
  return plain.charAt(0).toUpperCase() + plain.slice(1)
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'of', 'to', 'and'])

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '' && !STOP_WORDS.has(word))
}

/** True when the text says nothing its pill does not: every word of it is already a word of the pill (O1). */
export function pillCoversFact(pill: string, fact: string): boolean {
  const covered = new Set(words(pill))
  return words(fact).every((word) => covered.has(word))
}

const DAY_MS = 86_400_000

/** Whole days from one YYYY-MM-DD (or a timestamp's day) to another, read by parts, never through a time zone. */
export function daysBetween(from: string, to: string): number | null {
  const a = parseIsoDay(from.slice(0, 10))
  const b = parseIsoDay(to.slice(0, 10))
  if (a === null || b === null) return null
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS
  )
}

/** When the oldest posted, unaccepted, not clawed-back round was posted: the server's `_waiting_since`. */
export function waitingSince(row: Pick<ApiAidGridRow, 'rounds'>): string | null {
  const days = row.rounds
    .filter((r) => r.status === 'posted' && !r.accepted && r.clawed_back !== true)
    .map((r) => r.posted_on)
    .filter((day): day is string => day !== null)
  return days.length === 0 ? null : days.reduce((a, b) => (b < a ? b : a))
}

/**
 * The opened row's next step (batch 4): a link to where it is done (the household page, at its
 * income section or at the request's card), or plain words where nothing can be done in Kindred.
 * The labels are round 6's mock (grid-layout-options.html nextAction), owner-APPROVED in title case
 * (10-03); plain-words steps stay sentence case. Two kinds are buttons, both of writes the grid
 * already has (#2951, no new write path): `tick` is the row's own Accepted tick, and `markPosted`
 * is the hand Posted tick for one round (#2996), built from an `unticked[]` entry the server marks
 * `mark_posted`.
 */
export type NextStep =
  | { readonly kind: 'link'; readonly label: string; readonly at: 'income' | 'request' }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'tick'; readonly label: string }
  | { readonly kind: 'markPosted'; readonly label: string; readonly round: number }

const toRequest = (label: string): NextStep => ({ kind: 'link', label, at: 'request' })
const say = (text: string): NextStep => ({ kind: 'text', text })

/** The mock's fallback, and the step for a row that needs nothing. */
export const OPEN_REQUEST = toRequest('Open the Request')

export interface GridAttention {
  readonly item: AttentionItem
  /**
   * Why, in fixed words: the pill without its amount, day count or share count ("Short" for "Short
   * $50", "Waiting on the family" for "Waiting 12 days"), so a group heading built from it is one
   * group per reason, never one per figure (owner rulings 10-04 late (grid follow-up)).
   */
  readonly reason: string
  /** The Requests view this item belongs to; null for a note that has none. */
  readonly queue: ApiAidQueue | null
  /**
   * Its next step for the detail line. The hand "Mark Posted" is a `markPosted` step on a Not
   * reconciled row whose `unticked[]` entry says `mark_posted`; other unticked entries have no step.
   */
  readonly next: NextStep | null
}

const ENTER_INCOME: NextStep = { kind: 'link', label: 'Enter the Income', at: 'income' }
const PAYER_SHARES = toRequest('Check the Payer Shares')
const PICK_SESSION = toRequest('Pick the Session')
const KEEP_ONE = toRequest('Choose Which to Keep')

const STEP_BY_CODE: Readonly<Record<string, NextStep | null>> = {
  household_income_conflict: ENTER_INCOME,
  placeholder_income: ENTER_INCOME,
  payer_shares_incomplete: PAYER_SHARES,
  // Owner ruling (10-04 late): a manual hold is lifted, the household page's "Lift…" button.
  manual_hold: toRequest('Lift the Hold…'),
  unmatched_session: PICK_SESSION,
  duplicate_survivor_withdrawn: KEEP_ONE,
  // Owner ruling (10-04 late): no award editor exists by design; the hold clears by correcting the
  // cost, the grants or the amount, on the request's card (holds.py UNRELEASABLE).
  // The hand "Mark Posted" is not here: it rides `unticked[].mark_posted`, so
  // `in_campminder_not_ticked` stays null.
  award_above_cost: toRequest('Fix Cost or Grants'),
  in_campminder_not_ticked: null,
}

const stepFor = (code: string): NextStep | null => {
  const step = STEP_BY_CODE[code]
  return step === undefined ? OPEN_REQUEST : step
}

function holdQueue(code: string): ApiAidQueue {
  if (code === 'unmatched_session') return 'session_not_settled'
  if (code === 'duplicate_survivor_withdrawn') return 'duplicates'
  return 'holds'
}

/**
 * A grid item. The fact is dropped when the pill already says all of it (O1); the server's message
 * itself is untouched, since the household page and a release's saved fact read it.
 */
function gridItem(level: AttentionItem['level'], pill: string, fact: string): AttentionItem {
  return { level, pill, fact: pillCoversFact(pill, fact) ? '' : fact }
}

/** Why a To reverse row is here, when nothing else on it says so (F1a, F1b; O2). */
function toReversePrefix(row: ApiAidGridRow, cancelledOnShown: boolean): string {
  if (row.request_status === 'withdrawn') return 'Withdrawn: '
  if (row.request_status === 'duplicate') return 'Duplicate: '
  if (cancelledOnShown) return ''
  const on = row.cancellation?.on
  return `Cancelled${on ? ` ${formatShortDate(on)}` : ''}: `
}

/** A note item; `reason` defaults to the pill, for a pill that carries no figure. */
const note = (
  pill: string,
  fact: string,
  queue: ApiAidQueue | null,
  next: NextStep | null,
  reason: string = pill
): GridAttention => ({
  item: gridItem('note', pill, fact),
  reason,
  queue,
  next,
})

/** The first letter up: the cell's pills are in sentence case (owner rulings 10-04 late). */
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const CHECK_POSTING = toRequest('Check the Posting')
/** The mock's "Tick Accepted": the row's own Accepted tick (owner, title case). */
const TICK_ACCEPTED: NextStep = { kind: 'tick', label: 'Tick Accepted' }

function reconciliation(row: ApiAidGridRow): GridAttention | null {
  const c = row.confirmation
  if (!c || c.reconciled) return null
  switch (c.status) {
    case 'short':
    case 'over':
      // "Short $50" in the pill; formatGap stays lower case for the mid-sentence CM ✓ detail.
      return note(
        sentence(formatGap(c.locked, c.in_campminder) ?? c.status),
        `CampMinder shows ${formatMoney(c.in_campminder)}.`,
        'not_reconciled',
        CHECK_POSTING,
        sentence(c.status)
      )
    case 'not_in_campminder':
      return note(
        // Owner ruling V1 (10-03): one vocabulary with the back end's "Short in CM".
        'Missing in CM',
        `Posted ${formatMoney(c.locked)}; the last sync found nothing for it.`,
        'not_reconciled',
        CHECK_POSTING
      )
    case 'awaiting_sync':
      // No exception (owner V1, #2996): CM ✓ says pending, in the server's words. Retired: the
      // "awaiting tonight's sync" pill and its "Nothing to do" step.
      return null
    case 'reversed':
      // Always reconciled, so never reached; it has nothing posted that is live, and would read $0.
      return null
    case 'confirmed': {
      // Confirmed as a request, but a payer share isn't (D59, D81).
      const open = c.shares.filter((share) => share.status !== 'confirmed').length
      if (open === 0) return null
      return note(
        open === 1 ? 'A share unconfirmed' : `${String(open)} shares unconfirmed`,
        'Check the payer shares on the household page.',
        'not_reconciled',
        PAYER_SHARES,
        'Shares unconfirmed'
      )
    }
  }
}

/** Every item the row needs, most pressing first (Decision 7's order). */
export function attentionItems(
  row: ApiAidGridRow,
  today: string,
  cancelledOnShown = false
): GridAttention[] {
  const items: GridAttention[] = row.holds.map((hold) => ({
    item: gridItem('hold', codeWords(hold.code), hold.message),
    reason: codeWords(hold.code),
    queue: holdQueue(hold.code),
    next: stepFor(hold.code),
  }))
  if (row.to_reverse === true) {
    // The server's To reverse means live ledger lines remain, so the amount is what CampMinder
    // holds (`in_campminder`), not the lock (plan review, number-meaning fix 2).
    const live = row.confirmation?.in_campminder ?? null
    items.push(
      note(
        'Reverse posting',
        `${toReversePrefix(row, cancelledOnShown)}${
          live !== null
            ? `${formatMoney(live)} still live in CampMinder: reverse it there; the row clears on the next sync.`
            : 'Reverse the posting in CampMinder; the row clears on the next sync.'
        }`,
        'to_reverse',
        say('Reverse it in CampMinder; nothing to do here')
      )
    )
  }
  const pending = row.rounds.find((r) => r.status === 'pending_approval')
  if (pending !== undefined) {
    items.push(
      note(
        ROUND_STATUS_WORDS.pending_approval,
        `R${String(pending.round)} ${formatMoney(pending.pending_approval)} is above the registrar's limit: finance approves it from Today.`,
        'pending_approval',
        // Finance approves on the request's card (the household page's round actions).
        toRequest(`Approve Round ${String(pending.round)} (Finance)`)
      )
    )
  }
  // From the request's own status, so the view is never empty when the rules only warn about it (or
  // turn the check off): the server's membership is `request_status`, not the check's severity.
  if (
    row.request_status === 'unmatched_session' &&
    !row.holds.some((hold) => hold.code === 'unmatched_session')
  ) {
    items.push(
      note(
        codeWords('unmatched_session'),
        'Resolve it on the household page.',
        'session_not_settled',
        PICK_SESSION
      )
    )
  }
  if (row.request_status === 'duplicate_pending') {
    items.push(
      note(
        'Possible duplicate',
        `Same ${row.camper_name === '' ? 'family' : 'camper'} and session as another request: keep one on the household page.`,
        'duplicates',
        KEEP_ONE
      )
    )
  }
  const reconcile = reconciliation(row)
  if (reconcile !== null) items.push(reconcile)
  // #2996 direction (b): CampMinder holds money for a round the overnight tick refused. Why, as the
  // server says it: the pill (`label`) and a whole sentence (`message`). Where the server says a hand
  // tick is the way through (`mark_posted`), the step is Mark Posted on that round (owner, title case).
  for (const money of row.unticked ?? []) {
    items.push(
      note(
        money.label,
        money.message,
        'not_reconciled',
        money.mark_posted ? { kind: 'markPosted', label: 'Mark Posted', round: money.round } : null
      )
    )
  }
  if (row.queues?.includes('waiting_on_family') ?? false) {
    // A C1 round (#2996, `cm_pending`) waits before tonight's tick gives it a posting date: no count.
    const since = waitingSince(row)
    const waited = since === null ? null : (daysBetween(since, today) ?? 0)
    items.push(
      note(
        waited === null
          ? 'Waiting on the family'
          : `Waiting ${String(waited)} ${waited === 1 ? 'day' : 'days'}`,
        "The family hasn't replied: follow up, then tick Accepted.",
        'waiting_on_family',
        TICK_ACCEPTED,
        'Waiting on the family'
      )
    )
  }
  for (const issue of row.notes ?? []) {
    items.push(note(codeWords(issue.code), issue.message, null, stepFor(issue.code)))
  }
  return items
}

/** The one item the cell shows: a queue view's own item first, else the first that matters (D24). */
export function attentionFor(
  row: ApiAidGridRow,
  view: 'all' | ApiAidQueue,
  today: string,
  cancelledOnShown = false
): GridAttention | null {
  const items = attentionItems(row, today, cancelledOnShown)
  const own = view === 'all' ? undefined : items.find((item) => item.queue === view)
  return own ?? items[0] ?? null
}
