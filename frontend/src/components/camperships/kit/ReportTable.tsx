import { Copy, Download, Search } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import { buildCsvContent, downloadCsv } from '../../../utils/csvExport'
import { SEARCH_INPUT } from '../../admin/audit/auditStyles'
import { AMBER_NOTE, BUTTON_SECONDARY } from '../../admin/lodging/lodgingStyles'
import { SortableColumnHeader } from '../../ui/SortableColumnHeader'
import { CS_LINK } from './csType'
import { DefRef } from './DefinitionNotes'
import { TABLE_CARD } from './kitStyles'
import { Money } from './MoneyText'
import {
  copyText,
  csvLines,
  formatCount,
  reportSortValue,
  reportText,
  type ReportColumn,
  type ReportValue,
  type ReportHeading,
  type ReportRow,
} from './report'
import {
  BASIS_BADGE,
  COUNT_LINK,
  DIVIDER_BEFORE,
  REPORT_NOTE,
  REPORT_TITLE,
  ROW_HEADING,
  ROW_SUBTOTAL,
  ROW_TOTAL,
  TD_DECIDED,
  TD_LABEL,
  TD_NUMBER,
  TH_DECIDED,
  TH_GROUP,
  TH_LABEL,
  TH_NUMBER,
} from './reportStyles'
import { matchesSearch, sortRows } from './table'
import { useAidTableUrl } from './useAidTableUrl'

interface ReportTableProps {
  readonly heading: ReportHeading
  /** "P" or "r" beside the title, when the whole table has one basis. */
  readonly basisBadge?: 'P' | 'r' | null | undefined
  readonly columns: readonly ReportColumn[]
  readonly rows: readonly ReportRow[]
  readonly csvFilename: string
  /** The view's link, for the CSV's last line (D15). */
  readonly link: string
  /** A find box over the body rows (ZIP codes). */
  readonly find?: boolean | undefined
  /** Sortable headers (the sort lives in the URL under `urlPrefix`). */
  readonly sortable?: boolean | undefined
  readonly urlPrefix?: string | undefined
  readonly emptyText?: string | undefined
  /** Words right under the title, above the toolbar (the mock's table description). */
  readonly description?: ReactNode | undefined
  /** The sort while the URL carries none (the URL wins; a header click toggles from it). */
  readonly defaultSort?: { readonly key: string; readonly dir: 'asc' | 'desc' } | undefined
  /** Words under the table. */
  readonly footnote?: ReactNode | undefined
  /** The totals row first, right under the header, sorted or not (zip-codes.html). */
  readonly totalsFirst?: boolean | undefined
}

const BODY_KINDS = new Set(['body', 'end'])

/** A cell as the kit draws it: money through `Money`, a count above 0 with a link as that link (D20). */
function cellContent(cell: ReportValue, href: string | undefined): ReactNode {
  const figure = figureContent(cell, href)
  if (cell.note === undefined) return figure
  return (
    <>
      {figure}
      <div className="text-muted-foreground text-xs font-normal">{cell.note}</div>
    </>
  )
}

function figureContent(cell: ReportValue, href: string | undefined): ReactNode {
  if (cell.kind === 'money') return <Money value={cell.value} />
  if (href !== undefined && cell.kind === 'count' && cell.value !== null && cell.value > 0) {
    return (
      <Link to={href} className={COUNT_LINK}>
        {formatCount(cell.value)}
      </Link>
    )
  }
  // A name that opens its own page (Development's funder lines → Money › Funders).
  if (href !== undefined && cell.kind === 'text') {
    return (
      <Link to={href} className={CS_LINK}>
        {cell.value}
      </Link>
    )
  }
  return reportText(cell)
}

/** A cell's class: its column's alignment or tone, then the column's divider if it has one. */
function cellClass(column: ReportColumn | undefined, index: number, kind: string): string {
  const base =
    index === 0 || column?.align === 'left'
      ? TD_LABEL
      : column?.tone === 'decided'
        ? TD_DECIDED
        : TD_NUMBER
  const mono = column?.mono && kind === 'body' ? `${base} font-mono tabular-nums` : base
  return column?.divider === 'before' ? `${mono} ${DIVIDER_BEFORE}` : mono
}

function indentStyle(indent: number | undefined) {
  return indent ? { paddingLeft: `${String(0.5 + indent)}rem` } : undefined
}

/** The column segments of the group header row: consecutive columns sharing a group. */
function groupSegments(columns: readonly ReportColumn[]) {
  const segments: Array<{ group: string | undefined; span: number; first: ReportColumn }> = []
  for (const column of columns) {
    const last = segments[segments.length - 1]
    if (last !== undefined && column.group !== undefined && last.group === column.group) {
      last.span += 1
    } else {
      segments.push({ group: column.group, span: 1, first: column })
    }
  }
  return segments
}

/**
 * A Reports table (spec §9; §9.7 RPT-33; §11): the server's rows in the server's order, its
 * subtotals and its total as sent (D21), each figure as the kit draws it (D74), with Copy (values as
 * displayed) and Download CSV (plain numbers), both headed by the table's name, season, as-of and
 * basis. A find box filters the body rows only; the totals stay the whole table's, and Copy and the
 * CSV always take the whole table (Decision 6).
 */
export function ReportTable({
  heading,
  basisBadge,
  columns,
  rows,
  csvFilename,
  link,
  find = false,
  sortable = false,
  urlPrefix = '',
  emptyText = 'Nothing to show.',
  footnote,
  description,
  defaultSort,
  totalsFirst = false,
}: ReportTableProps) {
  const columnKeys = useMemo(() => columns.map((c) => c.key), [columns])
  const { sort, toggleSort } = useAidTableUrl(columnKeys, [], urlPrefix, undefined, defaultSort)
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  // The rows as shown: a sort reorders the body rows; `end` rows stay after them, totals last (or
  // first, with `totalsFirst`).
  const ordered = useMemo(() => {
    const sorted = (() => {
      if (!sortable || sort === null) return rows
      const index = columnKeys.indexOf(sort.key)
      const body = sortRows(
        rows.filter((r) => r.kind === 'body'),
        (r) => reportSortValue(r.cells[index]),
        sort.dir
      )
      return [
        ...body,
        ...rows.filter((r) => r.kind === 'end'),
        ...rows.filter((r) => !BODY_KINDS.has(r.kind)),
      ]
    })()
    if (!totalsFirst) return sorted
    return [
      ...sorted.filter((r) => r.kind === 'total'),
      ...sorted.filter((r) => r.kind !== 'total'),
    ]
  }, [rows, sortable, sort, columnKeys, totalsFirst])

  const searching = find && query.trim() !== ''
  const visible = searching
    ? ordered.filter(
        (r) => !BODY_KINDS.has(r.kind) || matchesSearch(r.cells.map(reportText), query)
      )
    : ordered
  const bodyCount = ordered.filter((r) => BODY_KINDS.has(r.kind)).length
  const matching = visible.filter((r) => BODY_KINDS.has(r.kind)).length
  const grouped = columns.some((c) => c.group !== undefined)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText(heading, columns, ordered))
      setCopied('Copied, with its as-of date and basis: paste it into a spreadsheet.')
    } catch {
      setCopied("Couldn't copy here: use Download CSV.")
    }
  }
  const download = () => {
    const [first = [], ...rest] = csvLines(heading, columns, ordered, link)
    downloadCsv(buildCsvContent(first, rest), csvFilename)
  }

  const header = (column: ReportColumn, index: number, rowSpan?: number) => {
    const numeric = index > 0 && column.align !== 'left'
    const base = column.tone === 'decided' ? TH_DECIDED : numeric ? TH_NUMBER : TH_LABEL
    const thClass = column.divider === 'before' ? `${base} ${DIVIDER_BEFORE}` : base
    const label = (
      <>
        {column.header}
        {column.note ? <DefRef n={column.note} /> : null}
      </>
    )
    if (sortable) {
      return (
        <SortableColumnHeader
          key={column.key}
          label={column.header}
          direction={
            sort?.key === column.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null
          }
          onSort={() => toggleSort(column.key)}
          indicator={
            <>
              {column.note ? <DefRef n={column.note} /> : null}
              {sort?.key === column.key ? (sort.dir === 'asc' ? '↑' : '↓') : null}
            </>
          }
          className={thClass}
          buttonClassName={numeric || column.tone === 'decided' ? 'justify-end' : ''}
          style={column.width ? { width: column.width } : undefined}
        />
      )
    }
    return (
      <th
        key={column.key}
        rowSpan={rowSpan}
        className={thClass}
        style={column.width ? { width: column.width } : undefined}
      >
        {label}
      </th>
    )
  }

  const actions = (
    <span className={find ? 'flex gap-2' : 'ml-auto flex gap-2'}>
      <button type="button" className={BUTTON_SECONDARY} onClick={() => void copy()}>
        <Copy className="h-3.5 w-3.5" /> Copy
      </button>
      <button type="button" className={BUTTON_SECONDARY} onClick={download}>
        <Download className="h-3.5 w-3.5" /> Download CSV
      </button>
    </span>
  )

  return (
    <section className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={REPORT_TITLE}>
          {heading.title}
          {basisBadge ? <span className={BASIS_BADGE}>{basisBadge}</span> : null}
        </h2>
        {!find && actions}
      </div>
      {description !== undefined && <div className={REPORT_NOTE}>{description}</div>}
      {find && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find"
              aria-label={`Find in ${heading.title}`}
              className={`${SEARCH_INPUT} pl-7`}
            />
          </label>
          {actions}
        </div>
      )}
      {copied !== null && <p className={REPORT_NOTE}>{copied}</p>}
      <div className={TABLE_CARD}>
        {/* aria-label: a test handle naming the table by its heading (frontend/CLAUDE.md's rule). */}
        <table
          aria-label={heading.title}
          className="w-full border-separate border-spacing-0 text-sm"
        >
          <thead>
            {grouped ? (
              <>
                <tr>
                  {groupSegments(columns).map((segment) =>
                    segment.group === undefined ? (
                      header(segment.first, columns.indexOf(segment.first), 2)
                    ) : (
                      <th
                        key={`group-${segment.first.key}`}
                        colSpan={segment.span}
                        className={TH_GROUP}
                      >
                        {segment.group}
                      </th>
                    )
                  )}
                </tr>
                <tr>
                  {columns.map((column, index) =>
                    column.group === undefined ? null : header(column, index)
                  )}
                </tr>
              </>
            ) : (
              <tr>{columns.map((column, index) => header(column, index))}</tr>
            )}
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length} className={`${TD_LABEL} text-muted-foreground`}>
                  {emptyText}
                </td>
              </tr>
            )}
            {visible.map((row) =>
              row.kind === 'heading' ? (
                <tr key={row.key}>
                  <td colSpan={columns.length} className={ROW_HEADING}>
                    {row.cells[0] ? reportText(row.cells[0]) : ''}
                  </td>
                </tr>
              ) : (
                <tr
                  key={row.key}
                  className={
                    row.kind === 'total'
                      ? ROW_TOTAL
                      : row.kind === 'subtotal'
                        ? ROW_SUBTOTAL
                        : undefined
                  }
                >
                  {row.cells.map((cell, index) => (
                    <td
                      key={columns[index]?.key ?? index}
                      className={cellClass(columns[index], index, row.kind)}
                      style={index === 0 ? indentStyle(row.indent) : undefined}
                    >
                      {cellContent(cell, row.links?.[index])}
                      {index === 0 && row.ref !== undefined ? <DefRef n={row.ref} /> : null}
                      {index === 0 && row.note ? (
                        <div className={`${REPORT_NOTE} whitespace-normal`}>{row.note}</div>
                      ) : null}
                    </td>
                  ))}
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
      {searching && (
        <p className={AMBER_NOTE}>
          {`${String(matching)} of ${String(bodyCount)} rows match. The totals row is the whole table's; Copy and Download CSV take the whole table.`}
        </p>
      )}
      {footnote !== undefined && <div className={REPORT_NOTE}>{footnote}</div>}
    </section>
  )
}
