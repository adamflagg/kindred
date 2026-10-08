/**
 * Reports › Statistics' words and tables (spec §9.2, §9.7 RPT-5, 9, 10, 22, 23; D80, D129–D131,
 * D157; statistics-v2.html). Pure: the tab renders these through `ReportTable`. Every figure and every
 * total is the server's (D21); nothing here adds, subtracts or divides one. Each count names the
 * requests behind it (slice 4 J): the address the grid's `?report=` reads, never an id list here.
 */
import type {
  ApiAidOutcomeRow,
  ApiAidRequestSetNote,
  ApiAidStatistics,
  ApiAidStatisticsRow,
} from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import { aidCsvFilename } from '../kit/csv'
import { formatLongDate } from '../kit/dates'
import {
  BASIS_WORDS,
  countValue,
  moneyValue,
  pctValue,
  textValue,
  type ReportColumn,
  type ReportHeading,
  type ReportRow,
  type ReportValue,
} from '../kit/report'
import type { ReportAddress } from '../requests/reportFilter'
import { requestSetParam } from '../season/scenarios/controlsModel'
import {
  ROUND_WORDS,
  statisticsChoiceQuery,
  type RoundChip,
  type StatisticsChoice,
} from './reportParams'

/** A figure's definition note number by its registry key (`useAidDefinitions().numberOf`). */
export type NoteOf = (key: string) => number | null

/** Where a count's requests open: the Requests grid on that address (the tab builds the href). */
export type LinkOf = (address: ReportAddress) => string

export const ALL_TABLES = 'All award tables'

/** The chip's words: the rules' label for the table the server answered, or All award tables. */
export function tableLabel(stats: ApiAidStatistics): string {
  if (stats.table === null) return ALL_TABLES
  return stats.tables.find((t) => t.key === stats.table)?.label ?? stats.table
}

/** The round the server answered, as a chip key. */
export function roundChipOf(stats: ApiAidStatistics): RoundChip {
  return stats.round === null ? 'all' : stats.round === 2 ? '2' : stats.round === 3 ? '3' : '1'
}

/** The decided basis adds amounts that move until posted (D130): never called awarded. */
export const isDecided = (stats: ApiAidStatistics) => stats.basis === 'posted_and_decided'

/**
 * The tier table's columns (slice 4 K and L, PENDING OWNER). Awarded is Posted alone on either basis
 * (the read's `awarded`, #2974); on the decided basis an amber "Decided (not yet offered)" sits beside
 * it, and the two % columns take the server's labels, which name "(posted + decided)" there (owner
 * B4a (b)). The average award and its population are the camp's Posted money (D157; owner R2a D5):
 * "Awards (camp aid)" so nobody compares it with Development's Number of awards, which counts every
 * source (L). % of ask's denominator, the live requests' in-budget asks, is its own column right
 * before it: it isn't the Asked column, which counts every app's ask, cancelled included (owner B4a (c)).
 */
export function tierColumns(stats: ApiAidStatistics, noteOf: NoteOf): ReportColumn[] {
  return [
    { key: 'tier', header: 'Tier' },
    { key: 'from', header: 'Income from' },
    { key: 'to', header: 'Income to' },
    { key: 'fee', header: 'Eligible fee %' },
    { key: 'apps', header: 'Apps', note: noteOf('apps'), divider: 'before' as const },
    { key: 'asked', header: 'Asked' },
    { key: 'asks', header: 'Asks' },
    { key: 'averageAsk', header: 'Avg ask' },
    { key: 'awarded', header: 'Awarded', note: noteOf('awarded') },
    ...(isDecided(stats)
      ? [
          {
            key: 'decided',
            header: 'Decided (not yet offered)',
            note: noteOf('decided_not_offered'),
            tone: 'decided' as const,
          },
        ]
      : []),
    { key: 'averageAward', header: 'Avg award', note: noteOf('average_award') },
    { key: 'awards', header: 'Awards' },
    { key: 'liveAsked', header: 'Asked (live, in budget)', note: noteOf('pct_of_ask') },
    { key: 'pct', header: stats.pct_of_ask_label, note: noteOf('pct_of_ask') },
    {
      key: 'pctGrants',
      header: stats.pct_of_ask_with_grants_label,
      note: noteOf('pct_of_ask_with_grants'),
    },
  ]
}

/**
 * The eligible fee %: the rules' value, "varies" on All award tables (§9.2), "—" where none. Round 3
 * has no table value, so the server's null there is "—" on All award tables too.
 */
function feeCell(fee: number | null, varies: boolean): ReportValue {
  if (fee !== null) return pctValue(fee)
  return textValue(varies ? 'varies' : '—')
}

function figureCells(row: ApiAidStatisticsRow, decided: boolean): ReportValue[] {
  return [
    countValue(row.apps),
    moneyValue(row.asked),
    countValue(row.asks),
    moneyValue(row.average_ask),
    // Posted alone on either basis (#2974): the screen never subtracts decided from `amount`
    moneyValue(row.awarded),
    ...(decided ? [moneyValue(row.decided)] : []),
    moneyValue(row.average_award),
    countValue(row.awarded_count),
    // % of ask's denominator, as sent (owner B4a (c)): never Asked, never computed here
    moneyValue(row.live_asked),
    pctValue(row.pct_of_ask),
    pctValue(row.pct_of_ask_with_grants),
  ]
}

/** The tier table's count columns and the server's name for each (`StatisticsCount`). */
const TIER_COUNTS = [
  ['apps', 'apps'],
  ['asks', 'asks'],
  ['awards', 'awarded'],
] as const

/** A Statistics count's address: the read's own choices, then the count (#2974's `part` and its keys). */
function statisticsAddress(
  choice: StatisticsChoice,
  count: Readonly<Record<string, string>>
): ReportAddress {
  return { report: 'statistics', query: { ...statisticsChoiceQuery(choice), ...count } }
}

/** A tier row's (or the total's) count links, by cell index. */
function tierLinks(
  keys: readonly string[],
  choice: StatisticsChoice,
  part: Readonly<Record<string, string>>,
  linkOf: LinkOf
): Record<number, string> {
  const links: Record<number, string> = {}
  for (const [column, count] of TIER_COUNTS) {
    links[keys.indexOf(column)] = linkOf(statisticsAddress(choice, { ...part, count }))
  }
  return links
}

/** One row per tier, then the "no tier" row the server sends, then its total (§9.2). */
export function tierRows(
  stats: ApiAidStatistics,
  choice: StatisticsChoice,
  linkOf: LinkOf
): ReportRow[] {
  const decided = isDecided(stats)
  const keys = tierColumns(stats, () => null).map((c) => c.key)
  // Round 3 has no table value: its null fee % is "—", never "varies" (m7)
  const varies = stats.table === null && stats.round !== 3
  const body = stats.rows.map((row, index): ReportRow => ({
    key: `tier-${row.tier === null ? 'none' : String(row.tier)}-${String(index)}`,
    kind: 'body',
    cells: [
      textValue(row.tier === null ? 'No tier' : String(row.tier)),
      moneyValue(row.income_from),
      row.income_to === null && row.tier !== null ? textValue('and up') : moneyValue(row.income_to),
      feeCell(row.fee_pct, varies),
      ...figureCells(row, decided),
    ],
    // the "no tier" row is the route's tier-absent row
    links: tierLinks(
      keys,
      choice,
      row.tier === null ? { part: 'tier' } : { part: 'tier', tier: String(row.tier) },
      linkOf
    ),
  }))
  const total: ReportRow = {
    key: 'total',
    kind: 'total',
    cells: [
      textValue(`${tableLabel(stats)} · ${ROUND_WORDS[roundChipOf(stats)]}`),
      textValue(''),
      textValue(''),
      textValue(''),
      ...figureCells(stats.total, decided),
    ],
    links: tierLinks(keys, choice, { part: 'total' }, linkOf),
  }
  return [...body, total]
}

/** The cancelled applicants' line (D131): the total's own count, and the link to its requests. */
export function cancelledApplicantsLink(choice: StatisticsChoice, linkOf: LinkOf): string {
  return linkOf(statisticsAddress(choice, { part: 'total', count: 'cancelled' }))
}

/** RPT-22: aid recipients who cancelled, by reason, pool and round (D131; owner R2a D24, B4b (a)). */
export function cancelledColumns(noteOf: NoteOf): ReportColumn[] {
  return [
    { key: 'reason', header: 'Reason' },
    { key: 'pool', header: 'Pool', align: 'left' },
    { key: 'round', header: 'Round', align: 'left' },
    { key: 'requests', header: 'Requests', note: noteOf('recipients_cancelled') },
    { key: 'posted', header: 'Locked amount' },
  ]
}

/** The reason and pool labels are the server's (#2974 sends `pool_label`; "No pool" for none). */
export function cancelledRows(
  stats: ApiAidStatistics,
  choice: StatisticsChoice,
  linkOf: LinkOf
): ReportRow[] {
  return stats.recipients_cancelled.map((row, index) => ({
    key: `${row.reason}-${row.pool ?? 'none'}-${String(row.round)}-${String(index)}`,
    kind: 'body',
    cells: [
      textValue(row.reason_label),
      textValue(row.pool_label),
      textValue(`Round ${String(row.round)}`),
      countValue(row.requests),
      moneyValue(row.posted),
    ],
    links: {
      3: linkOf(
        statisticsAddress(choice, {
          part: 'cancelled',
          reason: row.reason,
          posted_round: String(row.round),
          ...(row.pool === null ? {} : { pool: row.pool }),
        })
      ),
    },
  }))
}

/** RPT-9: Round 1 and appeals by tier, for the same award-table chip. No count opens anything yet. */
export function tierAppealsColumns(noteOf: NoteOf): ReportColumn[] {
  return [
    { key: 'tier', header: 'Tier' },
    { key: 'from', header: 'Income from' },
    { key: 'to', header: 'Income to' },
    { key: 'apps', header: 'R1 apps' },
    { key: 'fee', header: 'R1 eligible fee %' },
    { key: 'appeals', header: 'Appeals (R2)', note: noteOf('appeals') },
    { key: 'r2max', header: 'R2 max fee % (a rules value)', note: noteOf('round2_max_pct') },
    { key: 'r3', header: 'R3 awarded' },
    { key: 'rate', header: "Appeal rate (the dashboard's)", note: noteOf('appeal_rate') },
  ]
}

export function tierAppealsRows(stats: ApiAidStatistics): ReportRow[] {
  const allTables = stats.table === null
  // The server always ends RPT-9 with its totals (tier null, no band, no fee: statistics.py
  // tier_appeals); the row has no kind of its own, so its place is the contract.
  const last = stats.tier_appeals.length - 1
  return stats.tier_appeals.map((row, index): ReportRow => {
    if (index === last) {
      return {
        key: 'total',
        kind: 'total',
        cells: [
          textValue(tableLabel(stats)),
          textValue(''),
          textValue(''),
          countValue(row.round1_apps),
          textValue(''),
          countValue(row.appeals),
          textValue(''),
          moneyValue(row.round3_awarded),
          pctValue(row.appeal_rate),
        ],
      }
    }
    return {
      key: `appeals-${row.tier === null ? 'none' : String(row.tier)}-${String(index)}`,
      kind: 'body',
      cells: [
        textValue(row.tier === null ? 'No tier' : String(row.tier)),
        moneyValue(row.income_from),
        row.income_to === null && row.tier !== null
          ? textValue('and up')
          : moneyValue(row.income_to),
        countValue(row.round1_apps),
        feeCell(row.round1_fee_pct, allTables),
        countValue(row.appeals),
        feeCell(row.round2_max_pct, allTables),
        moneyValue(row.round3_awarded),
        pctValue(row.appeal_rate),
      ],
    }
  })
}

/** RPT-23: the March committee's outcomes per pool, then the server's no-pool row and all pools. */
export const OUTCOME_COLUMNS: readonly ReportColumn[] = [
  { key: 'pool', header: 'Pool' },
  { key: 'accepted', header: 'Accepted' },
  { key: 'acceptedAmount', header: 'Accepted $' },
  { key: 'appealed', header: 'Appealed' },
  { key: 'appealedAsked', header: 'Round 2 asked' },
  { key: 'waiting', header: 'Waiting for a response' },
]

/** The route's `outcome_row` for a row the read sent (`kind`, #2972); a reconciliation row has none. */
function outcomeRow(row: ApiAidOutcomeRow): Record<string, string> | null {
  if (row.kind === 'reconciliation') return null
  return row.kind === 'pool' && row.pool !== null
    ? { outcome_row: 'pool', pool: row.pool }
    : { outcome_row: row.kind }
}

/** Each pool's row, the no-pool row and the headline as the server marks them (`kind`), never by place. */
export function outcomeRows(
  stats: ApiAidStatistics,
  choice: StatisticsChoice,
  linkOf: LinkOf
): ReportRow[] {
  return stats.outcomes.map((row, index) => {
    const which = outcomeRow(row)
    const link = (outcome: string) =>
      which === null
        ? undefined
        : linkOf(statisticsAddress(choice, { part: 'outcome', ...which, outcome }))
    const links: Record<number, string> = {}
    for (const [cell, outcome] of [
      [1, 'accepted'],
      [3, 'appealed'],
      [5, 'waiting'],
    ] as const) {
      const href = link(outcome)
      if (href !== undefined) links[cell] = href
    }
    return {
      key: `outcome-${row.kind}-${row.pool ?? 'none'}-${String(index)}`,
      kind: row.kind === 'headline' ? 'total' : 'body',
      cells: [
        textValue(row.pool_label),
        countValue(row.accepted),
        moneyValue(row.accepted_amount),
        countValue(row.appealed),
        moneyValue(row.appealed_asked),
        countValue(row.waiting),
      ],
      links,
    }
  })
}

/**
 * The heading a copied or downloaded Statistics table carries (RPT-33). `withDecided` false for the
 * tables that hold no decided money (RPT-22, RPT-9, RPT-23): their basis is Posted on either switch.
 */
export function statisticsHeading(
  stats: ApiAidStatistics,
  title: string,
  withDecided = true
): ReportHeading {
  return {
    title,
    season: stats.year,
    figuresOn: stats.figures_on,
    live: stats.as_of === null,
    basis:
      withDecided && isDecided(stats)
        ? `${BASIS_WORDS.P}, plus Decided (not yet offered), which moves until posted`
        : BASIS_WORDS.P,
    requestSet: stats.request_set?.label ?? null,
  }
}

/** "Every figure below counts only requests received through Feb 1, 2027: 4 later requests left out." */
export function requestSetWords(report: {
  readonly request_set: ApiAidRequestSetNote | null
}): string | null {
  const set = report.request_set
  if (set === null) return null
  const unknown = set.unknown > 0 ? `, and ${String(set.unknown)} with no received date` : ''
  return `Every figure below counts only ${set.label}: ${String(set.left_out)} later requests left out${unknown}.`
}

/** A past date's empty figures (D154; slice 2 Decision 11's words): never an estimate. */
export function notRebuiltWords(stats: { not_rebuilt: readonly unknown[] }): string | null {
  return stats.not_rebuilt.length === 0
    ? null
    : 'A past date shows what the dashboard can rebuild exactly: a figure it can’t reads "—", never an estimate.'
}

/** "As of Apr 10, 2027 (live) · rules v3": the day the figures are as of, and the rules that priced them. */
export function asOfWords(figuresOn: string, live: boolean, rulesVersion: number | null): string {
  const rules = rulesVersion === null ? 'no approved rules' : `rules v${String(rulesVersion)}`
  return `As of ${formatLongDate(figuresOn)}${live ? ' (live)' : ''} · ${rules}`
}

/** The URL parameters that reproduce a Statistics view (D15), for links and the CSV's last line. */
export function statisticsLinkParams(choice: StatisticsChoice): Record<string, string> {
  const through = requestSetParam(choice.requestSet)
  return {
    ...(choice.rows === 'session' ? { rows: 'session' } : {}),
    ...(choice.table === null ? {} : { table: choice.table }),
    ...(choice.round === '1' ? {} : { round: choice.round }),
    ...(choice.decided ? { decided: '1' } : {}),
    ...(through === null ? {} : { through }),
  }
}

/** D70's file name: `camperships-reports-statistics-<table>-<round>[-decided][-through]-<season>[-as-of]`. */
export function statisticsCsvName(view: AidView, choice: StatisticsChoice, table: string): string {
  const through = requestSetParam(choice.requestSet)
  return aidCsvFilename({
    surface: 'reports',
    view: `statistics-${table}`,
    filters: [
      choice.table ?? 'all-tables',
      ROUND_WORDS[choice.round],
      ...(choice.decided ? ['decided'] : []),
      ...(through === null ? [] : [`through-${through}`]),
    ],
    season: view.year,
    asOf: view.asOf.kind === 'past' ? view.asOf.date : null,
  })
}
