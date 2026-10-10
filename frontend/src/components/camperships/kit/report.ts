/**
 * Reports' tables (spec §9; §11; §9.7 RPT-33): what each cell shows, what Copy puts on the clipboard
 * (values exactly as displayed) and what the CSV writes (plain signed numbers, §11), and the heading
 * lines both carry (the table, the season, its as-of and its basis). Pure: `ReportTable` renders it.
 * The server sends every figure and every total (D21); nothing here adds one up.
 */
import type { ReactNode } from 'react'

import { formatLongDate } from './dates'
import { formatMoney, moneyCsv } from './money'
import type { CellValue } from './table'

interface ReportValueBase {
  readonly note?: string | undefined
  /** A native title for the cell (the full words behind a cut label, or why a dash is a dash). */
  readonly title?: string | undefined
  /** Muted ink ("varies": a word where a figure would be). */
  readonly muted?: boolean | undefined
  /** What the screen draws in place of the words (a name that fits or shortens); Copy and the CSV keep the words. */
  readonly display?: ReactNode | undefined
  /** A label that clamps to TWO lines on screen instead of cutting at one (the kit's `.cf-cut2`); the title keeps the words. */
  readonly twoLines?: true | undefined
}

export type ReportValue =
  | (ReportValueBase & {
      readonly kind: 'money'
      readonly value: number | null
      /** The screen rounds to the whole dollar; Copy and the CSV keep the exact figure (ux3 statistics-6). */
      readonly whole?: true | undefined
    })
  | (ReportValueBase & { readonly kind: 'count'; readonly value: number | null })
  | (ReportValueBase & { readonly kind: 'pct'; readonly value: number | null })
  | (ReportValueBase & {
      readonly kind: 'text'
      readonly value: string
      /** What the CSV writes instead of the words (§11: Over / under's plain signed number). */
      readonly csv?: string | undefined
    })

// A `note` is a muted second line under the figure (RPT-1's band words): drawn on screen only, never
// in Copy or the CSV.
export const moneyValue = (value: number | null | undefined): ReportValue => ({
  kind: 'money',
  value: value ?? null,
})
/**
 * Money the screen draws in whole dollars, as the final mocks do ("$1,337,495"); Copy and the CSV carry the exact
 * figure, cents and all (ux3 statistics-6, coordinator ruling 2026-10-10).
 */
export const wholeMoneyValue = (value: number | null | undefined): ReportValue => ({
  kind: 'money',
  value: value ?? null,
  whole: true,
})
/**
 * An average (Avg ask, Avg request, Avg award): whole dollars, as every Reports mock draws them. The
 * server's figure carries cents; the round is display only, the same on screen, in Copy and the CSV.
 */
export const averageValue = (value: number | null | undefined): ReportValue =>
  moneyValue(value === null || value === undefined ? null : Math.round(value))
export const countValue = (value: number | null | undefined): ReportValue => ({
  kind: 'count',
  value: value ?? null,
})
export const pctValue = (value: number | null | undefined, note?: string): ReportValue => ({
  kind: 'pct',
  value: value ?? null,
  ...(note === undefined ? {} : { note }),
})
export const textValue = (value: string, csv?: string): ReportValue =>
  csv === undefined ? { kind: 'text', value } : { kind: 'text', value, csv }

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
      return cell.csv ?? cell.value
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
  /** The header's native title: the full words behind a short header. */
  readonly title?: string | undefined
  /** Opt the header into wrapping; headers are one line by default (the mock's `wrap`). */
  readonly wrap?: true | undefined
  /**
   * A muted sub-line under the header ("closed", "live · Jun 3"): drawn small under the one-line header; Copy
   * and the CSV read it after the header ("2026 closed").
   */
  readonly sub?: string | undefined
  /** The definition note number after the group's name ("1 · Round 1 by the deadline⁵"), from the group's first column. */
  readonly groupNote?: number | null | undefined
  /**
   * Kept out of the screen and out of Copy (values as displayed) but written to Download CSV: a column
   * the dashboard added beyond finance's slides (the mock's "hidden · in the CSV").
   */
  readonly csvOnly?: true | undefined
  /**
   * Kept off the screen but written to BOTH Copy and Download CSV (unlike `csvOnly`, which Copy also
   * drops): a raw figure beside a capped one, for whoever pastes the table elsewhere (owner A3, 2026-10-09).
   */
  readonly exportOnly?: true | undefined
  /** The column's definition note number (`useAidDefinitions().numberOf`), shown as ¹. */
  readonly note?: number | null | undefined
  readonly width?: number | undefined
  /** Body cells in bold (Statistics' Total awarded column, the mock's `<b>`); Copy and the CSV are unchanged. */
  readonly strong?: true | undefined
  /** `left`: a column of words (a pool, a round, a group), left-aligned as the mocks draw it; figures align right. */
  readonly align?: 'left' | undefined
  /**
   * `decided`: tinted amber, header and cells (D130; slice 4 K; Development's temporary column).
   * `decided-ink`: amber ink alone, no fill (Statistics' Decided column and, with Include not yet
   * offered on, its two % columns: the final mock's `.cf-dec`).
   */
  readonly tone?: 'decided' | 'decided-ink' | undefined
  /** `before`: a line left of the column, between a table's words and its figures (the mock's `.bl`). */
  readonly divider?: 'before' | undefined
  /** Body cells in the monospace font (ZIP codes, so the digits line up). */
  readonly mono?: boolean | undefined
}

/**
 * - `body`: a row of the table;
 * - `heading`: a group's name over its rows (Programs' pools, Development's sections);
 * - `subtotal`: the server's subtotal of the rows above it;
 * - `total`: the server's total, last (first under ReportTable's `totalsFirst`);
 * - `end`: a body row that stays at the end whatever the sort (ZIP's "Outside the US").
 */
export type ReportRowKind = 'body' | 'heading' | 'subtotal' | 'total' | 'end'

export interface ReportRow {
  readonly key: string
  readonly kind: ReportRowKind
  readonly cells: readonly ReportValue[]
  readonly indent?: 0 | 1 | 2 | undefined
  /**
   * The first cell's label spans this many columns (a total row's label over Tier..Eligible fee %). The
   * cells after it stay in `cells`, empty, so Copy and the CSV keep every column; they are not drawn.
   */
  readonly span?: number | undefined
  /** A basis badge at the right end of the first cell's label (the total row of a table with no heading row). */
  readonly badge?: 'P' | 'r' | undefined
  /** A heading row's muted words after its name ("12 sessions"). Not copied. */
  readonly meta?: string | undefined
  /** A line under the first cell (a row's own definition, D99). Not copied. */
  readonly note?: string | undefined
  /** The row's definition note number, a superscript after its label (Development's rows). Not copied. */
  readonly ref?: number | undefined
  /**
   * Where a count opens the requests behind it (D20; slice 4 J), by cell index: drawn as a link when
   * the cell is a count above 0, or a name (a text cell) that opens its own page. Copy and the CSV
   * take the words alone.
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
  /** Footnote lines after the others, each its own line in Copy and the CSV (the cap note, owner A3). */
  readonly notes?: readonly string[] | undefined
}

/** The basis badge's hover: what P or r means for the table it sits on (the kit's `.cf-pill.sky` title). */
export function basisTitle(table: string, basis: 'P' | 'r'): string {
  return basis === 'P'
    ? `${table}: every figure is Posted (P), from the dashboard's Posted amounts.`
    : `${table}: every figure is as reported (r), typed once.`
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
    ...(heading.notes ?? []),
  ]
}

/** Each column's header, its group named first ("Round 1 · Apps"), so a pasted table reads alone. */
export function headerTexts(columns: readonly ReportColumn[]): string[] {
  return columns.map((c) => {
    const header = c.sub ? `${c.header} ${c.sub}` : c.header
    return c.group ? `${c.group} · ${header}` : header
  })
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
    headerTexts(columns.filter((c) => !c.csvOnly)).join('\t'),
    ...rows.map((row) =>
      row.cells
        .filter((_, i) => !columns[i]?.csvOnly)
        .map(reportText)
        .join('\t')
    ),
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
