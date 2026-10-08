/**
 * The committee's year-over-year tables (spec §9.7 RPT-1, 2, 6, 7, 8, 13, 24; D132, D133, D155;
 * owner N2 (C); statistics-v2.html's Year over year, S4-2). Pure. Each season row carries its basis,
 * P (the dashboard's Posted) or r (as reported, typed once), and every figure, %, band and over/under is
 * the server's (D21: "the dashboard computes every %" means the server does).
 */
import type {
  ApiAidApplicationsRow,
  ApiAidBand,
  ApiAidCommitteeReport,
  ApiAidCounted,
  ApiAidPhaseRow,
} from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import { aidCsvFilename } from '../kit/csv'
import { formatShortDate } from '../kit/dates'
import { formatMoney } from '../kit/money'
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
import type { NoteOf } from './statisticsModel'

/** `?phases=share` shows each phase as a share of the phases' sum; the default is % of budget (R1). */
export type PhaseShare = 'budget' | 'share'

export function parsePhaseShare(raw: string | null): PhaseShare {
  return raw === 'share' ? 'share' : 'budget'
}

/** The three phases in the read's order (D155): by the deadline, after it, appeals. */
export const PHASE_NAMES = [
  '1 · Round 1 by the deadline',
  '2 · Round 1 after the deadline',
  '3 · Appeals (Rounds 2 and 3)',
] as const

/** "2026 · r", "2027 · P · to date": the season, its basis, and whether it is still moving (N2). */
export function seasonWords(year: number, basis: 'P' | 'r', toDate = false): string {
  return `${String(year)} · ${basis}${toDate ? ' · to date' : ''}`
}

/** One sign convention, stated in words (§9.7): "$40,000 under", "on budget". */
export function overUnderWords(
  variance: number | null,
  side: 'over' | 'under' | 'on' | null
): string {
  if (variance === null || side === null) return '—'
  return side === 'on' ? 'on budget' : `${formatMoney(Math.abs(variance))} ${side}`
}

/** A phase's target band and where As offered sits against it (RPT-1): "51–55%: above". */
export function bandWords(band: ApiAidBand | null | undefined): string {
  if (band === null || band === undefined) return '—'
  const range = `${String(band.low_pct)}–${String(band.high_pct)}%`
  return band.position === null ? range : `${range}: ${band.position}`
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

export function phaseColumns(
  share: PhaseShare,
  noteOf: NoteOf,
  labels: PhaseLabels = DEFAULT_PHASE_LABELS
): ReportColumn[] {
  const pct = share === 'budget' ? '% of budget' : 'share of the phases'
  return [
    { key: 'season', header: 'Season' },
    ...PHASE_NAMES.flatMap((group, index): ReportColumn[] => [
      { key: `p${String(index)}-offered`, header: labels.offered, group, divider: 'before' },
      { key: `p${String(index)}-offeredPct`, header: pct, group },
      {
        key: `p${String(index)}-end`,
        header: labels.end,
        group,
        note: noteOf('round1_phases'),
      },
      { key: `p${String(index)}-endPct`, header: pct, group },
      { key: `p${String(index)}-band`, header: `Band (${labels.offered.toLowerCase()})`, group },
    ]),
    { key: 'total', header: labels.end, group: 'Total', divider: 'before' },
    { key: 'totalPct', header: '% of budget', group: 'Total' },
    { key: 'budget', header: 'Budget', note: noteOf('finance_budget') },
    { key: 'overUnder', header: 'Over / under' },
    { key: 'reconciliation', header: 'Total − Σ phases' },
  ]
}

export function phaseRows(committee: ApiAidCommitteeReport, share: PhaseShare): ReportRow[] {
  return committee.phases.map((row: ApiAidPhaseRow) => {
    const offeredPct = share === 'budget' ? row.offered_pct_of_budget : row.offered_share_of_phases
    const endPct = share === 'budget' ? row.pct_of_budget : row.share_of_phases
    const cells: ReportValue[] = [textValue(seasonWords(row.year, row.basis, row.to_date))]
    for (let i = 0; i < PHASE_NAMES.length; i += 1) {
      cells.push(
        moneyValue(row.offered[i]),
        pctValue(offeredPct[i]),
        moneyValue(row.phases[i]),
        pctValue(endPct[i]),
        textValue(bandWords(row.bands[i]))
      )
    }
    cells.push(
      moneyValue(row.total),
      pctValue(row.total_pct_of_budget),
      moneyValue(row.budget),
      textValue(overUnderWords(row.variance, row.side)),
      moneyValue(row.reconciliation)
    )
    return { key: `phases-${String(row.year)}-${row.basis}`, kind: 'body', cells }
  })
}

const counted = (c: ApiAidCounted | null): ReportValue[] => [
  countValue(c?.apps ?? null),
  moneyValue(c?.asked ?? null),
  moneyValue(c?.average ?? null),
]

export function applicationColumns(noteOf: NoteOf): ReportColumn[] {
  return [
    { key: 'season', header: 'Season' },
    { key: 'pool', header: 'Pool', align: 'left' },
    { key: 'cutoff', header: 'Cutoff', align: 'left' },
    {
      key: 'cutApps',
      header: 'Apps',
      group: 'At the cutoff',
      note: noteOf('apps'),
      divider: 'before',
    },
    { key: 'cutAsked', header: 'Asked', group: 'At the cutoff' },
    { key: 'cutAvg', header: 'Avg ask', group: 'At the cutoff' },
    { key: 'sinceApps', header: 'Apps', group: 'Received since', divider: 'before' },
    { key: 'sinceAsked', header: 'Asked', group: 'Received since' },
    { key: 'sinceAvg', header: 'Avg ask', group: 'Received since' },
    { key: 'endApps', header: 'Apps', group: 'Season end', divider: 'before' },
    { key: 'endAsked', header: 'Asked', group: 'Season end' },
    { key: 'endAvg', header: 'Avg ask', group: 'Season end' },
    { key: 'endAsOf', header: 'As of', group: 'Season end' },
    { key: 'changeApps', header: 'Change in apps vs last year' },
    { key: 'changeAsked', header: 'Change in asked vs last year' },
    { key: 'unknown', header: 'No received date' },
  ]
}

/** A frozen ask that couldn't be exact uses today's, and says so (owner R2b D12; D155). */
function asksNote(row: ApiAidApplicationsRow): string | undefined {
  return row.asks_basis === 'now'
    ? `Asks as they stand now${row.asks_reason ? `: ${row.asks_reason}` : ''}`
    : undefined
}

export function applicationRows(committee: ApiAidCommitteeReport): ReportRow[] {
  return committee.applications.map((row, index) => ({
    key: `applications-${String(row.year)}-${row.kind}-${row.pool ?? 'all'}-${String(index)}`,
    kind: 'body',
    note: asksNote(row),
    cells: [
      textValue(seasonWords(row.year, row.basis)),
      textValue(row.pool_label),
      textValue(row.cutoff === null ? '—' : formatShortDate(row.cutoff)),
      ...counted(row.at_cutoff),
      ...counted(row.since),
      ...counted(row.season_end),
      textValue(row.season_end_as_of === null ? '—' : formatShortDate(row.season_end_as_of)),
      countValue(row.change_apps),
      moneyValue(row.change_asked),
      countValue(row.unknown_received),
    ],
  }))
}

export function budgetColumns(noteOf: NoteOf): ReportColumn[] {
  return [
    { key: 'season', header: 'Season' },
    { key: 'pool', header: 'Pool', align: 'left' },
    { key: 'budget', header: 'Budget', note: noteOf('finance_budget'), divider: 'before' },
    { key: 'awarded', header: 'Awarded', note: noteOf('awarded') },
    { key: 'overUnder', header: 'Over / under' },
    { key: 'pct', header: '% of budget' },
    { key: 'share', header: 'Pool share', divider: 'before' },
    { key: 'split', header: 'Rules split (a reference)' },
    { key: 'note', header: 'Note', align: 'left' },
  ]
}

export function budgetRows(committee: ApiAidCommitteeReport): ReportRow[] {
  return committee.budget.map((row, index) => ({
    key: `budget-${String(row.year)}-${row.kind}-${row.pool ?? 'all'}-${String(index)}`,
    kind: 'body',
    cells: [
      textValue(seasonWords(row.year, row.basis)),
      textValue(row.pool_label),
      moneyValue(row.budget),
      moneyValue(row.awarded),
      textValue(overUnderWords(row.variance, row.side)),
      pctValue(row.pct_of_budget),
      pctValue(row.pool_share),
      pctValue(row.rules_split_pct),
      textValue(row.note),
    ],
  }))
}

export function appealsColumns(noteOf: NoteOf): ReportColumn[] {
  return [
    { key: 'season', header: 'Season' },
    { key: 'applications', header: 'Applications', divider: 'before' },
    { key: 'appeals', header: 'Appeals', note: noteOf('appeals') },
    { key: 'rate', header: 'Appeal rate' },
  ]
}

export function appealsRows(committee: ApiAidCommitteeReport): ReportRow[] {
  return committee.appeals.map((row) => ({
    key: `appeals-${String(row.year)}-${row.basis}`,
    kind: 'body',
    cells: [
      textValue(seasonWords(row.year, row.basis)),
      countValue(row.applications),
      countValue(row.appeals),
      pctValue(row.rate),
    ],
  }))
}

export const ROUND1_COLUMNS: readonly ReportColumn[] = [
  { key: 'season', header: 'Season' },
  { key: 'pool', header: 'Pool', align: 'left' },
  { key: 'awarded', header: 'R1 awarded', divider: 'before' },
  { key: 'asked', header: 'R1 asked' },
  { key: 'inBudget', header: 'R1 asked (in budget)' },
  { key: 'pct', header: '% of ask in R1' },
]

export function round1Rows(committee: ApiAidCommitteeReport): ReportRow[] {
  return committee.round1_pct.map((row, index) => ({
    key: `round1-${String(row.year)}-${row.kind}-${row.pool ?? 'all'}-${String(index)}`,
    kind: 'body',
    cells: [
      textValue(seasonWords(row.year, row.basis)),
      textValue(row.pool_label),
      moneyValue(row.awarded),
      moneyValue(row.asked),
      moneyValue(row.asked_in_budget),
      pctValue(row.pct_of_ask),
    ],
  }))
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

export function committeeCsvName(view: AidView, table: string, share: PhaseShare): string {
  return aidCsvFilename({
    surface: 'reports',
    view: `year-over-year-${table}`,
    filters: table === 'phases' && share === 'share' ? ['share-of-phases'] : [],
    season: view.year,
  })
}
