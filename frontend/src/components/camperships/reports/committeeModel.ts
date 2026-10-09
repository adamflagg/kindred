/**
 * The committee's year-over-year tables (spec §9.7 RPT-1, 2, 6, 7, 8, 13, 24; D132, D133, D155;
 * owner N2 (C); the approved final mock reports-yoy.html). Pure. Each season row carries its basis,
 * P (the dashboard's Posted) or r (as reported, typed once), and every figure, %, band and over/under is
 * the server's (D21: "the dashboard computes every %" means the server does). Four tables: the phases,
 * the cutoff, the budget, and appeals with Round 1's % of ask merged; the columns the dashboard added
 * beyond finance's slides are `csvOnly` (hidden, kept in the CSV).
 */
import type {
  ApiAidApplicationsRow,
  ApiAidCommitteeReport,
  ApiAidCounted,
  ApiAidPhaseRow,
} from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import { aidCsvFilename } from '../kit/csv'
import { formatShortDate } from '../kit/dates'
import { formatMoney, moneyCsv } from '../kit/money'
import {
  BASIS_WORDS,
  countValue,
  averageValue,
  moneyValue,
  pctValue,
  textValue,
  type ReportColumn,
  type ReportHeading,
  type ReportRow,
  type ReportValue,
} from '../kit/report'
import { askWithNow, bandedPct, noteCell, poolCell, seasonCell } from './committeeCells'
import type { NoteOf } from './statisticsModel'

export { seasonWords } from './committeeCells'

/** `?phases=share` shows each phase as a share of the phases' sum; the default is % of budget (R1). */
export type PhaseShare = 'budget' | 'share'

export function parsePhaseShare(raw: string | null): PhaseShare {
  return raw === 'share' ? 'share' : 'budget'
}

/** `?pools=pool` splits the cutoff, budget and Round 1 tables by pool; the default is all pools. */
export type PoolsView = 'all' | 'pool'

export function parsePools(raw: string | null): PoolsView {
  return raw === 'pool' ? 'pool' : 'all'
}

/** The three phases in the read's order (D155): by the deadline, after it, appeals. */
export const PHASE_NAMES = [
  '1 · Round 1 by the deadline',
  '2 · Round 1 after the deadline',
  '3 · Appeals (Rounds 2 and 3)',
] as const

/** One sign convention, stated in words (§9.7): "$40,000 under", "on budget". */
export function overUnderWords(
  variance: number | null,
  side: 'over' | 'under' | 'on' | null
): string {
  if (variance === null || side === null) return '—'
  return side === 'on' ? 'on budget' : `${formatMoney(Math.abs(variance))} ${side}`
}

/** Over / under as a cell: the words on screen and in Copy, the signed variance in the CSV (§11). */
function overUnderValue(
  variance: number | null,
  side: 'over' | 'under' | 'on' | null
): ReportValue {
  return textValue(overUnderWords(variance, side), moneyCsv(variance))
}

/** RPT-1's two column words (owner N2), as the read sends them on each `PhaseRowOut`. */
export interface PhaseLabels {
  readonly offered: string
  readonly end: string
}

/** Today's words, only while the read has no row to take them from. */
const DEFAULT_PHASE_LABELS: PhaseLabels = { offered: 'As offered', end: 'End of season' }

/** The headers come from the read's first row; each row still says "· to date" itself (N2). */
export function phaseLabels(committee: ApiAidCommitteeReport): PhaseLabels {
  const first = committee.phases[0]
  return first === undefined
    ? DEFAULT_PHASE_LABELS
    : { offered: first.offered_label, end: first.end_of_season_label }
}

/** Every table's season cell: "to date" while the season's phases say it still moves. */
function season(committee: ApiAidCommitteeReport, year: number, basis: 'P' | 'r'): ReportValue {
  const toDate = committee.phases.some((p) => p.year === year && p.basis === basis && p.to_date)
  return seasonCell(year, basis, toDate)
}

const OFFERED_TITLE = 'The lock as posted; a later cancellation never reduces it'
const END_TITLE = 'Net of cancellations and clawback; "to date" until the season closes'
const PCT_TITLE =
  'End of season as a % of the budget. The mark compares As offered with the target band: ✓ in it, ↓ below, ↑ above (hover for the band).'
const SHARE_TITLE =
  "Each phase's End of season as a share of the three phases (the deck's pie). Bands compare % of budget, so they hide here."

export function phaseColumns(
  share: PhaseShare,
  noteOf: NoteOf,
  labels: PhaseLabels = DEFAULT_PHASE_LABELS
): ReportColumn[] {
  const budget = share === 'budget'
  return [
    { key: 'season', header: 'Season', note: noteOf('as_reported') },
    ...PHASE_NAMES.flatMap((group, index): ReportColumn[] => [
      {
        key: `p${String(index)}-offered`,
        header: labels.offered,
        group,
        ...(index === 0 ? { groupNote: noteOf('round1_phases') } : {}),
        divider: 'before',
        title: OFFERED_TITLE,
        wrap: true,
      },
      { key: `p${String(index)}-end`, header: labels.end, group, title: END_TITLE, wrap: true },
      {
        key: `p${String(index)}-pct`,
        header: budget ? '% of budget' : '% of phases',
        group,
        title: budget ? PCT_TITLE : SHARE_TITLE,
        wrap: true,
      },
    ]),
    { key: 'total', header: labels.end, group: 'Total', divider: 'before', wrap: true },
    { key: 'totalPct', header: '% of budget', group: 'Total', wrap: true },
    {
      key: 'budget',
      header: 'Budget',
      group: '',
      note: noteOf('finance_budget'),
      divider: 'before',
    },
    { key: 'overUnder', header: 'Over / under', group: '' },
  ]
}

export function phaseRows(committee: ApiAidCommitteeReport, share: PhaseShare): ReportRow[] {
  return committee.phases.map((row: ApiAidPhaseRow) => {
    const cells: ReportValue[] = [season(committee, row.year, row.basis)]
    for (let i = 0; i < PHASE_NAMES.length; i += 1) {
      const end = share === 'budget' ? row.pct_of_budget[i] : row.share_of_phases[i]
      cells.push(
        moneyValue(row.offered[i]),
        moneyValue(row.phases[i]),
        share === 'budget'
          ? bandedPct(end, row.offered_pct_of_budget[i], row.bands[i])
          : {
              ...pctValue(end),
              ...(end === null || end === undefined
                ? {}
                : { title: `${end.toFixed(1)}% of the three phases' End of season sum` }),
            }
      )
    }
    cells.push(
      moneyValue(row.total),
      pctValue(row.total_pct_of_budget),
      moneyValue(row.budget),
      overUnderValue(row.variance, row.side)
    )
    return { key: `phases-${String(row.year)}-${row.basis}`, kind: 'body', cells }
  })
}

/**
 * "Total − Σ phases: 2025 $21,000. The typed total is more than its three phases, shown rather than
 * hidden.": the seasons whose typed total isn't the phases' sum, the server's figure for each (D21).
 * Null when every season adds up: nothing is drawn.
 */
export function reconciliationWords(committee: ApiAidCommitteeReport): string | null {
  const off = committee.phases.filter(
    (row) => row.reconciliation !== null && row.reconciliation !== 0
  )
  if (off.length === 0) return null
  const sides = new Set(off.map((row) => ((row.reconciliation ?? 0) > 0 ? 'more' : 'less')))
  const than = sides.size === 1 ? `is ${[...sides][0] ?? 'more'} than` : 'differs from'
  return `Total − Σ phases: ${off.map((row) => `${String(row.year)} ${formatMoney(row.reconciliation)}`).join(' · ')}. The typed total ${than} its three phases, shown rather than hidden.`
}

// --- the cutoff table (RPT-2, RPT-6) ------------------------------------------------------------

const counted = (c: ApiAidCounted | null): ReportValue[] => [
  countValue(c?.apps ?? null),
  moneyValue(c?.asked ?? null),
  averageValue(c?.average ?? null),
]

export function applicationColumns(noteOf: NoteOf): ReportColumn[] {
  return [
    { key: 'season', header: 'Season' },
    { key: 'pool', header: 'Pool', align: 'left' },
    {
      key: 'cutoff',
      header: 'Cutoff',
      align: 'left',
      title:
        "The Round 1 deadline, or the date in Received through (this season only). A typed season shows the deck's date.",
    },
    {
      key: 'cutApps',
      header: 'Apps',
      group: 'At the cutoff',
      note: noteOf('committee_apps'),
      divider: 'before',
    },
    { key: 'cutAsked', header: 'Asked', group: 'At the cutoff' },
    { key: 'cutAvg', header: 'Avg ask', group: 'At the cutoff' },
    { key: 'sinceApps', header: 'Apps', group: 'Received since', divider: 'before' },
    { key: 'sinceAsked', header: 'Asked', group: 'Received since' },
    { key: 'sinceAvg', header: 'Avg ask', group: 'Received since', csvOnly: true },
    { key: 'endApps', header: 'Apps', group: 'Season end', divider: 'before' },
    { key: 'endAsked', header: 'Asked', group: 'Season end' },
    { key: 'endAvg', header: 'Avg ask', group: 'Season end', csvOnly: true },
    { key: 'endAsOf', header: 'As of', group: 'Season end', csvOnly: true },
    { key: 'changeApps', header: 'Apps', group: 'vs last year', divider: 'before' },
    { key: 'changeAsked', header: 'Asked', group: 'vs last year', csvOnly: true },
  ]
}

/** "+12", "−3", "0": a change against last year, signed as the mock draws it. */
function signed(value: number | null, format: (n: number) => string): string {
  if (value === null) return '—'
  if (value === 0) return '0'
  return value > 0 ? `+${format(value)}` : `−${format(-value)}`
}

function applicationLine(
  committee: ApiAidCommitteeReport,
  row: ApiAidApplicationsRow,
  total: boolean,
  indent: boolean,
  key: string
): ReportRow {
  const asks =
    row.asks_basis === 'now'
      ? `Asks as they stand now${row.asks_reason ? `: ${row.asks_reason}` : ''}`
      : undefined
  const at = counted(row.at_cutoff)
  const changeApps = countValue(row.change_apps)
  const changeAsked = moneyValue(row.change_asked)
  return {
    key,
    kind: total ? 'total' : 'body',
    cells: [
      season(committee, row.year, row.basis),
      poolCell(row.pool_label, row.kind, indent),
      textValue(row.cutoff === null ? '—' : formatShortDate(row.cutoff)),
      at[0] ?? countValue(null),
      asks === undefined
        ? (at[1] ?? moneyValue(null))
        : askWithNow(row.at_cutoff?.asked ?? null, asks),
      at[2] ?? averageValue(null),
      ...counted(row.since),
      ...counted(row.season_end),
      textValue(row.season_end_as_of === null ? '—' : formatShortDate(row.season_end_as_of)),
      { ...changeApps, display: signed(row.change_apps, (n) => n.toLocaleString('en-US')) },
      {
        ...changeAsked,
        display: signed(row.change_asked, (n) => formatMoney(n)),
      },
    ],
  }
}

/** The read's rows by season and cutoff: its pools, its no-pool money, its headline and its add-up gap. */
function applicationGroups(committee: ApiAidCommitteeReport) {
  const groups = new Map<
    string,
    {
      pools: ApiAidApplicationsRow[]
      headline?: ApiAidApplicationsRow
      gap?: ApiAidApplicationsRow
    }
  >()
  for (const row of committee.applications) {
    const key = `${String(row.year)}|${row.cutoff ?? ''}`
    const group = groups.get(key) ?? { pools: [] }
    if (row.kind === 'headline') group.headline = row
    else if (row.kind === 'reconciliation') group.gap = row
    else group.pools.push(row)
    groups.set(key, group)
  }
  return [...groups.entries()]
}

export function applicationRows(committee: ApiAidCommitteeReport, pools: PoolsView): ReportRow[] {
  const out: ReportRow[] = []
  for (const [key, group] of applicationGroups(committee)) {
    const { headline } = group
    if (pools === 'pool' && group.pools.length > 0) {
      group.pools.forEach((row, index) =>
        out.push(
          applicationLine(committee, row, false, true, `applications-${key}-${String(index)}`)
        )
      )
      if (headline)
        out.push(applicationLine(committee, headline, true, false, `applications-${key}-all`))
    } else if (headline) {
      out.push(applicationLine(committee, headline, false, false, `applications-${key}-all`))
    }
  }
  return out
}

/**
 * The one muted line under the cutoff table, only when something is non-zero: typed pools that don't add
 * up to their headline, and requests with no received date (in Season end, not at the cutoff).
 */
export function applicationsUnder(committee: ApiAidCommitteeReport): string | null {
  const parts: string[] = []
  for (const [, group] of applicationGroups(committee)) {
    const gap = group.gap?.season_end
    if (group.gap && gap && ((gap.apps ?? 0) !== 0 || (gap.asked ?? 0) !== 0)) {
      const less = (gap.apps ?? 0) >= 0 && (gap.asked ?? 0) >= 0
      parts.push(
        `${String(group.gap.year)}: the typed pools add up to ${String(Math.abs(gap.apps ?? 0))} apps and ${formatMoney(Math.abs(gap.asked ?? 0))} ${less ? 'less' : 'more'} than the headline, shown rather than hidden`
      )
    }
    const unknown = group.headline?.unknown_received ?? 0
    if (group.headline && unknown > 0) {
      parts.push(
        `${String(group.headline.year)}: ${String(unknown)} request${unknown === 1 ? ' has' : 's have'} no received date (in Season end, not at the cutoff)`
      )
    }
  }
  return parts.length === 0 ? null : `${parts.join(' · ')}.`
}

// --- the budget table (RPT-7, RPT-24) -----------------------------------------------------------

export function budgetColumns(noteOf: NoteOf): ReportColumn[] {
  return [
    { key: 'season', header: 'Season', width: 128 },
    { key: 'pool', header: 'Pool', align: 'left', width: 150 },
    {
      key: 'budget',
      header: 'Budget',
      note: noteOf('finance_budget'),
      divider: 'before',
      width: 112,
    },
    { key: 'awarded', header: 'Awarded', note: noteOf('committee_awarded'), width: 112 },
    { key: 'overUnder', header: 'Over / under', width: 134 },
    { key: 'pct', header: '% of budget', width: 96 },
    { key: 'share', header: 'Pool share', divider: 'before', csvOnly: true },
    { key: 'split', header: 'Rules split (a reference)', csvOnly: true },
    {
      key: 'note',
      header: 'Note',
      align: 'left',
      divider: 'before',
      title: "Finance's note on the budget, typed with the season",
    },
  ]
}

type BudgetRow = ApiAidCommitteeReport['budget'][number]

export function budgetRows(committee: ApiAidCommitteeReport, pools: PoolsView): ReportRow[] {
  const line = (row: BudgetRow, total: boolean, indent: boolean, key: string): ReportRow => ({
    key,
    kind: total ? 'total' : 'body',
    cells: [
      season(committee, row.year, row.basis),
      poolCell(row.pool_label, row.kind, indent),
      moneyValue(row.budget),
      moneyValue(row.awarded),
      overUnderValue(row.variance, row.side),
      pctValue(row.pct_of_budget),
      pctValue(row.pool_share),
      pctValue(row.rules_split_pct),
      noteCell(row.note),
    ],
  })
  const out: ReportRow[] = []
  const years = [...new Set(committee.budget.map((r) => r.year))]
  for (const year of years) {
    const rows = committee.budget.filter((r) => r.year === year)
    const headline = rows.find((r) => r.kind === 'headline')
    const split = rows.filter((r) => r.kind === 'pool' || r.kind === 'no_pool')
    // This season always shows its pools; past seasons only under By pool.
    const showPools = split.length > 0 && (pools === 'pool' || year === committee.year)
    if (showPools) {
      split.forEach((row, index) =>
        out.push(line(row, false, true, `budget-${String(year)}-${String(index)}`))
      )
      if (headline) out.push(line(headline, true, false, `budget-${String(year)}-all`))
    } else if (headline) {
      out.push(line(headline, false, false, `budget-${String(year)}-all`))
    }
  }
  return out
}

// --- appeals, merged with Round 1's % of ask (RPT-8, RPT-13) --------------------------------------

const R1_BUDGET_TITLE =
  "The live requests' Round 1 asks, leaving out a round paid wholly by an outside funder: % of ask divides by this"
const R1_TYPED_TITLE = 'A typed season carries the all-pools figure only'

export function appealsColumns(noteOf: NoteOf, pools: PoolsView): ReportColumn[] {
  return [
    { key: 'season', header: 'Season' },
    ...(pools === 'pool' ? [{ key: 'pool', header: 'Pool', align: 'left' as const }] : []),
    {
      key: 'applications',
      header: 'Applications',
      note: noteOf('committee_apps'),
      divider: 'before',
    },
    { key: 'appeals', header: 'Appeals', note: noteOf('committee_appeals') },
    { key: 'rate', header: 'Appeal rate', title: 'Appeals ÷ applications' },
    {
      key: 'r1Awarded',
      header: 'R1 awarded',
      note: noteOf('committee_awarded'),
      divider: 'before',
    },
    { key: 'r1Asked', header: 'R1 asked', csvOnly: true },
    {
      key: 'r1InBudget',
      header: 'R1 asked (in budget)',
      title: R1_BUDGET_TITLE,
    },
    { key: 'r1Pct', header: '% of ask in R1', title: 'R1 awarded ÷ R1 asked (in budget)' },
  ]
}

type Round1Row = ApiAidCommitteeReport['round1_pct'][number]

export function appealsRows(committee: ApiAidCommitteeReport, pools: PoolsView): ReportRow[] {
  const r1 = (row: Round1Row | undefined): ReportValue[] => [
    moneyValue(row?.awarded ?? null),
    moneyValue(row?.asked ?? null),
    moneyValue(row?.asked_in_budget ?? null),
    pctValue(row?.pct_of_ask ?? null),
  ]
  const years = [
    ...new Set([
      ...committee.appeals.map((r) => r.year),
      ...committee.round1_pct.map((r) => r.year),
    ]),
  ].sort((a, b) => a - b)
  const out: ReportRow[] = []
  for (const year of years) {
    const appeal = committee.appeals.find((r) => r.year === year)
    const round1 = committee.round1_pct.filter((r) => r.year === year)
    const headline = round1.find((r) => r.kind === 'headline')
    const split = round1.filter((r) => r.kind === 'pool' || r.kind === 'no_pool')
    const basis = appeal?.basis ?? round1[0]?.basis ?? 'r'
    const seasonValue = season(committee, year, basis)
    const appealCells: ReportValue[] = [
      countValue(appeal?.applications ?? null),
      countValue(appeal?.appeals ?? null),
      pctValue(appeal?.rate ?? null),
    ]
    const blank = [textValue(''), textValue(''), textValue('')]
    if (pools === 'pool' && split.length > 0) {
      split.forEach((row, index) =>
        out.push({
          key: `appeals-${String(year)}-${String(index)}`,
          kind: 'body',
          cells: [seasonValue, poolCell(row.pool_label, row.kind, true), ...blank, ...r1(row)],
        })
      )
      out.push({
        key: `appeals-${String(year)}-all`,
        kind: 'total',
        cells: [
          seasonValue,
          poolCell('All pools', 'headline', false),
          ...appealCells,
          ...r1(headline),
        ],
      })
    } else {
      out.push({
        key: `appeals-${String(year)}-all`,
        kind: 'body',
        cells: [
          seasonValue,
          ...(pools === 'pool' ? [poolCell('All pools', 'headline', false, R1_TYPED_TITLE)] : []),
          ...appealCells,
          ...r1(headline),
        ],
      })
    }
  }
  return out
}

export function committeeHeading(committee: ApiAidCommitteeReport, title: string): ReportHeading {
  return {
    title,
    season: committee.year,
    figuresOn: committee.figures_on,
    live: true,
    basis: BASIS_WORDS.mixed,
  }
}

export function committeeCsvName(
  view: AidView,
  table: string,
  share: PhaseShare,
  pools: PoolsView
): string {
  return aidCsvFilename({
    surface: 'reports',
    view: `year-over-year-${table}`,
    filters: [
      ...(table === 'phases' && share === 'share' ? ['share-of-phases'] : []),
      ...(table !== 'phases' && pools === 'pool' ? ['by-pool'] : []),
    ],
    season: view.year,
  })
}
