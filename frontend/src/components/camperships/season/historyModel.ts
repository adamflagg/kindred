/**
 * Season › History (spec §7.6; D49; history.html B), pure. The server groups, filters, pages and
 * gates the log (D21); this module reads the page's URL into the read's query (D15) and, below,
 * words what each operation and row recorded, never recomputing an amount.
 */
import type { ApiAidHistoryKind, ApiAidHistoryPage } from '../../../types/api-types'
import { parseIsoDay } from '../kit/dates'

// ── Filters and paging (D15: the view lives in the URL) ───────────────────────

/** One page of the log (the router allows up to 200). */
export const PER_PAGE = 50

/** Each kind's chip and pill words (D49's chips; intake is a tick, not a chip). */
export const KIND_LABELS = {
  rules: 'Rules',
  offers: 'Offers & stages',
  money: 'Money edits',
  holds: 'Holds',
  grants: 'Grants',
  intake: 'Intake',
} as const satisfies Record<ApiAidHistoryKind, string>

const CHIP_ORDER: readonly ApiAidHistoryKind[] = ['rules', 'offers', 'money', 'holds', 'grants']

/** The kind chips, in the spec's order; Rules only for `rules` (D49, D76). */
export function chipKinds(canSeeRules: boolean): ApiAidHistoryKind[] {
  return CHIP_ORDER.filter((kind) => canSeeRules || kind !== 'rules')
}

export interface HistoryFilters {
  readonly kind: ApiAidHistoryKind | null
  readonly actor: string | null
  readonly since: string | null
  readonly until: string | null
  readonly q: string
  readonly intake: boolean
  readonly page: number
}

export type HistoryFilterKey = 'kind' | 'actor' | 'since' | 'until' | 'q' | 'intake' | 'page'

const MAX_ACTOR = 320
const MAX_TEXT = 200
const MAX_PAGE = 10_000
/** The router's first season (`_Year`, ge=2017): no aid log is older. */
const FIRST_SEASON = 2017

/**
 * A day the date filters take: a real day in a season's year. A date box typed year-first passes
 * through 0002-…, 0020-…, 0202-…, each a real day; the floor keeps those from being written (I4).
 */
export function isSeasonDay(value: string | null): value is string {
  if (value === null) return false
  const day = parseIsoDay(value)
  return day !== null && day.year >= FIRST_SEASON
}

/**
 * The view's filters from its URL. Anything the reader may not ask for, or the router would refuse
 * (an unknown kind, Rules without `rules`, a malformed day, a page out of range), reads as unset, so
 * a pasted link never fails the read.
 */
export function parseHistoryFilters(params: URLSearchParams, canSeeRules: boolean): HistoryFilters {
  const kind = params.get('kind')
  const page = Number(params.get('page') ?? '1')
  const since = params.get('since')
  const until = params.get('until')
  const actor = (params.get('actor') ?? '').slice(0, MAX_ACTOR)
  return {
    kind: chipKinds(canSeeRules).find((k) => k === kind) ?? null,
    actor: actor === '' ? null : actor,
    since: isSeasonDay(since) ? since : null,
    until: isSeasonDay(until) ? until : null,
    q: (params.get('q') ?? '').trim().slice(0, MAX_TEXT),
    intake: params.get('intake') === '1',
    page: Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1,
  }
}

/** The read's query, in the router's names: only what is set. */
export function historyQuery(filters: HistoryFilters): Record<string, string> {
  const query: Record<string, string> = {}
  if (filters.kind !== null) query['kind'] = filters.kind
  if (filters.actor !== null) query['actor'] = filters.actor
  if (filters.since !== null) query['since'] = filters.since
  if (filters.until !== null) query['until'] = filters.until
  if (filters.q !== '') query['q'] = filters.q
  if (filters.intake) query['include_intake'] = 'true'
  if (filters.page > 1) query['page'] = String(filters.page)
  query['per_page'] = String(PER_PAGE)
  return query
}

/** The URL after one filter changes. Any change but the page's own goes back to page 1. */
export function withFilter(
  previous: URLSearchParams,
  key: HistoryFilterKey,
  value: string | null
): URLSearchParams {
  const next = new URLSearchParams(previous)
  if (value === null || value === '') next.delete(key)
  else next.set(key, value)
  if (key !== 'page') next.delete('page')
  return next
}

const OPERATION_ID = /^[a-z0-9]{15}$/

/** The opened lines (`open=`, comma-separated operation ids): a fold, so it is view state (D15). */
export function parseOpen(raw: string | null): string[] {
  if (raw === null) return []
  return [...new Set(raw.split(',').filter((id) => OPERATION_ID.test(id)))]
}

/** `open=` after one line is clicked; null when none is left open. */
export function toggleOpen(open: readonly string[], id: string): string | null {
  const next = open.includes(id) ? open.filter((o) => o !== id) : [...open, id]
  return next.length === 0 ? null : next.join(',')
}

const operations = (n: number) => (n === 1 ? 'operation' : 'operations')

/** "1–50 of 312 operations"; nothing matching, or a page past the end, says so. */
export function pageWords(page: ApiAidHistoryPage): string {
  if (page.total === 0) return 'No operations match.'
  if (page.operations.length === 0) {
    return `Nothing on page ${String(page.page)}: ${String(page.total)} ${operations(page.total)} match${page.total === 1 ? 'es' : ''}.`
  }
  const first = (page.page - 1) * page.per_page + 1
  const last = first + page.operations.length - 1
  return `${String(first)}–${String(last)} of ${String(page.total)} ${operations(page.total)}`
}

/** The last page there is (1 when nothing matches). */
export function lastPage(page: ApiAidHistoryPage): number {
  return Math.max(1, Math.ceil(page.total / page.per_page))
}
