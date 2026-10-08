/**
 * Reports › Development's table (spec §9.4; D65, D66, D87–D94, D96, D99, D158; development-v2.html,
 * S4-4): rows are development's lines grouped Money · Counts · Appeals and cancellations, each for a
 * group or for every group; columns are seasons, as reported (r) or the dashboard's (P), and saved dated
 * columns. Pure; every figure is the server's (D21), and no row is a family (D66).
 */
import type {
  ApiAidDatedColumn,
  ApiAidDevelopment,
  ApiAidDevelopmentColumn,
  ApiAidDevelopmentRow,
} from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import { aidCsvFilename } from '../kit/csv'
import { formatLongDate, parseIsoDay } from '../kit/dates'
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

export const SECTION_WORDS: Readonly<Record<ApiAidDevelopmentRow['section'], string>> = {
  money: 'Money',
  counts: 'Counts',
  appeals: 'Appeals and cancellations',
}

export const EVERY_GROUP = 'Every group'

/** A column's header: its season label and basis (§9.7: every figure prints its basis). */
export function columnHeader(column: ApiAidDevelopmentColumn): string {
  return `${column.label} · ${column.basis}${column.basis_unconfirmed ? ' · basis unconfirmed' : ''}`
}

export function developmentColumns(dev: ApiAidDevelopment): ReportColumn[] {
  return [
    { key: 'line', header: 'Line' },
    { key: 'group', header: 'Group', align: 'left' },
    ...dev.columns.map((c, index) => ({ key: `column-${String(index)}`, header: columnHeader(c) })),
  ]
}

/** The group's label from the read (the rules'), or "Every group" for a line over every group (D158). */
export function groupWords(dev: ApiAidDevelopment, group: string | null): string {
  if (group === null) return EVERY_GROUP
  return dev.groups.find((g) => g.key === group)?.label ?? group.replace(/_/g, ' ')
}

function valueCell(unit: ApiAidDevelopmentRow['unit'], value: number | null): ReportValue {
  if (unit === 'dollars') return moneyValue(value)
  if (unit === 'percent') return pctValue(value)
  return countValue(value)
}

/** Each section under its name, its lines in the server's order, each with its own definition (D99). */
export function developmentRows(dev: ApiAidDevelopment): ReportRow[] {
  const rows: ReportRow[] = []
  let section: string | null = null
  dev.rows.forEach((row, index) => {
    if (row.section !== section) {
      section = row.section
      rows.push({
        key: `section-${row.section}`,
        kind: 'heading',
        cells: [textValue(SECTION_WORDS[row.section])],
      })
    }
    rows.push({
      key: `${row.key}-${row.group ?? 'every'}-${String(index)}`,
      kind: 'body',
      note: row.definition === '' ? undefined : row.definition,
      cells: [
        textValue(row.label),
        textValue(groupWords(dev, row.group)),
        ...row.values.map((value) => valueCell(row.unit, value)),
      ],
    })
  })
  return rows
}

export function developmentHeading(dev: ApiAidDevelopment, title: string): ReportHeading {
  return {
    title,
    season: dev.year,
    figuresOn: dev.figures_on,
    live: true,
    basis: BASIS_WORDS.mixed,
  }
}

/** "Basis unconfirmed" (O-930-1; §9.4): the seasons whose as-reported basis is being reconciled. */
export function unconfirmedWords(dev: ApiAidDevelopment): string | null {
  const labels = dev.columns.filter((c) => c.basis_unconfirmed).map((c) => c.label)
  if (labels.length === 0) return null
  return `Basis unconfirmed: ${labels.join(', ')}. Whether those as-reported figures were all money or the camp's own dollars only is being reconciled; compare them with the dashboard's seasons with care.`
}

/** A dated column's lines a past read can't rebuild read "—" (Part C D45; slice 2 Decision 11's words). */
export function notRebuiltColumnWords(dev: ApiAidDevelopment): string | null {
  const columns = dev.columns.filter((c) => (c.not_rebuilt ?? []).length > 0)
  if (columns.length === 0) return null
  const named = columns
    .map((c) => `${c.label} (${String((c.not_rebuilt ?? []).length)} lines)`)
    .join(', ')
  return `A dated column shows what the dashboard can rebuild for that day: a line it can't reads "—", never an estimate. ${named}.`
}

/** "Show the dashboard's rebuild" (≈, §9.4): why it is off, while the read names `rebuild` as not built. */
export function rebuildReason(dev: ApiAidDevelopment): string | null {
  return dev.not_built.find((item) => item.figure === 'rebuild')?.reason ?? null
}

/** The other figures the read doesn't build yet, each in the server's words. */
export function notBuiltLines(dev: ApiAidDevelopment): string[] {
  return dev.not_built.filter((item) => item.figure !== 'rebuild').map((item) => item.reason)
}

export const SOURCE_COLUMNS: readonly ReportColumn[] = [
  { key: 'source', header: 'Source' },
  { key: 'who', header: 'Who paid', align: 'left' },
  { key: 'kind', header: 'Incentive or need-based', align: 'left' },
  { key: 'group', header: 'Group', align: 'left' },
  { key: 'amount', header: 'This season' },
  { key: 'awards', header: 'Awards' },
]

/** This season by source, each with D88's three facts. */
export function sourceRows(dev: ApiAidDevelopment): ReportRow[] {
  return dev.sources.map((source, index) => ({
    key: `source-${source.source_key || 'camp'}-${source.group}-${String(index)}`,
    kind: 'body',
    cells: [
      textValue(source.name),
      textValue(source.who_paid),
      textValue(source.incentive ? 'incentive' : 'need-based'),
      textValue(source.group_label),
      moneyValue(source.amount),
      countValue(source.awards),
    ],
  }))
}

export function developmentCsvName(view: AidView, table: string): string {
  return aidCsvFilename({ surface: 'reports', view: `development-${table}`, season: view.year })
}

// --- Dated columns (§9.4 "+ Add a dated column"; D68; Decision 17) ---------------------------

export const sameColumn = (a: ApiAidDatedColumn, b: ApiAidDatedColumn) =>
  a.season === b.season && a.as_of === b.as_of

/** The list with one more column, unless it is already there. */
export function withColumn(
  list: readonly ApiAidDatedColumn[],
  column: ApiAidDatedColumn
): ApiAidDatedColumn[] {
  return list.some((c) => sameColumn(c, column)) ? [...list] : [...list, column]
}

export function withoutColumn(
  list: readonly ApiAidDatedColumn[],
  column: ApiAidDatedColumn
): ApiAidDatedColumn[] {
  return list.filter((c) => !sameColumn(c, column))
}

/** "2027 as of Mar 9, 2027". */
export function datedWords(column: ApiAidDatedColumn): string {
  return `${String(column.season)} as of ${formatLongDate(column.as_of)}`
}

/** The first season the dashboard keeps dated records for (D67): the server refuses an earlier one. */
const FIRST_DATED_SEASON = 2027

/**
 * The seasons a dated column can take: the report's own P seasons (the dashboard's) from 2027, newest
 * first. Before 2027 there are no dated records to query (D67), so the server's 422 is never offered.
 */
export function datedSeasons(dev: ApiAidDevelopment): number[] {
  const seasons = new Set(
    dev.columns
      .filter((c) => c.basis === 'P' && c.season >= FIRST_DATED_SEASON)
      .map((c) => c.season)
  )
  return [...seasons].sort((a, b) => b - a)
}

/**
 * The day before a YYYY-MM-DD day: the latest a dated column can take, since the server refuses a
 * day not yet past (#2967). Counted on the calendar from its parts, never through a local `Date`.
 */
export function dayBefore(iso: string): string {
  const day = parseIsoDay(iso)
  if (day === null) return iso
  const before = new Date(Date.UTC(day.year, day.month - 1, day.day - 1))
  return before.toISOString().slice(0, 10)
}
