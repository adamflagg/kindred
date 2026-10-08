/**
 * Reports › Development's table (spec §9.4; D65, D66, D87–D94, D96, D99, D158; development-v2.html,
 * S4-4): rows are development's lines grouped Money · Counts · Appeals and cancellations, each for a
 * group or for every group; columns are seasons, as reported (r) or the dashboard's (P), and saved dated
 * columns. Pure; every figure is the server's (D21), and no row is a family (D66).
 */
import type {
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

const BUDGET_KEY = 'budget'
const OUTSIDE_KEY = 'outside_awards'
const ANOTHER_FUNDER = 'another funder'

export const SECTION_WORDS: Readonly<Record<ApiAidDevelopmentRow['section'], string>> = {
  money: 'Money',
  counts: 'Counts',
  appeals: 'Appeals and cancellations',
}

/** A column's header: its season label and basis (§9.7: every figure prints its basis). */
export function columnHeader(column: ApiAidDevelopmentColumn): string {
  return `${column.label} · ${column.basis}${column.basis_unconfirmed ? ' · basis unconfirmed' : ''}`
}

/** The one on-demand column staff asked for: a season as of a past day (component state only). */
export interface AsOfPick {
  readonly season: number
  readonly day: string
}

/** The read's `?column=` address: `<season>:<YYYY-MM-DD>`. */
export const columnParam = (pick: AsOfPick): string => `${String(pick.season)}:${pick.day}`

export const NOT_SAVED_TAG = 'not saved · gone when you leave'

/** The columns; the one asked for as of a day carries the tag, since nothing keeps it. */
export function developmentColumns(
  dev: ApiAidDevelopment,
  shown?: AsOfPick | null
): ReportColumn[] {
  return [
    { key: 'line', header: 'Line' },
    ...dev.columns.map((c, index) => ({
      key: `column-${String(index)}`,
      header:
        shown && c.season === shown.season && c.as_of === shown.day
          ? `${columnHeader(c)} · ${NOT_SAVED_TAG}`
          : columnHeader(c),
    })),
  ]
}

/** The group's label from the read (the rules'). */
export function groupWords(dev: ApiAidDevelopment, group: string): string {
  return dev.groups.find((g) => g.key === group)?.label ?? group.replace(/_/g, ' ')
}

function valueCell(unit: ApiAidDevelopmentRow['unit'], value: number | null): ReportValue {
  if (unit === 'dollars') return moneyValue(value)
  if (unit === 'percent') return pctValue(value)
  return countValue(value)
}

/** The lines the mock breaks out by group, under the line's every-group figure. */
const BROKEN_OUT: ReadonlySet<string> = new Set(['total_awards', 'recipients'])

/** The mock's hierarchy: a sub-line sits under its parent (1), an incentive award under a camp's (2). */
export const SUB_LINES: Readonly<Record<string, 1 | 2>> = {
  camp_awards: 1,
  outside_awards: 1,
  incentive_awards: 2,
  shared_households: 1,
  shared_campers: 1,
  appeals_in_full: 1,
  appeals_in_part: 1,
  appeals_approved: 1,
  gender_recipients: 1,
  gender_enrolled: 1,
}

function lineIndent(key: string): 0 | 1 | 2 {
  return SUB_LINES[key] ?? (key.startsWith('cancelled_') ? 1 : 0)
}

/**
 * Each section under its name, one row per line (development-v2.html): the line's every-group figure
 * with its definition (D99), the group rows only under the two lines the mock breaks out. A line limited
 * to some group kinds has no every-group figure, so it reads "label, group" for each group it has.
 */
export function developmentRows(dev: ApiAidDevelopment): ReportRow[] {
  const rows: ReportRow[] = []
  // Each section once, in SECTION_WORDS' order (the mock's), its lines in the server's order: the read
  // sends a few lines after a later section's (household-level dollars, the gender rows).
  const order = Object.keys(SECTION_WORDS)
  // The Budget line (API proposal 2) leads Money, wherever the server sends it.
  const lead = (row: ApiAidDevelopmentRow) => (row.key === BUDGET_KEY ? 0 : 1)
  const sent = [...dev.rows].sort(
    (a, b) => order.indexOf(a.section) - order.indexOf(b.section) || lead(a) - lead(b)
  )
  let section: string | null = null
  let start = 0
  while (start < sent.length) {
    const first = sent[start] as ApiAidDevelopmentRow
    let end = start
    while (sent[end + 1]?.key === first.key) end += 1
    const line = sent.slice(start, end + 1)
    if (first.section !== section) {
      section = first.section
      rows.push({
        key: `section-${first.section}`,
        kind: 'heading',
        cells: [textValue(SECTION_WORDS[first.section])],
      })
    }
    const rowKey = (row: ApiAidDevelopmentRow, offset: number) =>
      `${row.key}-${row.group ?? 'every'}-${String(start + offset)}`
    const cells = (label: string, row: ApiAidDevelopmentRow) => [
      textValue(label),
      ...row.values.map((value) => valueCell(row.unit, value)),
    ]
    const indent = lineIndent(first.key)
    const everyIndex = line.findIndex((row) => row.group === null)
    if (everyIndex >= 0) {
      const every = line[everyIndex] as ApiAidDevelopmentRow
      rows.push({
        key: rowKey(every, everyIndex),
        kind: 'body',
        indent,
        note: every.definition === '' ? undefined : every.definition,
        cells: cells(every.label, every),
      })
      if (first.key === OUTSIDE_KEY) rows.push(...grantorRows(dev, indent))
      if (BROKEN_OUT.has(first.key)) {
        line.forEach((row, offset) => {
          if (row.group === null) return
          rows.push({
            key: rowKey(row, offset),
            kind: 'body',
            indent: Math.min(indent + 1, 2) as 1 | 2,
            cells: cells(groupWords(dev, row.group), row),
          })
        })
      }
    } else {
      let lastNote = ''
      line.forEach((row, offset) => {
        const showNote = row.definition !== '' && row.definition !== lastNote
        if (row.definition !== '') lastNote = row.definition
        rows.push({
          key: rowKey(row, offset),
          kind: 'body',
          indent,
          note: showNote ? row.definition : undefined,
          cells: cells(
            row.group === null ? row.label : `${row.label}, ${groupWords(dev, row.group)}`,
            row
          ),
        })
      })
    }
    start = end + 1
  }
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

/**
 * The grantor lines under Outside grants (D88): one per source another funder paid, named, with its
 * facts in muted words. Its amount sits only in the read's own season, the dashboard's column as of the
 * figures day; the other columns have nothing there (D74), so they read "—". The camp's own is no line.
 */
function grantorRows(dev: ApiAidDevelopment, indent: 0 | 1 | 2): ReportRow[] {
  const own = dev.columns.map(
    (c) => c.season === dev.year && c.basis === 'P' && c.as_of === dev.figures_on
  )
  return dev.sources
    .filter((source) => source.who_paid === ANOTHER_FUNDER)
    .map((source, index) => ({
      key: `grantor-${source.source_key}-${source.group}-${String(index)}`,
      kind: 'body' as const,
      indent: Math.min(indent + 1, 2) as 1 | 2,
      note: [
        source.who_paid,
        source.incentive ? 'incentive' : 'need-based',
        ...(source.group === '' ? ['needs a group'] : []),
      ].join(' · '),
      cells: [textValue(source.name), ...own.map((is) => moneyValue(is ? source.amount : null))],
    }))
}

export function developmentCsvName(view: AidView, table: string): string {
  return aidCsvFilename({ surface: 'reports', view: `development-${table}`, season: view.year })
}

// --- The on-demand as-of column (Show As Of a Date…; D68, reworked: not saved) ---------------------------

/** "2027 as of Mar 9, 2027". */
export function datedWords(column: AsOfPick): string {
  return `${String(column.season)} as of ${formatLongDate(column.day)}`
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
