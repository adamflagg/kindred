import { Download, Search } from 'lucide-react'
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

import { buildCsvContent, downloadCsv } from '../../../utils/csvExport'
import {
  GROUP,
  GROUP_BUTTON_OFF,
  GROUP_BUTTON_ON,
  SEARCH_INPUT,
} from '../../admin/audit/auditStyles'
import { BUTTON_SECONDARY } from '../../admin/lodging/lodgingStyles'
import { SortableColumnHeader } from '../../ui/SortableColumnHeader'
import {
  CELL_BG,
  EDITOR_ROW,
  GROUP_ROW,
  HIGHLIGHT_EDGE,
  HIGHLIGHT_PINNED_EDGE,
  PINNED_EDGE,
  ROW_HIGHLIGHT,
  TABLE,
  TABLE_CARD,
  TD,
  TFOOT_CELL,
  TH,
  TOTAL_BUTTON,
} from './aidStyles'
import { csvCell, withLinkLine } from './csv'
import { isPageKey } from './keyboard'
import { Money } from './MoneyText'
import {
  groupRows,
  matchesSearch,
  sortRows,
  stepHighlight,
  type CellValue,
  type RowGroup,
} from './table'
import { useAidTableUrl } from './useAidTableUrl'

export interface CellContext {
  readonly highlighted: boolean
  /** The search typed, so a cell can show D27's matched-id chip (`matchedId`, `IdChip`). */
  readonly query: string
}

/**
 * Handed to the editor row (Ruling 2026-10-01 (plan review)): while the editor holds focus the
 * table's own ↑/↓ stand aside (`isPageKey`), so the editor moves the highlight through these.
 */
export interface AidRowNav {
  readonly next: () => void
  readonly previous: () => void
  readonly close: () => void
}

export interface AidColumn<Row> {
  readonly key: string
  readonly header: string
  readonly width?: number | undefined
  readonly flex?: boolean | undefined
  readonly align?: 'left' | 'right' | undefined
  readonly pinned?: boolean | undefined
  readonly value: (row: Row) => CellValue
  readonly render?: ((row: Row, ctx: CellContext) => ReactNode) | undefined
  readonly csv?: ((row: Row) => string) | undefined
  readonly total?: ((rows: readonly Row[]) => number | null) | undefined
  readonly searchable?: boolean | undefined
}

export interface AidGrouping<Row> {
  readonly key: string
  readonly label: string
  readonly groupOf: (row: Row) => { id: string; heading: string }
}

export interface AidTableProps<Row> {
  readonly rows: readonly Row[]
  readonly columns: ReadonlyArray<AidColumn<Row>>
  readonly rowKey: (row: Row) => string
  readonly searchExtra?: ((row: Row) => ReadonlyArray<string | number | null>) | undefined
  readonly groupings?: ReadonlyArray<AidGrouping<Row>> | undefined
  readonly defaultGrouping?: string | undefined
  readonly urlPrefix?: string | undefined
  readonly csvFilename: string
  readonly onOpenTotal?: ((columnKey: string, rows: readonly Row[]) => void) | undefined
  readonly renderBelowHighlighted?: ((row: Row, nav: AidRowNav) => ReactNode) | undefined
  readonly arrowKeys?: boolean | undefined
  readonly footerLabel?: ((rows: readonly Row[]) => ReactNode) | undefined
  readonly groupCount?: ((rows: readonly Row[]) => ReactNode) | undefined
  readonly emptyText?: string | undefined
}

const NO_GROUPINGS: readonly never[] = []
const FLEX_MIN = 250

const join = (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' ')

/**
 * The finance kit's table (§4.3; D18, D20, D24, D25, D28, D29, D31; round7.html): sortable by
 * every column and searchable (names and CampMinder ids), sort and grouping in the URL,
 * identity columns pinned while the money scrolls under them, one flexible column, a footer of
 * totals that each open their rows, a highlighted row (click, or ↑/↓) with the editor row under
 * it, and "Download CSV" of exactly what is on screen. It renders rows it was given (D21).
 */
export function AidTable<Row>({
  rows,
  columns,
  rowKey,
  searchExtra,
  groupings = NO_GROUPINGS,
  defaultGrouping,
  urlPrefix = '',
  csvFilename,
  onOpenTotal,
  renderBelowHighlighted,
  arrowKeys = false,
  footerLabel,
  groupCount,
  emptyText = 'No rows match.',
}: AidTableProps<Row>) {
  const columnKeys = useMemo(() => columns.map((c) => c.key), [columns])
  const groupingKeys = useMemo(() => groupings.map((g) => g.key), [groupings])
  const { sort, group, toggleSort, setGroup } = useAidTableUrl(
    columnKeys,
    groupingKeys,
    urlPrefix,
    defaultGrouping
  )
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())

  const visible = useMemo(() => {
    const searchable = columns.filter((c) => c.searchable)
    const filtered = rows.filter((row) =>
      matchesSearch([...searchable.map((c) => c.value(row)), ...(searchExtra?.(row) ?? [])], query)
    )
    const column = sort ? columns.find((c) => c.key === sort.key) : undefined
    return column && sort ? sortRows(filtered, column.value, sort.dir) : filtered
  }, [rows, columns, searchExtra, query, sort])

  const grouping = groupings.find((g) => g.key === group)
  const groups: Array<RowGroup<Row>> = useMemo(
    () =>
      grouping
        ? groupRows(visible, grouping.groupOf)
        : [{ id: '', heading: '', rows: [...visible] }],
    [visible, grouping]
  )
  const ordered = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  const order = useMemo(() => ordered.map(rowKey), [ordered, rowKey])

  useEffect(() => {
    if (!arrowKeys) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      // Not while a field (the search box, the editor) owns the key, a modifier is held or a modal is open.
      // Nor a key already handled, held down, or part of an IME composition.
      if (event.defaultPrevented || event.repeat || event.isComposing) return
      if (!isPageKey(event) || order.length === 0) return
      event.preventDefault()
      setHighlighted((current) => stepHighlight(order, current, event.key === 'ArrowDown' ? 1 : -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [arrowKeys, order])

  useEffect(() => {
    if (highlighted !== null) rowRefs.current.get(highlighted)?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  const nav: AidRowNav = useMemo(
    () => ({
      next: () => setHighlighted((current) => stepHighlight(order, current, 1)),
      previous: () => setHighlighted((current) => stepHighlight(order, current, -1)),
      close: () => setHighlighted(null),
    }),
    [order]
  )

  const pinnedLeft = useMemo(() => {
    const out = new Map<string, number>()
    let left = 0
    for (const column of columns) {
      if (!column.pinned) break
      out.set(column.key, left)
      left += column.width ?? 0
    }
    return out
  }, [columns])
  const lastPinned = [...pinnedLeft.keys()].at(-1)
  const minWidth = columns.reduce((sum, c) => sum + (c.flex ? FLEX_MIN : (c.width ?? 0)), 0)

  const pinStyle = (column: AidColumn<Row>): CSSProperties | undefined =>
    pinnedLeft.has(column.key) ? { left: pinnedLeft.get(column.key) } : undefined
  const pinClasses = (column: AidColumn<Row>, layer: string) =>
    join(pinnedLeft.has(column.key) && `sticky ${layer}`, column.key === lastPinned && PINNED_EDGE)
  // One shadow class per cell (Ruling 2026-10-01 (plan review)): a highlighted first cell that is
  // also the last pinned one gets the combined shadow, never two competing `shadow-[…]` classes.
  const bodyEdge = (column: AidColumn<Row>, index: number, isHighlighted: boolean) => {
    const highlightEdge = isHighlighted && index === 0
    const pinnedEdge = column.key === lastPinned
    if (highlightEdge && pinnedEdge) return HIGHLIGHT_PINNED_EDGE
    return highlightEdge ? HIGHLIGHT_EDGE : pinnedEdge ? PINNED_EDGE : ''
  }
  const alignClass = (column: AidColumn<Row>) =>
    column.align === 'right' ? 'text-right tabular-nums' : ''

  const download = () => {
    const data = ordered.map((row) =>
      columns.map((c) => (c.csv ? c.csv(row) : csvCell(c.value(row))))
    )
    downloadCsv(
      buildCsvContent(
        columns.map((c) => c.header),
        withLinkLine(data, window.location.href)
      ),
      csvFilename
    )
  }

  const hasTotals = columns.some((c) => c.total)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative w-64">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Search"
            placeholder="Search names or CampMinder ids"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={SEARCH_INPUT}
          />
        </div>
        {groupings.length > 0 && (
          <div className={GROUP}>
            <button
              type="button"
              className={grouping ? GROUP_BUTTON_OFF : GROUP_BUTTON_ON}
              onClick={() => setGroup(null)}
            >
              Flat
            </button>
            {groupings.map((g) => (
              <button
                key={g.key}
                type="button"
                className={group === g.key ? GROUP_BUTTON_ON : GROUP_BUTTON_OFF}
                onClick={() => setGroup(g.key)}
              >
                {g.label}
              </button>
            ))}
          </div>
        )}
        <button type="button" className={`${BUTTON_SECONDARY} ml-auto`} onClick={download}>
          <Download className="h-4 w-4" />
          Download CSV
        </button>
      </div>

      <div className={TABLE_CARD}>
        <table className={TABLE} style={{ minWidth }}>
          <colgroup>
            {columns.map((c) => (
              <col key={c.key} style={c.flex ? undefined : { width: c.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((c) => (
                <SortableColumnHeader
                  key={c.key}
                  label={c.header}
                  direction={
                    sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null
                  }
                  onSort={() => toggleSort(c.key)}
                  style={pinStyle(c)}
                  className={join(TH, pinClasses(c, 'z-20'), c.align === 'right' && 'text-right')}
                  {...(c.align === 'right' ? { buttonClassName: 'justify-end' } : {})}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className={join(TD, CELL_BG, 'text-muted-foreground whitespace-nowrap')}
                >
                  {emptyText}
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <Fragment key={g.id || 'all'}>
                {grouping && g.rows.length > 0 && (
                  <tr>
                    <td colSpan={columns.length} className={GROUP_ROW} data-group-heading="">
                      <span className="sticky left-2">{g.heading}</span>
                      {groupCount ? (
                        <span className="ml-2 font-normal">{groupCount(g.rows)}</span>
                      ) : null}
                    </td>
                  </tr>
                )}
                {g.rows.map((row) => {
                  const key = rowKey(row)
                  const isHighlighted = key === highlighted
                  return (
                    <Fragment key={key}>
                      <tr
                        data-row-key={key}
                        data-highlighted={isHighlighted ? 'true' : undefined}
                        ref={(element) => {
                          if (element) rowRefs.current.set(key, element)
                          else rowRefs.current.delete(key)
                        }}
                        onClick={() => setHighlighted(key)}
                        className="cursor-pointer"
                      >
                        {columns.map((c, index) => (
                          <td
                            key={c.key}
                            style={pinStyle(c)}
                            className={join(
                              TD,
                              isHighlighted ? ROW_HIGHLIGHT : CELL_BG,
                              bodyEdge(c, index, isHighlighted),
                              pinnedLeft.has(c.key) && 'sticky z-10',
                              alignClass(c),
                              c.flex === true && isHighlighted
                                ? 'whitespace-normal'
                                : 'whitespace-nowrap'
                            )}
                          >
                            {c.render
                              ? c.render(row, { highlighted: isHighlighted, query })
                              : (c.value(row) ?? '—')}
                          </td>
                        ))}
                      </tr>
                      {isHighlighted && renderBelowHighlighted && (
                        <tr>
                          <td colSpan={columns.length} className={EDITOR_ROW}>
                            {renderBelowHighlighted(row, nav)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
          {hasTotals && (
            <tfoot>
              <tr>
                {columns.map((c, index) => {
                  const total = c.total ? c.total(visible) : null
                  return (
                    <td
                      key={c.key}
                      style={pinStyle(c)}
                      className={join(TFOOT_CELL, pinClasses(c, 'z-10'), alignClass(c))}
                    >
                      {index === 0 && footerLabel ? footerLabel(visible) : null}
                      {c.total &&
                        (onOpenTotal ? (
                          <button
                            type="button"
                            className={TOTAL_BUTTON}
                            onClick={() => onOpenTotal(c.key, visible)}
                          >
                            <Money value={total} />
                          </button>
                        ) : (
                          <Money value={total} />
                        ))}
                    </td>
                  )
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
