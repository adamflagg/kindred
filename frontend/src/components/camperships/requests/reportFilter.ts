/**
 * Requests' `?report=` (slice 4 J, PENDING OWNER; D20): the requests behind one Reports count, from the
 * server's own list (#2974's `GET /reports/{year}/statistics/requests` and `…/programs/requests`), the way
 * `?op=` shows a History operation's. The value is the count's address: which report, then the query that
 * route takes (`statistics?part=tier&tier=1&count=apps&round=1`). The grid adds its own as-of, so the ids
 * are read on the same day as the rows they filter. Pure: the page reads it through `useAidReportRequests`.
 */
import type { ApiAidReportRequestIds } from '../../../types/api-types'

export type ReportKind = 'statistics' | 'programs'

/** One Reports count's address: its report and the requests route's query, without the as-of. */
export interface ReportAddress {
  readonly report: ReportKind
  readonly query: Readonly<Record<string, string>>
}

/** The query keys each route takes besides the as-of (api/routers/financial_aid.py, the two `/requests` routes). */
const KEYS: Readonly<Record<ReportKind, readonly string[]>> = {
  statistics: [
    'part',
    'table',
    'round',
    'basis',
    'through_round1_deadline',
    'received_through',
    'tier',
    'count',
    'reason',
    'pool',
    'posted_round',
    'outcome_row',
    'outcome',
    'appeals_count',
  ],
  programs: [
    'part',
    'block',
    'count',
    'pool',
    'session',
    'through_round1_deadline',
    'received_through',
  ],
}

/** The parameters a count's address needs before the route can answer it. */
const REQUIRED: Readonly<Record<ReportKind, readonly string[]>> = {
  statistics: ['part'],
  programs: ['part', 'block', 'count'],
}

const isReport = (raw: string): raw is ReportKind => raw === 'statistics' || raw === 'programs'

/** The URL value: `statistics?part=tier&tier=1&count=apps`. */
export function reportParam(address: ReportAddress): string {
  return `${address.report}?${new URLSearchParams({ ...address.query }).toString()}`
}

/**
 * The address a link carries, or null for a malformed one (the grid then shows every row, as an
 * unreadable `?op=` does). Keys the route doesn't take are dropped, never sent.
 */
export function parseReportParam(raw: string | null): ReportAddress | null {
  if (raw === null) return null
  const at = raw.indexOf('?')
  const report = at === -1 ? raw : raw.slice(0, at)
  if (!isReport(report)) return null
  const given = new URLSearchParams(at === -1 ? '' : raw.slice(at + 1))
  const query: Record<string, string> = {}
  for (const key of KEYS[report]) {
    const value = given.get(key)
    if (value !== null && value !== '') query[key] = value
  }
  if (REQUIRED[report].some((key) => query[key] === undefined)) return null
  return { report, query }
}

/** The ids the read sent; null until it lands (the page shows none of the rows meanwhile). */
export function reportRequestIds(
  data: ApiAidReportRequestIds | undefined
): ReadonlySet<string> | null {
  return data === undefined ? null : new Set(data.request_ids)
}

/** Two id filters at once (a History operation and a Reports count): the rows in both. */
export function bothIds(
  a: ReadonlySet<string> | null,
  b: ReadonlySet<string> | null
): ReadonlySet<string> | null {
  if (a === null) return b
  if (b === null) return a
  return new Set([...a].filter((id) => b.has(id)))
}

const REPORT_WORDS: Readonly<Record<ReportKind, string>> = {
  statistics: 'Statistics',
  programs: 'Statistics by session',
}

/** "The 12 requests behind one Statistics count". */
export function reportWords(n: number, report: ReportKind): string {
  return `The ${String(n)} ${n === 1 ? 'request' : 'requests'} behind one ${REPORT_WORDS[report]} count`
}

/** Ids the count holds that the grid's read doesn't (a request the grid leaves out). Said, never hidden. */
export function missingWords(missing: number): string | null {
  if (missing === 0) return null
  return `${String(missing)} of them ${missing === 1 ? "isn't" : "aren't"} in this list`
}

/** While the ids read is out: never "The 0 requests". */
export const REPORT_READING = 'Reading the requests behind one Reports count…'
export const REPORT_FAILED = "Couldn't read the requests behind that Reports count"

/**
 * The grid's line over a count's rows: its words once the ids land, "Reading…" while they're out, the
 * failure otherwise. `rowIds` is the grid read's request ids (null while it loads: nothing is called
 * missing before the rows are there).
 */
export function reportLine(
  report: ReportKind,
  data: ApiAidReportRequestIds | undefined,
  failed: boolean,
  rowIds: ReadonlySet<string> | null
): string {
  if (data === undefined) return failed ? REPORT_FAILED : REPORT_READING
  const words = reportWords(data.request_ids.length, report)
  if (rowIds === null) return words
  const missing = missingWords(data.request_ids.filter((id) => !rowIds.has(id)).length)
  return missing === null ? words : `${words} · ${missing}`
}
