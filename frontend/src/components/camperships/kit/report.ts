/**
 * Reports' tables (spec §9; §11; §9.7 RPT-33): what each cell shows, what Copy puts on the clipboard
 * (values exactly as displayed) and what the CSV writes (plain signed numbers, §11), and the heading
 * lines both carry (the table, the season, its as-of and its basis). Pure: `ReportTable` renders it.
 * The server sends every figure and every total (D21); nothing here adds one up.
 */
import { formatLongDate } from './dates'
import { formatMoney, moneyCsv } from './money'
import type { CellValue } from './table'

export type ReportValue =
  | { readonly kind: 'money'; readonly value: number | null }
  | { readonly kind: 'count'; readonly value: number | null }
  | { readonly kind: 'pct'; readonly value: number | null }
  | { readonly kind: 'text'; readonly value: string }

export const moneyValue = (value: number | null | undefined): ReportValue => ({
  kind: 'money',
  value: value ?? null,
})
export const countValue = (value: number | null | undefined): ReportValue => ({
  kind: 'count',
  value: value ?? null,
})
export const pctValue = (value: number | null | undefined): ReportValue => ({
  kind: 'pct',
  value: value ?? null,
})
export const textValue = (value: string): ReportValue => ({ kind: 'text', value })

/** "42.5%" as the server rounded it (one decimal, §9.7); "—" when there is no denominator. */
export function formatPct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`
}

/** "1,293"; "—" when there is nothing to count (null), "0" for a real zero (D74). */
export function formatCount(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US')
}

/** What the screen and Copy show. */
export function reportText(cell: ReportValue): string {
  switch (cell.kind) {
    case 'money':
      return formatMoney(cell.value)
    case 'count':
      return formatCount(cell.value)
    case 'pct':
      return formatPct(cell.value)
    case 'text':
      return cell.value
  }
}

/** What the CSV writes (§11): plain signed numbers, a % as its number, nothing for "—". */
export function reportCsv(cell: ReportValue): string {
  switch (cell.kind) {
    case 'money':
      return moneyCsv(cell.value)
    case 'count':
      return cell.value === null ? '' : String(cell.value)
    case 'pct':
      return cell.value === null ? '' : cell.value.toFixed(1)
    case 'text':
      return cell.value
  }
}

/** What a sortable column sorts by: the number, or the words ("—" sorts last, `sortRows`). */
export function reportSortValue(cell: ReportValue | undefined): CellValue {
  return cell === undefined ? null : cell.value
}

export interface ReportColumn {
  readonly key: string
  readonly header: string
  /** A heading over several columns ("Round 1"), drawn as a second header row. */
  readonly group?: string | undefined
  /** The column's definition note number (`useAidDefinitions().numberOf`), shown as ¹. */
  readonly note?: number | null | undefined
  readonly width?: number | undefined
  /** `left`: a column of words (a pool, a round, a group), left-aligned as the mocks draw it; figures align right. */
  readonly align?: 'left' | undefined
  /** `decided`: "Decided (not yet offered)", tinted amber, header and cells (D130; slice 4 K). */
  readonly tone?: 'decided' | undefined
}

/**
 * - `body`: a row of the table;
 * - `heading`: a group's name over its rows (Programs' pools, Development's sections);
 * - `subtotal`: the server's subtotal of the rows above it;
 * - `total`: the server's total, last;
 * - `end`: a body row that stays at the end whatever the sort (ZIP's "Outside the US").
 */
export type ReportRowKind = 'body' | 'heading' | 'subtotal' | 'total' | 'end'

export interface ReportRow {
  readonly key: string
  readonly kind: ReportRowKind
  readonly cells: readonly ReportValue[]
  readonly indent?: 0 | 1 | 2 | undefined
  /** A line under the first cell (a row's own definition, D99). Not copied. */
  readonly note?: string | undefined
  /**
   * Where a count opens the requests behind it (D20; slice 4 J), by cell index: drawn as a link when
   * the cell is a count above 0. Copy and the CSV take the words alone.
   */
  readonly links?: Readonly<Record<number, string>> | undefined
}

export interface ReportHeading {
  readonly title: string
  readonly season: number
  /** The day the figures are as of (the server's `figures_on`). */
  readonly figuresOn: string
  readonly live: boolean
  /** Basis words ("P (awarded = Posted)"), or null where each row carries its own. */
  readonly basis: string | null
  /** "requests received through Feb 1, 2027" (D138), when a reporting control is on. */
  readonly requestSet?: string | null | undefined
}

export const BASIS_WORDS = {
  P: 'P (awarded = Posted)',
  r: 'r (as reported, typed once)',
  mixed: "P = the dashboard's Posted · r = as reported, typed once",
} as const

/** The lines above a copied or downloaded table (RPT-33): its name, season, as-of and basis. */
export function headingLines(heading: ReportHeading): string[] {
  const asOf = `As of ${formatLongDate(heading.figuresOn)}${heading.live ? ' (live)' : ''}`
  return [
    heading.title,
    `Season ${String(heading.season)} · ${asOf}`,
    ...(heading.basis === null ? [] : [`Basis: ${heading.basis}`]),
    ...(heading.requestSet ? [`Counts only ${heading.requestSet}`] : []),
  ]
}

/** Each column's header, its group named first ("Round 1 · Apps"), so a pasted table reads alone. */
export function headerTexts(columns: readonly ReportColumn[]): string[] {
  return columns.map((c) => (c.group ? `${c.group} · ${c.header}` : c.header))
}

/** Copy (RPT-33): tab-separated, values exactly as displayed, ready to paste into a spreadsheet. */
export function copyText(
  heading: ReportHeading,
  columns: readonly ReportColumn[],
  rows: readonly ReportRow[]
): string {
  const lines = [
    ...headingLines(heading),
    '',
    headerTexts(columns).join('\t'),
    ...rows.map((row) => row.cells.map(reportText).join('\t')),
  ]
  return lines.join('\n')
}

/**
 * The CSV's lines (§11, RPT-33): the heading lines, a blank line, the header, the rows with plain
 * numbers, then the view's link (D15). The first line is `buildCsvContent`'s header argument.
 */
export function csvLines(
  heading: ReportHeading,
  columns: readonly ReportColumn[],
  rows: readonly ReportRow[],
  link: string
): string[][] {
  return [
    ...headingLines(heading).map((line) => [line]),
    [],
    headerTexts(columns),
    ...rows.map((row) => row.cells.map(reportCsv)),
    [],
    ['Link', link],
  ]
}
