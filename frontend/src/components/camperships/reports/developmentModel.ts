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
import { formatLongDate, formatShortDate, parseIsoDay } from '../kit/dates'
import type { DefinitionNote } from '../kit/DefinitionNotes'
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

/** The first season the dashboard decides itself; an earlier closed P column is reproduced from the sheet. */
const FIRST_DECIDED_SEASON = 2027

/**
 * A column's header, as development-v2 draws it (every figure prints its basis, §9.7): "2025 · as
 * reported", the read's own season "2027 · live · as of Jun 3", a finished season "2026 · closed ·
 * reproduced", and a column asked for as of a day "2027 as of Mar 9". A contested basis is marked.
 */
export function columnHeader(column: ApiAidDevelopmentColumn, dev: ApiAidDevelopment): string {
  const season = String(column.season)
  const words =
    column.basis === 'r'
      ? `${season} · as reported`
      : column.as_of !== dev.figures_on
        ? column.label
        : column.season === dev.year
          ? `${season} · live · as of ${formatShortDate(column.as_of)}`
          : `${season} · closed${column.season < FIRST_DECIDED_SEASON ? ' · reproduced' : ''}`
  return `${words}${column.basis_unconfirmed ? ' · basis unconfirmed' : ''}`
}

/** The one on-demand column staff asked for: a season as of a past day (component state only). */
export interface AsOfPick {
  readonly season: number
  readonly day: string
}

/** The read's `?column=` address: `<season>:<YYYY-MM-DD>`. */
export const columnParam = (pick: AsOfPick): string => `${String(pick.season)}:${pick.day}`

export const NOT_SAVED_TAG = 'not saved · gone when you leave'

/**
 * The columns; the one asked for as of a day carries the tag, since nothing keeps it, and the mock's
 * amber tint (the kit's decided tone).
 */
export function developmentColumns(
  dev: ApiAidDevelopment,
  shown?: AsOfPick | null
): ReportColumn[] {
  return [
    { key: 'line', header: 'Metric' },
    ...dev.columns.map((c, index): ReportColumn => {
      const temporary = shown?.season === c.season && c.as_of === shown.day
      return temporary
        ? {
            key: `column-${String(index)}`,
            header: `${columnHeader(c, dev)} · ${NOT_SAVED_TAG}`,
            tone: 'decided',
          }
        : { key: `column-${String(index)}`, header: columnHeader(c, dev) }
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
  gender_recipients: 1,
  gender_enrolled: 1,
  not_in_group_amount: 1,
  not_in_group_awards: 1,
}

/**
 * The registry note (`reports-development`) a line points at when the read sends it no definition of
 * its own: the mock's superscripts. A line with a definition points at that instead.
 */
const REGISTRY_NOTE: Readonly<Record<string, string>> = {
  total_requests: 'need',
  need_met: 'need',
  total_awards: 'total_awards_granted',
  outside_awards: 'total_awards_granted',
  recipients: 'dev_recipients',
  families: 'dev_families',
  shared_households: 'dev_families',
  teens: 'teens',
  youth: 'teens',
  gender_recipients: 'gender',
  gender_enrolled: 'gender',
  first_time: 'first_time',
  household_level_lines: 'household_level',
  household_level_amount: 'household_level',
  appeals_submitted: 'dev_appeals',
  appeals_in_full: 'dev_appeals',
  appeals_in_part: 'dev_appeals',
  appeals_approved: 'dev_appeals',
  declined_insufficient: 'dev_appeals',
}

/** A registry note: its key and its words (`useAidDefinitions('reports-development').entries`). */
export interface RegistryNote {
  readonly key: string
  readonly text: string
}

function lineIndent(key: string): 0 | 1 | 2 {
  return SUB_LINES[key] ?? (key.startsWith('cancelled_') ? 1 : 0)
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

/** A row while it is built: the words its note number stands for, if any (numbered once all rows exist). */
type Drafted = ReportRow & { readonly noteText?: string | undefined }

/**
 * The table and its numbered notes (development-v2.html, final audit O1-O3). Rows are development's
 * lines, each section once in SECTION_WORDS' order, its lines in the server's order (the Budget line
 * leads Money wherever it is sent). Total Awards Granted's pools follow its own sub-lines; Recipients'
 * groups sit right under it. A line limited to some group kinds reads "label, group" for each group.
 * Every row stays one line: a definition is a superscript number on the row and a numbered note under
 * the table, numbered in the order the rows first call for them; the registry's notes no row calls
 * for follow, in the registry's order.
 */
export function developmentTable(
  dev: ApiAidDevelopment,
  options: DevelopmentTableOptions = {}
): { rows: ReportRow[]; notes: DefinitionNote[] } {
  const registry = options.registry ?? []
  const registryText = new Map(registry.map((note) => [note.key, note.text] as const))
  const drafted: Drafted[] = []
  const order = Object.keys(SECTION_WORDS)
  const lead = (row: ApiAidDevelopmentRow) => (row.key === BUDGET_KEY ? 0 : 1)
  const sent = [...dev.rows].sort(
    (a, b) => order.indexOf(a.section) - order.indexOf(b.section) || lead(a) - lead(b)
  )
  const noteFor = (row: ApiAidDevelopmentRow): string | undefined => {
    if (row.definition !== '') return row.definition
    const key = REGISTRY_NOTE[row.key]
    return key === undefined ? undefined : registryText.get(key)
  }
  const cells = (label: string, row: ApiAidDevelopmentRow) => [
    textValue(label),
    ...row.values.map((value) => valueCell(row, value)),
  ]
  let section: string | null = null
  let pools: Drafted[] = [] // Total Awards Granted's pools, waiting for its sub-lines to pass
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
        noteText: noteFor(every),
        cells: cells(every.label, every),
      })
      if (first.key === OUTSIDE_KEY) drafted.push(...grantorRows(dev, indent, options.fundersHref))
      if (BROKEN_OUT.has(first.key)) {
        const groups: Drafted[] = []
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
          noteText: noteFor(row),
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
  // Number the notes in the order the rows first call for them, each text once.
  const numbers = new Map<string, number>()
  const rows = drafted.map(({ noteText, ...row }): ReportRow => {
    if (noteText === undefined) return row
    let n = numbers.get(noteText)
    if (n === undefined) {
      n = numbers.size + 1
      numbers.set(noteText, n)
    }
    return { ...row, ref: n }
  })
  for (const note of registry) {
    if (!numbers.has(note.text)) numbers.set(note.text, numbers.size + 1)
  }
  const notes = [...numbers].map(([text, n]) => ({ n, text }))
  return { rows, notes }
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

/** "Basis unconfirmed" (O-930-1; §9.4): the seasons whose as-reported basis is being reconciled. */
export function unconfirmedWords(dev: ApiAidDevelopment): string | null {
  const labels = dev.columns.filter((c) => c.basis_unconfirmed).map((c) => c.label)
  if (labels.length === 0) return null
  return `Basis unconfirmed: ${labels.join(', ')}. Whether those as-reported figures were all money or the camp's own dollars only is being reconciled; compare them with the dashboard's seasons with care.`
}

/**
 * A dated column's lines a past read can't rebuild read "—" (Part C D45; slice 2 Decision 11's words).
 * The count is the column's lines as drawn (final audit O10): every row that reads "—" there.
 */
export function notRebuiltColumnWords(
  dev: ApiAidDevelopment,
  rows: readonly ReportRow[]
): string | null {
  const columns = dev.columns
    .map((c, index) => ({ c, index }))
    .filter(({ c }) => (c.not_rebuilt ?? []).length > 0)
  if (columns.length === 0) return null
  const blank = (index: number) =>
    rows.filter((row) => {
      const cell = row.cells[index + 1]
      return (
        row.kind === 'body' && cell !== undefined && cell.kind !== 'text' && cell.value === null
      )
    }).length
  const named = columns
    .map(({ c, index }) => `${c.label} (${String(blank(index))} lines)`)
    .join(', ')
  return `A dated column shows what the dashboard can rebuild for that day: a line it can't reads "—", never an estimate. ${named}.`
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

/**
 * The grantor lines under Outside grants (D88): one per source another funder paid, named, with its
 * facts in muted words. Its amount sits only in the read's own season, the dashboard's column as of the
 * figures day; the other columns have nothing there (D74), so they read "—". The camp's own is no line.
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
      // Who paid, incentive or need-based, and its group (or that it needs one), and "no funder yet"
      // for a description no funder claims: two lines of one funder never read alike (final audit E3).
      const facts = [
        source.who_paid,
        source.incentive ? 'incentive' : 'need-based',
        source.group === '' ? 'needs a group' : source.group_label,
        ...(source.source_key.startsWith('funder:') ? [] : ['no funder yet']),
      ].join(' · ')
      return {
        key: `grantor-${source.source_key}-${source.group}-${String(index)}`,
        kind: 'body' as const,
        indent: Math.min(indent + 1, 2) as 1 | 2,
        note: facts,
        // The CSV has no muted line: the facts ride in the name cell there.
        cells: [
          textValue(source.name, `${source.name} (${facts})`),
          ...own.map((is) => moneyValue(is ? source.amount : null)),
        ],
        links:
          fundersHref === undefined
            ? undefined
            : { 0: fundersHref(fundersParams(source.source_key)) },
      }
    })
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
