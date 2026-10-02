/**
 * Today's words (§6.4; D24; Decision 30): one dense line per queue, its count, its reasons inline,
 * and Open › to the list that holds them. Counts of work carry no basis word (D20).
 */
import type { ApiAidToday, ApiAidTodayLine } from '../../../types/api-types'
import { aidHref, type AidView } from '../kit/asOf'
import { formatMoney } from '../kit/money'
import { codeWords } from '../requests/attention'
import { REQUEST_VIEWS } from '../requests/views'

export type TodayKey = ApiAidTodayLine['key']

export const LINE_NAMES = {
  needs_offer: 'Needs an offer',
  holds: 'Holds',
  waiting_on_family: 'Waiting on the family',
  not_reconciled: 'Not reconciled',
  to_reverse: 'To reverse',
  session_not_settled: 'Session not settled',
  duplicates: 'Duplicates',
  cancel_reason: 'Cancelled: give a reason',
  grants: 'Grants needing attention',
  late_full_coverage: 'A late full-coverage grant',
  pending_approval: 'Pending approval',
  rules_sections: 'Rules sections awaiting approval',
  // Owner ruling 2026-10-01 S1 Q1: a posted amount stands, so this line is information, never a change.
  would_change: "Locked rounds today's rules price differently",
  sources: 'New CampMinder descriptions',
  intake: 'Intake health',
  // Lead default wording (an owner preview question): the server's weighted yes/no fields no applicant answered yes.
  equity_field_never_true: 'Equity question never answered yes',
} as const satisfies Record<TodayKey, string>

export function isTodayKey(value: string): value is TodayKey {
  return Object.hasOwn(LINE_NAMES, value)
}

/** Reason codes that aren't check codes: rounds, confirmation states, grant and description states. */
const REASON_WORDS: Readonly<Record<string, string>> = {
  r1: 'R1',
  r2: 'R2',
  r3: 'R3',
  awaiting_sync: "awaiting tonight's sync",
  short: 'short',
  over: 'over',
  not_in_campminder: 'not in CampMinder',
  needs_camper: 'needs a camper',
  not_posted: 'commitment not yet in CampMinder',
  posted_then_reversed: 'posted, then reversed',
  possible_match: 'possible match',
  camper_cancelled: 'camper cancelled',
  no_grantor: 'no grantor',
  unclassified: 'unclassified',
}

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`

/** "5 fam · 7 req", "3 grants", "1 section", "2 descriptions", "2 fields". */
export function countWords(line: ApiAidTodayLine): string {
  switch (line.item_kind) {
    case 'requests':
      return `${String(line.families ?? 0)} fam · ${String(line.items)} req`
    case 'grants':
      return plural(line.items, 'grant', 'grants')
    case 'sections':
      return plural(line.items, 'section', 'sections')
    case 'descriptions':
      return plural(line.items, 'description', 'descriptions')
    case 'fields':
      return plural(line.items, 'field', 'fields')
  }
}

/** A reason's words: a rules section and an equity field show as the server named them, every other code in words. */
function codeLabel(line: ApiAidTodayLine, code: string): string {
  if (line.key === 'rules_sections' || line.key === 'equity_field_never_true') return code
  return REASON_WORDS[code] ?? codeWords(code)
}

/** "Income conflict 1 · Placeholder income 1". */
export function reasonWords(line: ApiAidTodayLine): string {
  return (line.reasons ?? [])
    .map((reason) => `${codeLabel(line, reason.code)} ${String(reason.items)}`)
    .join(' · ')
}

/** The reasons, then the line's own facts (§6.4). The largest gap includes not in CampMinder (owner ruling). */
export function detailWords(line: ApiAidTodayLine): string {
  const parts: string[] = []
  const reasons = reasonWords(line)
  if (reasons !== '') parts.push(reasons)
  const oldest = line.oldest_days ?? null
  if (line.key === 'waiting_on_family' && oldest !== null) {
    parts.push(
      `oldest ${plural(oldest, 'day', 'days')}`,
      `${String(line.over_14_days ?? 0)} over 14 days`
    )
  }
  const largest = line.largest_gap ?? null
  if (line.key === 'not_reconciled' && largest !== null)
    parts.push(`largest ${formatMoney(largest)}`)
  const amount = line.amount ?? null
  if (line.key === 'pending_approval' && line.items > 0 && amount !== null)
    parts.push(`${formatMoney(amount)} awaiting finance`)
  if (line.key === 'late_full_coverage' && line.items > 0) parts.push('contact the family')
  // Owner ruling 2026-10-01 S1 Q1: once offered or posted, an amount stands.
  if (line.key === 'would_change' && line.items > 0)
    parts.push('information only · posted amounts stand')
  return parts.join(' · ')
}

const LISTED: ReadonlySet<TodayKey> = new Set(['late_full_coverage', 'would_change', 'intake'])
const ELSEWHERE: Partial<Record<TodayKey, string>> = {
  grants: '/aid/grants/needs-attention',
  rules_sections: '/aid/season/rules',
  sources: '/aid/money/sources',
}

/**
 * Where "Open ›" goes (#2924 "Open › targets"; Decision 10): a queue's own Requests view; a listed
 * line's exact rows (`?today=`); Grants, Season or Money for the rest. Nothing at zero, and nothing
 * for the equity fields (no view lists them).
 */
export function openHref(line: ApiAidTodayLine, view: AidView): string | null {
  if (line.items === 0) return null
  const elsewhere = ELSEWHERE[line.key]
  if (elsewhere !== undefined) return aidHref(elsewhere, view)
  if (LISTED.has(line.key)) return aidHref('/aid/requests', view, { view: 'all', today: line.key })
  const requestView = REQUEST_VIEWS.find((v) => v.key === line.key)
  return requestView ? aidHref('/aid/requests', view, { view: requestView.slug }) : null
}

export interface TodaySection {
  readonly title: string
  readonly lines: readonly ApiAidTodayLine[]
}

/** The sections the reader's permissions bring (§6.4): Casework (`casework`), Finance (`rules`). */
export function todaySections(today: ApiAidToday): TodaySection[] {
  const sections: TodaySection[] = []
  if (today.casework !== null) sections.push({ title: 'Casework', lines: today.casework })
  if (today.finance !== null) sections.push({ title: 'Finance', lines: today.finance })
  return sections
}

export type ListedTodayKey = 'late_full_coverage' | 'would_change' | 'intake'

/** Only the listed lines carry `request_ids` (the server sends [] for the rest), so only they filter the grid. */
export function isListedTodayKey(value: string): value is ListedTodayKey {
  return value === 'late_full_coverage' || value === 'would_change' || value === 'intake'
}

/**
 * The grid's and the walk's `?today=` filter (Decision 10), one state for both. A missing line is
 * unknown, never an empty one: `ready` with no ids is a true zero, while `pending`, `failed` and
 * `withheld` (the line's section is not sent to this role) are never read as "no requests".
 */
export type TodayFilter =
  | { readonly state: 'off' }
  | { readonly state: 'pending' }
  | { readonly state: 'failed' }
  | { readonly state: 'withheld' }
  | { readonly state: 'ready'; readonly ids: ReadonlySet<string> }

export function todayFilter(
  key: ListedTodayKey | null,
  read: { readonly data: ApiAidToday | undefined; readonly error: Error | null }
): TodayFilter {
  if (key === null) return { state: 'off' }
  if (read.data === undefined) return { state: read.error ? 'failed' : 'pending' }
  const sections = [read.data.casework, read.data.finance].filter((s) => s !== null)
  const found = sections.flat().find((l) => l.key === key)
  if (found === undefined) return { state: 'withheld' }
  return { state: 'ready', ids: new Set(found.request_ids ?? []) }
}
