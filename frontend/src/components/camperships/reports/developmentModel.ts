/**
 * Reports › Development's table (spec §9.4; D65, D66, D87–D94, D96, D99, D158; development-v2.html,
 * S4-4): rows are development's lines grouped Money · Counts · Appeals and cancellations, each for a
 * group or for every group; columns are seasons, as reported (r) or the dashboard's (P), and the one
 * dated column staff ask for (saved nowhere). Definitions are numbered notes under the table, each row a
 * superscript. Pure; every figure is the server's (D21), and no row is a family (D66).
 */
import { createElement } from 'react'

import type {
  ApiAidDevelopment,
  ApiAidDevelopmentColumn,
  ApiAidDevelopmentRow,
} from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import { aidCsvFilename } from '../kit/csv'
import { formatLongDate, formatShortDate, parseIsoDay } from '../kit/dates'
import type { DefinitionNote } from '../kit/DefinitionNotes'
import { FunderCell } from './FunderCell'
import { tableShortLabel } from './statisticsModel'
import {
  averageValue,
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

/** The muted words after each section's name, on the same line (the final mock's section rows). */
export const SECTION_DESCRIPTIONS: Readonly<Record<ApiAidDevelopmentRow['section'], string>> = {
  money: "all money: the camp's awards and every outside grant",
  counts:
    'campers who attended and got money from any source, once per program; Weekend counts families',
  appeals: "the camp's own requests",
}

/**
 * "Show the dashboard's rebuild for 2022–2025": hidden until the 2017–2024 ledger backfill exists (owner
 * 10-09: a control nobody can click for months reads as broken; its fact moved into note 6). The code
 * path stays behind this flag so it can come back.
 */
export const SHOW_REBUILD_SWITCH: boolean = false

/** The first season the dashboard decides itself; an earlier closed P column is reproduced from the sheet. */
const FIRST_DECIDED_SEASON = 2027

/** A column's header as the final mock draws it: short and on one line, the long form in its title. */
export interface ColumnHead {
  readonly header: string
  /** The small muted line under the year ("closed", "live · Jun 3", "as of Mar 9"). */
  readonly sub?: string
  readonly title: string
}

/**
 * A column's head: the year alone, a sub-line for a dashboard column ("closed", "live · Jun 3"), and the
 * long words in the title. An as-reported column's basis words ("basis unconfirmed") ride in its title;
 * note 6 says the rest. Built from the seasons the server sends; no year is written here.
 */
export function columnHead(column: ApiAidDevelopmentColumn, dev: ApiAidDevelopment): ColumnHead {
  const season = String(column.season)
  const lastReported = dev.columns.filter((c) => c.basis === 'r').at(-1)
  if (column.basis === 'r') {
    const words =
      column === lastReported
        ? `${season}: as reported, the figures sent to funders`
        : `${season}: as reported, typed once, read only`
    return {
      header: season,
      title: column.basis_unconfirmed ? `${words} (basis unconfirmed)` : words,
    }
  }
  const short = formatShortDate(column.as_of ?? dev.figures_on)
  if (column.as_of !== dev.figures_on) {
    return {
      header: season,
      sub: `as of ${short}`,
      title: `${column.label}: recomputed from dated records, never saved. A line the dashboard can't rebuild for that day reads "—", never an estimate.`,
    }
  }
  if (column.season === dev.year) {
    return {
      header: season,
      sub: `live · ${short}`,
      title: `${season}, live: the dashboard's decisions as of ${short}`,
    }
  }
  return {
    header: season,
    sub: 'closed',
    title:
      column.season < FIRST_DECIDED_SEASON
        ? `${season}, closed: reproduced by the dashboard from finance's repaired sheet`
        : `${season}, closed: the dashboard's decisions at the season's end`,
  }
}

/** The one on-demand column staff asked for: a season as of a past day (component state only). */
export interface AsOfPick {
  readonly season: number
  readonly day: string
}

/** The read's `?column=` address: `<season>:<YYYY-MM-DD>`. */
export const columnParam = (pick: AsOfPick): string => `${String(pick.season)}:${pick.day}`

export const NOT_SAVED_TAG = 'not saved'

export const AS_REPORTED_GROUP = 'As reported'
export const DASHBOARD_GROUP = 'The dashboard'

/**
 * The columns: Metric, then the as-reported seasons under "As reported" (its note on the first) and the
 * dashboard's under "The dashboard", a stronger rule between the two groups. The column asked for as of a
 * day carries "not saved" under its year, and the mock's amber tint.
 */
export function developmentColumns(
  dev: ApiAidDevelopment,
  shown?: AsOfPick | null,
  options: { readonly asReportedNote?: number | null | undefined } = {}
): ReportColumn[] {
  const dated = dev.columns.some((c) => c.basis === 'P' && c.as_of !== dev.figures_on)
  const base = dated ? 98 : 104
  let firstReported = true
  let firstDashboard = true
  return [
    { key: 'line', header: 'Metric' },
    ...dev.columns.map((c, index): ReportColumn => {
      const head = columnHead(c, dev)
      const reported = c.basis === 'r'
      const temporary = shown?.season === c.season && c.as_of === shown.day
      const live = !reported && c.as_of === dev.figures_on && c.season === dev.year
      const column: ReportColumn = {
        key: `column-${String(index)}`,
        header: head.header,
        title: temporary
          ? `${String(c.season)} as of ${formatLongDate(c.as_of ?? dev.figures_on)}: recomputed from dated records for you only, never saved; gone when you leave the page. A line the dashboard can't rebuild for that day reads "—", never an estimate.`
          : head.title,
        group: reported ? AS_REPORTED_GROUP : DASHBOARD_GROUP,
        width: temporary ? base + 14 : live ? base + (dated ? 10 : 12) : base,
        ...(temporary
          ? {
              sub: `${formatShortDate(c.as_of ?? dev.figures_on)} · ${NOT_SAVED_TAG}`,
              tone: 'decided' as const,
            }
          : head.sub === undefined
            ? {}
            : { sub: head.sub }),
      }
      if (reported && firstReported) {
        firstReported = false
        if (options.asReportedNote) return { ...column, groupNote: options.asReportedNote }
      }
      if (!reported && firstDashboard) {
        firstDashboard = false
        return { ...column, divider: 'before' as const }
      }
      return column
    }),
  ]
}

/** The group's label from the read (the rules'). */
export function groupWords(dev: ApiAidDevelopment, group: string): string {
  return dev.groups.find((g) => g.key === group)?.label ?? group.replace(/_/g, ' ')
}

function valueCell(row: ApiAidDevelopmentRow, value: number | null): ReportValue {
  const unit = row.unit
  if (row.key === AVERAGE_KEY) return averageValue(value)
  if (unit === 'dollars') return moneyValue(value)
  if (unit === 'percent') return pctValue(value)
  return countValue(value)
}

/** The lines the mock breaks out by group, under the line's every-group figure. */
const BROKEN_OUT: ReadonlySet<string> = new Set(['total_awards', 'recipients'])
const TOTAL_AWARDS_KEY = 'total_awards'
const RECIPIENTS_KEY = 'recipients'
const AVERAGE_KEY = 'average_award'
/** Total Awards Granted's own sub-lines: its pools follow them (development-v2's order, final audit O1). */
const TOTAL_AWARDS_PARTS: ReadonlySet<string> = new Set([
  'camp_awards',
  'outside_awards',
  'incentive_awards',
])

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
  not_in_group_amount: 1,
  not_in_group_awards: 1,
}

/**
 * The registry note (`reports-development`) each line points at: the final mock's six notes. The server's
 * own per-row definition text no longer numbers a row; the registry's six do, in the registry's order.
 */
const NOTE_BUDGET = 'dev_budget'
const NOTE_NEED = 'need'
const NOTE_TOTAL = 'total_awards_granted'
const NOTE_WHO = 'dev_recipients'
const NOTE_FIRST = 'first_time'
/** The "As reported" group header's note (the key is kept from the old basis note, reworded). */
export const AS_REPORTED_NOTE_KEY = 'basis_unconfirmed'
const REGISTRY_NOTE: Readonly<Record<string, string>> = {
  budget: NOTE_BUDGET,
  total_requests: NOTE_NEED,
  need_met: NOTE_NEED,
  total_awards: NOTE_TOTAL,
  outside_awards: NOTE_TOTAL,
  awards: NOTE_TOTAL,
  average_award: NOTE_TOTAL,
  recipients: NOTE_WHO,
  families: NOTE_WHO,
  teens: NOTE_WHO,
  youth: NOTE_WHO,
  gender_recipients: NOTE_WHO,
  gender_enrolled: NOTE_WHO,
  household_level_lines: NOTE_WHO,
  household_level_amount: NOTE_WHO,
  first_time: NOTE_FIRST,
  returning: NOTE_FIRST,
  appeals_submitted: NOTE_FIRST,
  appeals_in_full: NOTE_FIRST,
  appeals_in_part: NOTE_FIRST,
  appeals_approved: NOTE_FIRST,
  declined_insufficient: NOTE_FIRST,
}

/** A registry note: its key and its words (`useAidDefinitions('reports-development').entries`). */
export interface RegistryNote {
  readonly key: string
  readonly text: string
  /** The note's lead term, set bold in the notes. */
  readonly term?: string
}

function lineIndent(key: string): 0 | 1 | 2 {
  return SUB_LINES[key] ?? 0
}

/**
 * Where a funder line opens on Money › Funders: its funder's group (the server keys a mapped source
 * `funder:<grantor key>`), or "No funder yet" for a description no funder claims.
 */
export function fundersParams(sourceKey: string): Record<string, string> {
  return sourceKey.startsWith('funder:')
    ? { funder: sourceKey.slice('funder:'.length) }
    : { show: 'no-funder' }
}

/** What `developmentTable` takes beside the read. */
export interface DevelopmentTableOptions {
  /** Links each funder line to Money › Funders; leave it out for a user who can't open it. */
  readonly fundersHref?: ((params: Readonly<Record<string, string>>) => string) | undefined
  /** The registry's notes for the report, numbered here with the lines' own definitions. */
  readonly registry?: readonly RegistryNote[] | undefined
}

/**
 * The table and its numbered notes (development-v2.html, final audit O1-O3). Rows are development's
 * lines, each section once in SECTION_WORDS' order, its lines in the server's order (the Budget line
 * leads Money wherever it is sent). Total Awards Granted's pools follow its own sub-lines; Recipients'
 * groups sit right under it. A line limited to some group kinds reads "label, group" for each group.
 * Every row stays one line: a note is a superscript number on the row and a numbered note under the
 * table; the registry's six notes are numbered in the registry's order, whichever rows call for them.
 */
export function developmentTable(
  dev: ApiAidDevelopment,
  options: DevelopmentTableOptions = {}
): { rows: ReportRow[]; notes: DefinitionNote[] } {
  const registry = options.registry ?? []
  const drafted: ReportRow[] = []
  const order = Object.keys(SECTION_WORDS)
  const lead = (row: ApiAidDevelopmentRow) => (row.key === BUDGET_KEY ? 0 : 1)
  const sent = [...dev.rows].sort(
    (a, b) => order.indexOf(a.section) - order.indexOf(b.section) || lead(a) - lead(b)
  )
  // A line's note number is its registry note's place in the registry's order: six, fixed (final mock).
  const noteFor = (row: ApiAidDevelopmentRow): number | undefined => {
    const key = REGISTRY_NOTE[row.key]
    const at = key === undefined ? -1 : registry.findIndex((note) => note.key === key)
    return at < 0 ? undefined : at + 1
  }
  const cells = (label: string, row: ApiAidDevelopmentRow) => [
    textValue(label),
    ...row.values.map((value) => valueCell(row, value)),
  ]
  let section: string | null = null
  let pools: ReportRow[] = [] // Total Awards Granted's pools, waiting for its sub-lines to pass
  const flushPools = () => {
    drafted.push(...pools)
    pools = []
  }
  let start = 0
  while (start < sent.length) {
    const first = sent[start] as ApiAidDevelopmentRow
    let end = start
    while (sent[end + 1]?.key === first.key) end += 1
    const line = sent.slice(start, end + 1)
    if (!TOTAL_AWARDS_PARTS.has(first.key)) flushPools()
    if (first.section !== section) {
      section = first.section
      drafted.push({
        key: `section-${first.section}`,
        kind: 'heading',
        cells: [textValue(SECTION_WORDS[first.section])],
        meta: SECTION_DESCRIPTIONS[first.section],
      })
    }
    const rowKey = (row: ApiAidDevelopmentRow, offset: number) =>
      `${row.key}-${row.group ?? 'every'}-${String(start + offset)}`
    const indent = lineIndent(first.key)
    const everyIndex = line.findIndex((row) => row.group === null)
    if (everyIndex >= 0) {
      const every = line[everyIndex] as ApiAidDevelopmentRow
      drafted.push({
        key: rowKey(every, everyIndex),
        kind: 'body',
        indent,
        ref: noteFor(every),
        cells: cells(every.label, every),
      })
      if (first.key === OUTSIDE_KEY) drafted.push(...grantorRows(dev, indent, options.fundersHref))
      if (BROKEN_OUT.has(first.key)) {
        const groups: ReportRow[] = []
        line.forEach((row, offset) => {
          if (row.group === null) return
          groups.push({
            key: rowKey(row, offset),
            kind: 'body',
            indent: Math.min(indent + 1, 2) as 1 | 2,
            cells: cells(groupLineWords(dev, first.key, row.group), row),
          })
        })
        if (first.key === TOTAL_AWARDS_KEY) pools = groups
        else drafted.push(...groups)
      }
    } else {
      line.forEach((row, offset) => {
        drafted.push({
          key: rowKey(row, offset),
          kind: 'body',
          indent,
          ref: noteFor(row),
          cells: cells(
            row.group === null ? row.label : `${row.label}, ${groupWords(dev, row.group)}`,
            row
          ),
        })
      })
    }
    start = end + 1
  }
  flushPools()
  const notes = registry.map((note, index) =>
    note.term === undefined
      ? { n: index + 1, text: note.text }
      : { n: index + 1, term: note.term, text: note.text }
  )
  return { rows: drafted, notes }
}

/** The table's rows (see `developmentTable`). */
export function developmentRows(
  dev: ApiAidDevelopment,
  fundersHref?: (params: Readonly<Record<string, string>>) => string,
  registry?: readonly RegistryNote[]
): ReportRow[] {
  return developmentTable(dev, { fundersHref, registry }).rows
}

/** A group's line under a broken-out line: Recipients count campers, or families in a families group. */
function groupLineWords(dev: ApiAidDevelopment, key: string, group: string): string {
  const label = groupWords(dev, group)
  if (key !== RECIPIENTS_KEY) return label
  const kind = dev.groups.find((g) => g.key === group)?.kind
  return `${label} ${kind === 'families' ? 'families' : 'campers'}`
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

/**
 * How many requests counted at their session's cost (owner Rule M, revised 10-08): an ask above its
 * priced session's cost counts at the cost in Total Requests and % of need met, so this line says how
 * many, one clause per column that has any, in column order.
 */
export function cappedWords(dev: ApiAidDevelopment): string | null {
  const clauses = dev.columns
    .filter((c) => (c.requests_capped ?? 0) > 0)
    .map((c) => {
      const n = c.requests_capped ?? 0
      const noun = n === 1 ? 'request above its' : 'requests above their'
      return `${String(n)} ${noun} session's cost counted at the cost (${c.label})`
    })
  if (clauses.length === 0) return null
  return `Total Requests and % of need met: ${clauses.join('; ')}.`
}

/** "Show the dashboard's rebuild" (≈, §9.4): why it is off, while the read names `rebuild` as not built. */
export function rebuildReason(dev: ApiAidDevelopment): string | null {
  return dev.not_built.find((item) => item.figure === 'rebuild')?.reason ?? null
}

/** A funder line's facts, as the final mock draws them at the right of its name. */
export interface FunderFacts {
  readonly kind: 'incentive' | 'need-based'
  /** The reporting group by short name (title: the full name), or null: "needs a group". */
  readonly pool: { readonly short: string; readonly full: string } | null
  /** The source has no funder yet: a CampMinder description no funder claims. */
  readonly noFunder: boolean
}

export function funderFacts(source: ApiAidDevelopment['sources'][number]): FunderFacts {
  return {
    kind: source.incentive ? 'incentive' : 'need-based',
    pool:
      source.group === ''
        ? null
        : {
            short: tableShortLabel({ key: source.group, label: source.group_label }),
            full: source.group_label,
          },
    noFunder: !source.source_key.startsWith('funder:'),
  }
}

/** The facts in words, for the cell's title and the CSV ("another funder" rides here, not on screen). */
function factsWords(source: ApiAidDevelopment['sources'][number]): string {
  const facts = funderFacts(source)
  return [
    source.who_paid,
    facts.kind,
    facts.pool === null ? 'needs a group' : facts.pool.full,
    ...(facts.noFunder ? ['no funder yet'] : []),
  ].join(' · ')
}

/**
 * The grantor lines under Outside grants (D88): one per source another funder paid, ONE line each: the
 * name (a link to Money › Funders, cut with an ellipsis) and its facts at the right of the cell. Its
 * amount sits only in the read's own season, the dashboard's column as of the figures day; the other
 * columns have nothing there (D74), so they read "—". The camp's own is no line.
 */
function grantorRows(
  dev: ApiAidDevelopment,
  indent: 0 | 1 | 2,
  fundersHref: ((params: Readonly<Record<string, string>>) => string) | undefined
): ReportRow[] {
  const own = dev.columns.map(
    (c) => c.season === dev.year && c.basis === 'P' && c.as_of === dev.figures_on
  )
  return dev.sources
    .filter((source) => source.who_paid === ANOTHER_FUNDER)
    .map((source, index) => {
      const words = `${source.name} (${factsWords(source)})`
      const href = fundersHref?.(fundersParams(source.source_key))
      return {
        key: `grantor-${source.source_key}-${source.group}-${String(index)}`,
        kind: 'body' as const,
        indent: Math.min(indent + 1, 2) as 1 | 2,
        // The CSV has no facts column: they ride in the name cell there.
        cells: [
          {
            ...textValue(source.name, words),
            title: href === undefined ? words : `${words} · opens Money › Funders`,
            display: createElement(FunderCell, {
              name: source.name,
              facts: funderFacts(source),
              href,
            }),
          },
          ...own.map((is) => moneyValue(is ? source.amount : null)),
        ],
        links: href === undefined ? undefined : { 0: href },
      }
    })
}

export function developmentCsvName(view: AidView, table: string): string {
  return aidCsvFilename({ surface: 'reports', view: `development-${table}`, season: view.year })
}

// --- The on-demand as-of column (Show As Of a Date…; D68, reworked: not saved) ---------------------------

/** The chip's words: "2027 as of Mar 9 · not saved". */
export function asOfChipWords(column: AsOfPick): string {
  return `${String(column.season)} as of ${formatShortDate(column.day)} · ${NOT_SAVED_TAG}`
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
