/**
 * What Reports keep in the URL (§3.6; D15) and the query each read sends (spec §9.2, §9.3, §9.7).
 * Pure. Statistics: `?table=<award table key>` (none: All award tables, RPT-10), `?round=2|3|all`
 * (none: Round 1), `?rows=session` (the session table, not the tier table), `?decided=1` (Include not yet offered, D130; S4-3: off by default) and
 * `?through=deadline|<date>` (the reporting controls, D138: the same parameter as Scenarios'
 * request sets, so one control reads one way everywhere). One parameter holds both controls, so a
 * link can never ask for both at once (the server refuses that with a 422).
 */
import type { AidRequestSet } from '../../../services/camperships/aidApi'
import { asOfQuery, type AidAsOf } from '../kit/asOf'
import { parseRequestSet } from '../season/scenarios/controlsModel'

export type RoundChip = '1' | '2' | '3' | 'all'

export const ROUND_CHIPS: ReadonlyArray<{ readonly key: RoundChip; readonly label: string }> = [
  { key: '1', label: 'R1' },
  { key: '2', label: 'R2' },
  { key: '3', label: 'R3' },
  { key: 'all', label: 'All rounds' },
]

/** The round's words, for the totals row and the copied table's heading. */
export const ROUND_WORDS: Readonly<Record<RoundChip, string>> = {
  '1': 'Round 1',
  '2': 'Round 2',
  '3': 'Round 3',
  all: 'All rounds',
}

export function parseRoundChip(raw: string | null): RoundChip {
  return raw === '2' || raw === '3' || raw === 'all' ? raw : '1'
}

/** Statistics' rows (owner Q7): one per income tier, or one per session (the programs table). */
export type StatisticsRows = 'tier' | 'session'

/** What a Statistics link asks for. */
export interface StatisticsChoice {
  readonly table: string | null
  readonly round: RoundChip
  readonly decided: boolean
  readonly rows: StatisticsRows
  readonly requestSet: AidRequestSet
}

export function readStatisticsChoice(params: URLSearchParams): StatisticsChoice {
  const table = params.get('table')
  return {
    table: table === null || table === '' ? null : table,
    round: parseRoundChip(params.get('round')),
    decided: params.get('decided') === '1',
    rows: params.get('rows') === 'session' ? 'session' : 'tier',
    requestSet: parseRequestSet(params.get('through')),
  }
}

/** The request set's query (D138), as Scenarios' compare sends it. */
export function requestSetQuery(set: AidRequestSet): Record<string, string> {
  if (set.kind === 'deadline') return { through_round1_deadline: 'true' }
  if (set.kind === 'date') return { received_through: set.date }
  return {}
}

/**
 * Statistics' choices as the server takes them, without the as-of: the read adds the page's as-of;
 * a count's link (the requests behind it) carries exactly this, and the grid adds its own as-of.
 */
export function statisticsChoiceQuery(choice: StatisticsChoice): Record<string, string> {
  return {
    ...(choice.table === null ? {} : { table: choice.table }),
    round: choice.round,
    ...(choice.decided ? { basis: 'posted_and_decided' } : {}),
    ...requestSetQuery(choice.requestSet),
  }
}

/** Statistics' query: the chips, the basis, the request set and the page's as-of. */
export function statisticsQuery(choice: StatisticsChoice, asOf: AidAsOf): Record<string, string> {
  return { ...statisticsChoiceQuery(choice), ...asOfQuery(asOf) }
}

/** Programs' query (§9.3): the request set and the as-of. */
export function programsQuery(requestSet: AidRequestSet, asOf: AidAsOf): Record<string, string> {
  return { ...requestSetQuery(requestSet), ...asOfQuery(asOf) }
}

/**
 * The committee's query (§9.7): live only; a received-through date moves this season's RPT-2 cutoff
 * off the application deadline. "Through the deadline" is its default, so it sends nothing.
 */
export function committeeQuery(requestSet: AidRequestSet): Record<string, string> {
  return requestSet.kind === 'date' ? { received_through: requestSet.date } : {}
}
