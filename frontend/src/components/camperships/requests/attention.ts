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
  stage_enrollment_mismatch: 'Enrollment',
  unmatched_session: 'Session not settled',
  duplicate_survivor_withdrawn: 'Duplicate revived',
  awaiting_approved_rules: 'Awaiting rules',
  no_approved_rules: 'No approved rules',
  no_program_for_session: 'No program',
  not_priceable: 'Not priceable',
  manual_hold: 'On hold',
}

export function codeWords(code: string): string {
  const words = CODE_WORDS[code]
  if (words !== undefined) return words
  const plain = code.replaceAll('_', ' ')
  return plain.charAt(0).toUpperCase() + plain.slice(1)
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

export interface GridAttention {
  readonly item: AttentionItem
  /** The Requests view this item belongs to; null for a note that has none. */
  readonly queue: ApiAidQueue | null
  /** The next step's name, for All's action button (§4.4); null when none. */
  readonly action: string | null
}

const ACTION_BY_CODE: Readonly<Record<string, string>> = {
  household_income_conflict: 'Enter income',
  placeholder_income: 'Enter income',
  payer_shares_incomplete: 'Set shares',
  unmatched_session: 'Settle session',
}

function holdQueue(code: string): ApiAidQueue {
  if (code === 'unmatched_session') return 'session_not_settled'
  if (code === 'duplicate_survivor_withdrawn') return 'duplicates'
  return 'holds'
}

const note = (
  pill: string,
  fact: string,
  queue: ApiAidQueue | null,
  action: string | null = null
): GridAttention => ({
  item: { level: 'note', pill, fact },
  queue,
  action,
})

function reconciliation(row: ApiAidGridRow): GridAttention | null {
  const c = row.confirmation
  if (!c || c.reconciled) return null
  switch (c.status) {
    case 'short':
    case 'over':
      return note(
        formatGap(c.locked, c.in_campminder) ?? c.status,
        `CampMinder shows ${formatMoney(c.in_campminder)} against ${formatMoney(c.locked)} posted.`,
        'not_reconciled'
      )
    case 'not_in_campminder':
      return note(
        'not in CampMinder',
        `Posted ${formatMoney(c.locked)}; nothing is in CampMinder for it after the sync.`,
        'not_reconciled'
      )
    case 'awaiting_sync':
      return note(
        "awaiting tonight's sync",
        'Ticked Posted; the ledger confirms it overnight.',
        'not_reconciled'
      )
    case 'reversed':
      return note(
        'reversed',
        `CampMinder reversed the posting${c.on ? ` ${formatShortDate(c.on)}` : ''}; nothing of the ${formatMoney(c.locked)} posted is live.`,
        'not_reconciled'
      )
    case 'confirmed': {
      // Confirmed as a request, but a payer share isn't (D59, D81).
      const open = c.shares.filter((share) => share.status !== 'confirmed').length
      if (open === 0) return null
      return note(
        open === 1 ? 'a share unconfirmed' : `${String(open)} shares unconfirmed`,
        'The request is confirmed, but a payer share is not: see the household page.',
        'not_reconciled'
      )
    }
  }
}

/** Every item the row needs, most pressing first (Decision 7's order). */
export function attentionItems(row: ApiAidGridRow, today: string): GridAttention[] {
  const items: GridAttention[] = row.holds.map((hold) => ({
    item: { level: 'hold', pill: codeWords(hold.code), fact: hold.message },
    queue: holdQueue(hold.code),
    action: ACTION_BY_CODE[hold.code] ?? null,
  }))
  if (row.to_reverse === true) {
    const on = row.cancellation?.on
    const cancelled = `Cancelled${on ? ` ${formatShortDate(on)}` : ''}`
    // The server's To reverse means live ledger lines remain, so the amount is what CampMinder
    // holds (`in_campminder`), not the lock (plan review, number-meaning fix 2).
    const live = row.confirmation?.in_campminder ?? null
    items.push(
      note(
        'Reverse posting',
        live !== null
          ? `${cancelled}, but ${formatMoney(live)} is still live in CampMinder. Reverse it there; the row clears on the next sync.`
          : `${cancelled}. Posted ${formatMoney(row.total_posted)}; reverse it in CampMinder. The row clears on the next sync.`,
        'to_reverse'
      )
    )
  }
  for (const todo of row.todos ?? []) {
    items.push(
      note(
        'Give a reason',
        todo.message,
        todo.code === 'cancel_reason_missing' ? 'cancel_reason' : null,
        'Give a reason'
      )
    )
  }
  const pending = row.rounds.find((r) => r.status === 'pending_approval')
  if (pending !== undefined) {
    items.push(
      note(
        ROUND_STATUS_WORDS.pending_approval,
        `Round ${String(pending.round)} ${formatMoney(pending.pending_approval)} is above the registrar's limit: finance approves it from Today.`,
        'pending_approval'
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
        'The requested session is not matched: resolve it on the household page.',
        'session_not_settled',
        ACTION_BY_CODE['unmatched_session'] ?? null
      )
    )
  }
  if (row.request_status === 'duplicate_pending') {
    items.push(
      note(
        'Possible duplicate',
        'Another request matches this camper and session: keep one on the household page.',
        'duplicates'
      )
    )
  }
  const reconcile = reconciliation(row)
  if (reconcile !== null) items.push(reconcile)
  const since = waitingSince(row)
  if (since !== null && (row.queues?.includes('waiting_on_family') ?? false)) {
    const waited = daysBetween(since, today) ?? 0
    items.push(
      note(
        `Waiting ${String(waited)} ${waited === 1 ? 'day' : 'days'}`,
        `Posted ${formatShortDate(since)}; the family hasn't replied. Follow up, then tick Accepted.`,
        'waiting_on_family',
        'Mark accepted'
      )
    )
  }
  for (const issue of row.notes ?? []) {
    items.push(note(codeWords(issue.code), issue.message, null))
  }
  return items
}

/** The one item the cell shows: a queue view's own item first, else the first that matters (D24). */
export function attentionFor(
  row: ApiAidGridRow,
  view: 'all' | ApiAidQueue,
  today: string
): GridAttention | null {
  const items = attentionItems(row, today)
  const own = view === 'all' ? undefined : items.find((item) => item.queue === view)
  return own ?? items[0] ?? null
}
