import { Search } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import { SortableColumnHeader } from '../../ui/SortableColumnHeader'
import { CS_BODY, CS_BOUNDED, CS_CUT, CS_LINK_CELL, CS_SEARCH, CS_TOOLBAR_STATUS } from './csType'
import { AidCopyButton, AidCsvButton } from './CsvButton'
import { DefRef } from './DefinitionNotes'
import { CS_BAND, CS_RULE, TABLE_CARD } from './kitStyles'
import { Money } from './MoneyText'
import {
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
  REPORT_DESC,
  REPORT_NOTE,
  REPORT_TITLE,
  ROW_END,
  ROW_HEADING,
  ROW_SUBTOTAL,
  ROW_TOTAL,
  TD_DECIDED,
  TD_DECIDED_INK,
  TD_LABEL,
  TD_NUMBER,
  TH_DECIDED,
  TH_DECIDED_INK,
  TH_GROUP,
  TH_LABEL,
  TH_NUMBER,
} from './reportStyles'
import { matchesSearch, sortRows } from './table'
import { useAidTableUrl } from './useAidTableUrl'
import { useReportExport } from './useReportExport'

interface ReportTableProps {
  readonly heading: ReportHeading
  /** "P" or "r" beside the title, when the whole table has one basis. */
  readonly basisBadge?: 'P' | 'r' | null | undefined
  readonly columns: readonly ReportColumn[]
  readonly rows: readonly ReportRow[]
  readonly csvFilename: string
  /** The view's link, for the CSV's last line (D15). */
  readonly link: string
  /**
   * False: no heading row (title, description, Copy, Download CSV). The page then puts this table's Copy
   * and CSV on its own controls row, through `useReportExport`, and the basis badge on the total row.
   */
  readonly showHeading?: boolean | undefined
  /** Fixed column widths (every column's `width`; the first takes the rest), so a long label cuts. */
  readonly fixed?: boolean | undefined
  /** A find box over the body rows (ZIP codes). */
  readonly find?: boolean | undefined
  /** Sortable headers (the sort lives in the URL under `urlPrefix`). */
  readonly sortable?: boolean | undefined
  readonly urlPrefix?: string | undefined
  readonly emptyText?: string | undefined
  /** Muted words right after the title on the heading row, truncated with a title (the mock's CF.thead). */
  readonly description?: ReactNode | undefined
  /** The sort while the URL carries none (the URL wins; a header click toggles from it). */
  readonly defaultSort?: { readonly key: string; readonly dir: 'asc' | 'desc' } | undefined
  /** Replaces the grid with a muted empty body (a refused date): the heading row stays. */
  readonly emptyBody?: ReactNode | undefined
  /** Words under the table. */
  readonly footnote?: ReactNode | undefined
  /** The totals row first, right under the header, sorted or not (zip-codes.html). */
  readonly totalsFirst?: boolean | undefined
  /** The title's hover: the table's description, in place of a line under it (zip-codes.html). */
  readonly hint?: string | undefined
  /** The find box's placeholder ("Find a ZIP") and width in px; the default is "Find", 140px. */
  readonly findPlaceholder?: string | undefined
  readonly findWidth?: number | undefined
  /** What the find status counts, in its title ("ZIPs"); the default is "rows". */
  readonly findNoun?: string | undefined
  /** False: the heading row carries the title alone, with no find, Copy or Download CSV (a table with no rows to find). */
  readonly tools?: boolean | undefined
  /**
   * A bounded card (§23): 420px tall at most, scrolling inside, in the page's flow and never sticky to the
   * window. The header and, with `totalsFirst`, the totals row stay pinned while the body scrolls.
   */
  readonly bounded?: boolean | undefined
}

const BODY_KINDS = new Set(['body', 'end'])

/** Whether the screen draws a column: csvOnly and exportOnly ones live in the exports alone. */
const onScreen = (c: ReportColumn) => !c.csvOnly && !c.exportOnly
/** The mock's `.cf-empty`: a dashed card in muted body type, standing where the grid would. */
const EMPTY_BODY = `bg-card border-border text-muted-foreground rounded-xl border border-dashed px-4 py-3.5 ${CS_BODY}`

/** A cell as the kit draws it: money through `Money`, a count above 0 with a link as that link (D20). */
function cellContent(cell: ReportValue, href: string | undefined): ReactNode {
  const figure = cell.display !== undefined ? cell.display : figureContent(cell, href)
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
      <Link to={href} className={CS_LINK_CELL}>
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
        : column?.tone === 'decided-ink'
          ? TD_DECIDED_INK
          : TD_NUMBER
  const mono =
    column?.mono && kind === 'body' ? `${base} font-mono text-[12.5px] tabular-nums` : base
  return column?.divider === 'before' ? mono.replace(CS_RULE, DIVIDER_BEFORE) : mono
}

/** A cell's native title: the cell's own, else a text cell's words (it may be cut); a figure has none. */
function cellTitle(cell: ReportValue): string | undefined {
  if (cell.title !== undefined) return cell.title
  return cell.kind === 'text' && cell.value !== '' && cell.value !== '—' ? cell.value : undefined
}

/** The first cell is drawn as a flex line (cut label, mark, badge) rather than plain content. */
function labelLine(
  index: number,
  row: ReportRow,
  span: number,
  fixed: boolean,
  cell: ReportValue
): boolean {
  return (
    index === 0 && (row.badge !== undefined || span > 1 || (fixed && cell.display === undefined))
  )
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
  showHeading = true,
  fixed = false,
  find = false,
  sortable = false,
  urlPrefix = '',
  emptyText = 'Nothing to show.',
  footnote,
  emptyBody,
  description,
  defaultSort,
  totalsFirst = false,
  hint,
  findPlaceholder = 'Find',
  findWidth,
  findNoun = 'rows',
  tools = true,
  bounded = false,
}: ReportTableProps) {
  const columnKeys = useMemo(() => columns.map((c) => c.key), [columns])
  const { sort, toggleSort } = useAidTableUrl(columnKeys, [], urlPrefix, undefined, defaultSort)
  const [query, setQuery] = useState('')

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
  // The find status counts the table's own rows (ZIPs), never its end rows ("Outside the US", "No ZIP on file").
  const bodyCount = ordered.filter((r) => r.kind === 'body').length
  const matching = visible.filter((r) => r.kind === 'body').length
  // csvOnly columns are in Download CSV, never on screen or in Copy; exportOnly ones are in Copy and
  // Download CSV, never on screen.
  const drawn = useMemo(() => columns.filter(onScreen), [columns])
  const grouped = drawn.some((c) => c.group !== undefined)

  const { copy, download, copied, failed } = useReportExport({
    heading,
    columns,
    rows: ordered,
    csvFilename,
    link,
  })

  const header = (column: ReportColumn, index: number, rowSpan?: number) => {
    const numeric = index > 0 && column.align !== 'left'
    const base =
      column.tone === 'decided'
        ? TH_DECIDED
        : column.tone === 'decided-ink'
          ? TH_DECIDED_INK
          : numeric
            ? TH_NUMBER
            : TH_LABEL
    const ruled = column.divider === 'before' ? base.replace(CS_RULE, DIVIDER_BEFORE) : base
    // Only the table's first column drops its rule: in a grouped header the second row's first
    // cell is a later column, and `first:` would strip its rule there.
    const rule = index === 0 ? ruled : ruled.replace(/\s*first:border-l-0/, '')
    // One line unless the column opts into wrapping (the mock's `wrap`).
    const wrapped = column.wrap ? rule.replace('whitespace-nowrap', 'whitespace-normal') : rule
    // A bounded card pins its header row (z-[2]: above the pinned totals row's z-[1]).
    const thClass = bounded ? `${wrapped} sticky top-0 z-[2]` : wrapped
    const label = (
      <>
        {column.header}
        {column.sub ? (
          <span className="text-muted-foreground block text-[11px] leading-[14px] font-normal">
            {column.sub}
          </span>
        ) : null}
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
              {sort?.key === column.key ? (
                <span className="text-primary ml-0.5 font-bold">
                  {sort.dir === 'asc' ? '↑' : '↓'}
                </span>
              ) : null}
            </>
          }
          className={thClass}
          title={column.title}
          buttonClassName={numeric || column.tone !== undefined ? 'justify-end' : ''}
          // the note mark rides the label's baseline like an inline <sup> (the mock's `.cf-sort`)
          layoutClassName="items-baseline"
          style={column.width ? { width: column.width } : undefined}
        />
      )
    }
    return (
      <th
        key={column.key}
        rowSpan={rowSpan}
        className={thClass}
        title={column.title}
        style={column.width ? { width: column.width } : undefined}
      >
        {label}
      </th>
    )
  }

  return (
    <section className="space-y-1.5">
      {showHeading && (
        <div data-testid="report-heading-row" className="flex flex-nowrap items-center gap-2.5">
          <h2
            className={`${REPORT_TITLE} shrink-0 whitespace-nowrap`}
            title={hint ?? heading.title}
          >
            {heading.title}
            {basisBadge ? <span className={BASIS_BADGE}>{basisBadge}</span> : null}
          </h2>
          {description !== undefined && (
            <div
              className={REPORT_DESC}
              title={typeof description === 'string' ? description : undefined}
            >
              {description}
            </div>
          )}
          <div className="ml-auto flex min-w-0 flex-none flex-nowrap items-center gap-2">
            {tools && searching && (
              <span
                data-testid="find-status"
                className={CS_TOOLBAR_STATUS}
                title={`${String(matching)} of ${String(bodyCount)} ${findNoun} match “${query.trim()}”; the totals row stays the whole table's`}
              >
                {`${String(matching)} of ${String(bodyCount)}`}
              </span>
            )}
            {tools && failed !== null && (
              <span className={CS_TOOLBAR_STATUS} title={failed}>
                {failed}
              </span>
            )}
            {tools && find && (
              <label
                className={`relative inline-block flex-none ${findWidth === undefined ? 'w-[140px]' : ''}`}
                style={findWidth === undefined ? undefined : { width: `${String(findWidth)}px` }}
              >
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={findPlaceholder}
                  aria-label={`Find in ${heading.title}`}
                  className={CS_SEARCH}
                />
              </label>
            )}
            {/* An empty body has nothing to export: the mock's heading row is bare there. */}
            {tools && emptyBody === undefined && (
              <>
                <AidCopyButton
                  copied={copied}
                  onCopy={() => void copy()}
                  title="Copy the whole table, with its season, as-of date and basis, for a spreadsheet"
                />
                <AidCsvButton onDownload={download} />
              </>
            )}
          </div>
        </div>
      )}
      {emptyBody !== undefined ? (
        <div className={EMPTY_BODY}>{emptyBody}</div>
      ) : (
        <div className={bounded ? CS_BOUNDED : TABLE_CARD}>
          {/* aria-label: a test handle naming the table by its heading (frontend/CLAUDE.md's rule). */}
          <table
            aria-label={heading.title}
            className={`w-full border-separate border-spacing-0 text-sm ${fixed ? 'table-fixed' : ''}`}
          >
            {fixed && (
              // table-fixed reads its widths from the first header row, which in a grouped header holds
              // group cells with none: a colgroup sizes every column, and the unsized first one takes the rest.
              <colgroup>
                {drawn.map((column) => (
                  <col
                    key={column.key}
                    style={column.width ? { width: column.width } : undefined}
                  />
                ))}
              </colgroup>
            )}
            <thead>
              {grouped ? (
                <>
                  <tr>
                    {groupSegments(drawn).map((segment) =>
                      segment.group === undefined ? (
                        header(segment.first, drawn.indexOf(segment.first), 2)
                      ) : (
                        <th
                          key={`group-${segment.first.key}`}
                          colSpan={segment.span}
                          className={
                            segment.first.divider === 'before'
                              ? TH_GROUP.replace(CS_RULE, DIVIDER_BEFORE)
                              : TH_GROUP
                          }
                        >
                          {segment.group}
                          {segment.first.groupNote ? <DefRef n={segment.first.groupNote} /> : null}
                        </th>
                      )
                    )}
                  </tr>
                  <tr>
                    {drawn.map((column, index) =>
                      column.group === undefined ? null : header(column, index)
                    )}
                  </tr>
                </>
              ) : (
                <tr>{drawn.map((column, index) => header(column, index))}</tr>
              )}
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={drawn.length} className={`${TD_LABEL} text-muted-foreground`}>
                    {emptyText}
                  </td>
                </tr>
              )}
              {visible.map((row) =>
                row.kind === 'heading' ? (
                  <tr key={row.key}>
                    <td colSpan={drawn.length} className={ROW_HEADING}>
                      {row.cells[0] ? reportText(row.cells[0]) : ''}
                      {row.meta ? (
                        <span className="text-muted-foreground ml-2 font-normal">{row.meta}</span>
                      ) : null}
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
                          : row.kind === 'end'
                            ? ROW_END
                            : undefined
                    }
                  >
                    {row.cells.map((cell, index) => {
                      const span = row.span ?? 1
                      const pinned = bounded && totalsFirst && row.kind === 'total'
                      // A spanned label covers the cells after it (they stay in `cells` for Copy and the CSV).
                      if (index > 0 && index < span) return null
                      if (columns[index] && !onScreen(columns[index])) return null
                      return (
                        <td
                          key={columns[index]?.key ?? index}
                          colSpan={
                            index === 0 && span > 1
                              ? columns.slice(0, span).filter(onScreen).length
                              : undefined
                          }
                          title={cellTitle(cell)}
                          className={[
                            cellClass(columns[index], index, row.kind),
                            cell.muted ? 'text-muted-foreground' : '',
                            // 27px: one header row here (5 + 16 + 5 + 1); a grouped (two-row) header would need its own offset.
                            pinned ? `sticky top-[27px] z-[1] ${CS_BAND}` : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          style={index === 0 ? indentStyle(row.indent) : undefined}
                        >
                          {labelLine(index, row, span, fixed, cell) ? (
                            // a spanned label cuts with a title; the badge stays at its right end
                            <span className="flex items-center gap-1.5">
                              <span className={`${CS_CUT} min-w-0 flex-initial`}>
                                {cellContent(cell, row.links?.[index])}
                              </span>
                              {index === 0 && row.ref !== undefined ? (
                                <span className="-ml-1 flex-none">
                                  <DefRef n={row.ref} />
                                </span>
                              ) : null}
                              {row.badge !== undefined && (
                                <span className={`${BASIS_BADGE} ml-auto flex-none`}>
                                  {row.badge}
                                </span>
                              )}
                            </span>
                          ) : (
                            cellContent(cell, row.links?.[index])
                          )}
                          {index === 0 &&
                          row.ref !== undefined &&
                          !labelLine(index, row, span, fixed, cell) ? (
                            <DefRef n={row.ref} />
                          ) : null}
                          {index === 0 && row.note ? (
                            <div className={`${REPORT_NOTE} whitespace-normal`}>{row.note}</div>
                          ) : null}
                        </td>
                      )
                    })}
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
      {footnote !== undefined && <div className={REPORT_NOTE}>{footnote}</div>}
    </section>
  )
}
