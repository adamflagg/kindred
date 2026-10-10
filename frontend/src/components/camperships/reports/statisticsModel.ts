/**
 * Reports › Statistics' words and tables (spec §9.2, §9.7 RPT-5, 9, 10, 22, 23; D80, D129–D131,
 * D157; the approved final mock reports-statistics.html). Pure: the tab renders these through `ReportTable`. Every figure and every
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
import {
  BASIS_WORDS,
  averageValue,
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

/**
 * The award-table segment's words (mock: All · C&Q · TBM · Weekend): the rules' label with its program
 * word dropped, and the long "Camp & Quest" as C&Q. The full label is the segment's title.
 */
export function tableShortLabel(table: { readonly key: string; readonly label: string }): string {
  if (table.label === 'Camp & Quest') return 'C&Q'
  return table.label.replace(/ Programs$/, '')
}

/** How many later requests the request set left out (the picker's title, the cancelled line), or null. */
export function requestSetLeftOut(report: {
  readonly request_set: ApiAidRequestSetNote | null
}): number | null {
  const set = report.request_set
  return set === null || set.left_out === 0 ? null : set.left_out
}

/** The round the server answered, as a chip key. */
export function roundChipOf(stats: ApiAidStatistics): RoundChip {
  return stats.round === null ? 'all' : stats.round === 2 ? '2' : stats.round === 3 ? '3' : '1'
}

/** The decided basis adds amounts that move until posted (D130): never called awarded. */
export const isDecided = (stats: ApiAidStatistics) => stats.basis === 'posted_and_decided'

/**
 * The tier table's columns (slice 4 K and L; the approved final mock reports-statistics.html). Awarded is
 * Posted alone on either basis (the read's `awarded`, #2974); on the decided basis an amber "Decided"
 * column (its title says "not yet offered") sits beside it, and the two % columns turn amber, each title
 * naming "(posted + decided)" in full (owner B4a (b)). The average award and its population are the
 * camp's Posted money (D157; owner R2a D5): "Awards" so nobody compares it with Development's
 * Grants/Awards, which counts every source (L). % of ask's denominator, the live requests' in-budget
 * asks, is its own column ("In-budget ask") right before it: it isn't the Asked column, which counts
 * every app's ask, cancelled included (owner B4a (c)). Headers are short; the full words are titles.
 */
export function tierColumns(stats: ApiAidStatistics, noteOf: NoteOf): ReportColumn[] {
  const decided = isDecided(stats)
  // With Include not yet offered on, the two % headers turn amber instead of growing words that would
  // wrap the row; each title says "(posted + decided)" in full (owner B4a (b); final mock).
  const percent = (what: string, tail: string) => ({
    title: `${what}${decided ? ' (posted + decided)' : ''}${tail}`,
    ...(decided ? { tone: 'decided-ink' as const } : {}),
  })
  return [
    { key: 'tier', header: 'Tier' },
    { key: 'from', header: 'Income from', width: 98 },
    { key: 'to', header: 'Income to', width: 92 },
    {
      key: 'fee',
      header: 'Eligible fee %',
      width: 106,
      title: 'The fee share this tier pays under the chosen award table; "varies" across tables',
    },
    {
      key: 'apps',
      header: 'Apps',
      note: noteOf('apps'),
      divider: 'before' as const,
      width: 66,
    },
    {
      key: 'asked',
      header: 'Asked',
      width: 92,
      title:
        "Every app's ask, cancelled and closed ones included, at most its session's cost (an appeal counts on top of the earlier awards, as Development's need)",
    },
    {
      key: 'askedTyped',
      header: 'Asked (as typed)',
      // the raw sum of what was asked, beside the capped Asked: in Copy and Download CSV only (owner A3, 2026-10-09)
      exportOnly: true,
      title: "Every app's ask exactly as typed, before the session-cost cap",
    },
    { key: 'asks', header: 'Asks', width: 58, title: 'One per round asked' },
    { key: 'averageAsk', header: 'Avg ask', width: 78 },
    { key: 'awarded', header: 'Awarded', note: noteOf('awarded'), width: 94 },
    ...(decided
      ? [
          {
            key: 'decided',
            header: 'Decided',
            note: noteOf('decided_not_offered'),
            tone: 'decided-ink' as const,
            width: 78,
            title: 'Decided (not yet offered): moves until posted',
          },
        ]
      : []),
    { key: 'averageAward', header: 'Avg award', note: noteOf('average_award'), width: 90 },
    { key: 'awards', header: 'Awards', note: noteOf('awarded'), width: 72 },
    {
      key: 'liveAsked',
      header: 'In-budget ask',
      note: noteOf('pct_of_ask'),
      divider: 'before' as const,
      width: 106,
      title: "Asked (live, in budget): each round's ask as it stands today, on live requests",
    },
    {
      key: 'pct',
      header: '% of ask',
      note: noteOf('pct_of_ask'),
      width: 84,
      ...percent('% of ask', decided ? ': amber while Include not yet offered is on' : ''),
    },
    {
      key: 'pctGrants',
      header: '% incl. grants',
      note: noteOf('pct_of_ask'),
      width: 110,
      ...percent(
        '% of ask incl. grants',
        `${decided ? ': amber while Include not yet offered is on' : ''}. Round 1 and All rounds only: a grant belongs to the request, not a round.`
      ),
    },
  ]
}

/**
 * The eligible fee %: the rules' value, "varies" on All award tables (§9.2), "—" where none. Round 3
 * has no table value, so the server's null there is "—" on All award tables too.
 */
function feeCell(fee: number | null, varies: boolean, why: string): ReportValue {
  if (fee !== null) return pctValue(fee)
  // a word where a figure would be: quieter, and its title says what to do (final mock)
  return varies ? { ...textValue('varies'), muted: true, title: why } : textValue('—')
}

const VARIES_FEE = 'Each award table sets its own fee share: pick one to see it'

function figureCells(row: ApiAidStatisticsRow, decided: boolean): ReportValue[] {
  return [
    countValue(row.apps),
    moneyValue(row.asked),
    moneyValue(row.asked_as_typed),
    countValue(row.asks),
    averageValue(row.average_ask),
    // Posted alone on either basis (#2974): the screen never subtracts decided from `amount`
    moneyValue(row.awarded),
    ...(decided ? [moneyValue(row.decided)] : []),
    averageValue(row.average_award),
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
    // "No tier" stays after the tiers, muted italic (final mock)
    kind: row.tier === null ? 'end' : 'body',
    cells: [
      textValue(row.tier === null ? 'No tier' : String(row.tier)),
      moneyValue(row.income_from),
      row.income_to === null && row.tier !== null ? textValue('and up') : moneyValue(row.income_to),
      feeCell(row.fee_pct, varies, VARIES_FEE),
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
  const label = `${tableLabel(stats)} · ${ROUND_WORDS[roundChipOf(stats)]}`
  const set = stats.request_set
  const total: ReportRow = {
    key: 'total',
    kind: 'total',
    // the label spans Tier..Eligible fee %, with the P pill at its right end: this table has no heading row
    span: 4,
    badge: 'P',
    cells: [
      {
        ...textValue(set === null ? label : `${label} · ${set.label.replace(/^requests /, '')}`),
        title: `${set === null ? label : `${label}: counts only ${set.label}`} · subtotals and this total are pooled ratios, not averages of the rows`,
      },
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
export function cancelledColumns(_noteOf: NoteOf): ReportColumn[] {
  return [
    { key: 'reason', header: 'Reason' },
    { key: 'pool', header: 'Pool', align: 'left', width: 200 },
    { key: 'round', header: 'Round', align: 'left', width: 140 },
    {
      key: 'requests',
      header: 'Requests',
      width: 120,
      // its words are the title: no note mark (the footer is six notes)
      title:
        'Requests with a posted award later cancelled or withdrawn. A confirmed duplicate that holds one is on its own Duplicate line. Once cancelled, a request is already out of Awarded.',
    },
    {
      key: 'posted',
      header: 'Locked amount',
      width: 140,
      title: "The lock's amount, even if clawed back since",
    },
  ]
}

/** A reason label's first letter in capitals: the server's words are sentence fragments. */
const capitalised = (words: string) => words.charAt(0).toUpperCase() + words.slice(1)

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
      textValue(capitalised(row.reason_label)),
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

/** RPT-9: Round 1 and appeals by tier, for the same award-table chip. Its two counts open their requests. */
export function tierAppealsColumns(noteOf: NoteOf): ReportColumn[] {
  return [
    { key: 'tier', header: 'Tier', width: 70 },
    { key: 'from', header: 'Income from', width: 110 },
    { key: 'to', header: 'Income to', width: 110 },
    { key: 'apps', header: 'R1 apps', note: noteOf('apps'), divider: 'before', width: 90 },
    { key: 'fee', header: 'R1 eligible fee %', width: 130 },
    {
      key: 'appeals',
      header: 'Appeals (R2)',
      note: noteOf('appeals'),
      divider: 'before',
      width: 120,
    },
    {
      key: 'r2max',
      header: 'R2 max fee %',
      note: noteOf('appeals'),
      width: 120,
      title:
        "A rules value: the most Round 1 and Round 2 aid together may cover, as a % of the session's cost",
    },
    { key: 'r3', header: 'R3 awarded', width: 110 },
    {
      key: 'rate',
      header: 'Appeal rate',
      note: noteOf('appeals'),
      width: 110,
      title: 'The dashboard derives it; no deck gives it per tier',
    },
  ]
}

/** RPT-9's count columns (cell index) and the server's name for each (`appeals_count`). */
const APPEALS_COUNTS = [
  [3, 'round1_apps'],
  [5, 'appeals'],
] as const

/** A row's (or the totals') two count links: its part, then each count (the route ignores the round chip). */
function appealsLinks(
  choice: StatisticsChoice,
  part: Readonly<Record<string, string>>,
  linkOf: LinkOf
): Record<number, string> {
  const links: Record<number, string> = {}
  for (const [cell, count] of APPEALS_COUNTS) {
    links[cell] = linkOf(statisticsAddress(choice, { ...part, appeals_count: count }))
  }
  return links
}

export function tierAppealsRows(
  stats: ApiAidStatistics,
  choice: StatisticsChoice,
  linkOf: LinkOf
): ReportRow[] {
  const allTables = stats.table === null
  // The server always ends RPT-9 with its totals (tier null, no band, no fee: statistics.py
  // tier_appeals); the row has no kind of its own, so its place is the contract.
  const last = stats.tier_appeals.length - 1
  return stats.tier_appeals.map((row, index): ReportRow => {
    if (index === last) {
      return {
        key: 'total',
        kind: 'total',
        span: 3,
        cells: [
          {
            ...textValue(tableLabel(stats)),
            title: `${tableLabel(stats)} · Round 1 and its appeals`,
          },
          textValue(''),
          textValue(''),
          countValue(row.round1_apps),
          textValue(''),
          countValue(row.appeals),
          textValue(''),
          moneyValue(row.round3_awarded),
          pctValue(row.appeal_rate),
        ],
        links: appealsLinks(choice, { part: 'total_appeals' }, linkOf),
      }
    }
    return {
      key: `appeals-${row.tier === null ? 'none' : String(row.tier)}-${String(index)}`,
      kind: row.tier === null ? 'end' : 'body',
      cells: [
        textValue(row.tier === null ? 'No tier' : String(row.tier)),
        moneyValue(row.income_from),
        row.income_to === null && row.tier !== null
          ? textValue('and up')
          : moneyValue(row.income_to),
        countValue(row.round1_apps),
        feeCell(row.round1_fee_pct, allTables, 'Each award table sets its own fee share'),
        countValue(row.appeals),
        feeCell(
          row.round2_max_pct,
          allTables,
          'Blank on All award tables: each table has its own Round 2 caps'
        ),
        moneyValue(row.round3_awarded),
        pctValue(row.appeal_rate),
      ],
      // the "no tier" row is the route's tier-absent row
      links: appealsLinks(
        choice,
        row.tier === null
          ? { part: 'tier_appeals' }
          : { part: 'tier_appeals', tier: String(row.tier) },
        linkOf
      ),
    }
  })
}

/** RPT-23: the March committee's outcomes per pool, then the server's no-pool row and all pools. */
export const OUTCOME_COLUMNS: readonly ReportColumn[] = [
  { key: 'pool', header: 'Pool' },
  { key: 'accepted', header: 'Accepted', width: 150 },
  { key: 'acceptedAmount', header: 'Accepted $', width: 160 },
  { key: 'appealed', header: 'Appealed', width: 150 },
  {
    key: 'appealedAsked',
    header: 'Round 2 asked',
    width: 160,
    title:
      'Round 2 asks on requests not cancelled, as Season shows them. Appeals in the table above count cancelled requests too.',
  },
  { key: 'waiting', header: 'Waiting for a response', width: 200 },
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
      kind: row.kind === 'headline' ? 'total' : row.kind === 'no_pool' ? 'end' : 'body',
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
  withDecided = true,
  notes?: readonly string[]
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
    ...(notes === undefined ? {} : { notes }),
  }
}

/** A past date's empty figures (D154; slice 2 Decision 11's words): never an estimate. */
export function notRebuiltWords(stats: { not_rebuilt: readonly unknown[] }): string | null {
  return stats.not_rebuilt.length === 0
    ? null
    : 'A past date shows what the dashboard can rebuild exactly: a figure it can’t reads "—", never an estimate.'
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

/**
 * Rule M on Asked (owner 10-09, A1/A2 2026-10-09): every Asked figure counts at most the priced session's cost.
 * This line counts the requests whose need is above that cost (the All-rounds basis, whatever the chip), under
 * the tier table; null when there are none.
 */
export function cappedAskWords(total: {
  readonly requests_capped?: number | undefined
}): string | null {
  const n = total.requests_capped ?? 0
  if (n === 0) return null
  const noun = n === 1 ? 'request above its' : 'requests above their'
  return `Asked and Avg ask: ${String(n)} ${noun} session's cost counted at the cost.`
}

/** Why the round chips need not add up to All rounds (owner A2, 2026-10-09). */
export const ROUND_CHIPS_NOTE =
  "Round chips don't add up to All rounds: an appeal re-asks part of the earlier shortfall, so All rounds counts it once."

/** The tier table's footnote lines: the chips note always, the cap words when some requests were capped. */
export function tierNotes(total: { readonly requests_capped?: number | undefined }): string[] {
  const capped = cappedAskWords(total)
  return capped === null ? [ROUND_CHIPS_NOTE] : [ROUND_CHIPS_NOTE, capped]
}
