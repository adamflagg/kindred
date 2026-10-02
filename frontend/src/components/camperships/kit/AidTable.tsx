import { Download, Search } from 'lucide-react'
import {
  Fragment,
  useCallback,
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
} from './kitStyles'
import { csvCell, withLinkLine } from './csv'
import { isPageKey } from './keyboard'
import { moneyCsv } from './money'
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
 * table's own ↑/↓ stand aside (`isPageKey`, and anywhere inside the editor row, so a focused Save or
 * Cancel button never lets ↓ unmount the editor with unsaved input), so the editor moves the
 * highlight through these. `highlight` puts it on any row: owner ruling A (2026-10-01) jumps back to
 * a row whose save failed.
 */
export interface AidRowNav {
  readonly next: () => void
  readonly previous: () => void
  readonly close: () => void
  readonly highlight: (key: string | null) => void
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
  /** False leaves the column out of Download CSV: an action column has nothing to export (M16). */
  readonly inCsv?: boolean | undefined
}

/** A column only the CSV carries: a figure the screen draws inside another cell (M16). */
export interface AidCsvExtra<Row> {
  readonly header: string
  readonly value: (row: Row) => string
}

export interface AidGrouping<Row> {
  readonly key: string
  readonly label: string
  readonly groupOf: (row: Row) => { id: string; heading: string }
}

/**
 * Stability: `columns`, `groupings`, `rowKey` and `searchExtra` feed memos and effects, so pass
 * module-level constants or memoised values, never fresh literals each render. Only one table per
 * page may set `arrowKeys` (it adds a `window` ↑/↓ listener).
 */
export interface AidTableProps<Row> {
  readonly rows: readonly Row[]
  readonly columns: ReadonlyArray<AidColumn<Row>>
  readonly rowKey: (row: Row) => string
  readonly searchExtra?: ((row: Row) => ReadonlyArray<string | number | null>) | undefined
  readonly groupings?: ReadonlyArray<AidGrouping<Row>> | undefined
  readonly defaultGrouping?: string | undefined
  readonly urlPrefix?: string | undefined
  readonly csvFilename: string
  readonly csvExtra?: ReadonlyArray<AidCsvExtra<Row>> | undefined
  readonly onOpenTotal?: ((columnKey: string, rows: readonly Row[]) => void) | undefined
  readonly renderBelowHighlighted?: ((row: Row, nav: AidRowNav) => ReactNode) | undefined
  readonly arrowKeys?: boolean | undefined
  /**
   * A controlled highlight (slice 1): pass both. Every change (a row click, ↑/↓, the editor row's
   * nav) then goes through `onHighlight`, so a surface can save what is typed first (owner ruling B)
   * and keep the row in its URL. Without them the table keeps the highlight itself.
   */
  readonly highlighted?: string | null | undefined
  readonly onHighlight?: ((key: string | null) => void) | undefined
  /**
   * Rows to mark (Decision 3: a save that failed). Read at row render, so a change re-renders rows
   * without rebuilding columns. Pass a memoised Set.
   */
  readonly markedKeys?: ReadonlySet<string> | undefined
  /** Bulk actions (§4.10): the selected row keys. Pass both; a checkbox column then leads the table. */
  readonly selected?: ReadonlySet<string> | undefined
  readonly onSelectedChange?: ((next: ReadonlySet<string>) => void) | undefined
  readonly footerLabel?: ((rows: readonly Row[]) => ReactNode) | undefined
  readonly groupCount?: ((rows: readonly Row[]) => ReactNode) | undefined
  readonly emptyText?: string | undefined
}

/** A column with a `total` is money: its value is a number, or nothing there. */
const moneyValue = (value: CellValue): number | null => (typeof value === 'number' ? value : null)

const NO_GROUPINGS: readonly never[] = []
const FLEX_MIN = 250
/** The selection's checkbox column (§4.10). */
const SELECT_WIDTH = 32

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
  csvExtra,
  onOpenTotal,
  renderBelowHighlighted,
  arrowKeys = false,
  highlighted: highlightedProp,
  onHighlight,
  footerLabel,
  markedKeys,
  selected,
  onSelectedChange,
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
  const [ownHighlight, setOwnHighlight] = useState<string | null>(null)
  const highlighted = onHighlight ? (highlightedProp ?? null) : ownHighlight
  const setHighlight = useCallback(
    (key: string | null) => {
      if (onHighlight) onHighlight(key)
      else setOwnHighlight(key)
    },
    [onHighlight]
  )
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())

  const searchable = useMemo(() => columns.filter((c) => c.searchable), [columns])
  const matches = useCallback(
    (row: Row) =>
      matchesSearch([...searchable.map((c) => c.value(row)), ...(searchExtra?.(row) ?? [])], query),
    [searchable, searchExtra, query]
  )
  // The row you are on stays on screen through a search: its editor, its typing and its failure are
  // on it. It is display only (owner ruling 2026-10-01): totals, group counts and the CSV always
  // mean the rows matching the search. Only a highlight the search would hide changes `kept`, so
  // ↑/↓ over matching rows never re-sorts.
  const kept = useMemo(() => {
    if (highlighted === null) return null
    const row = rows.find((r) => rowKey(r) === highlighted)
    return row !== undefined && !matches(row) ? highlighted : null
  }, [rows, rowKey, highlighted, matches])

  const sorted = useCallback(
    (list: readonly Row[]) => {
      const column = sort ? columns.find((c) => c.key === sort.key) : undefined
      return column && sort ? sortRows(list, column.value, sort.dir) : [...list]
    },
    [columns, sort]
  )
  // The rows matching the search: what the totals, the counts and the CSV are of.
  const visible = useMemo(() => sorted(rows.filter(matches)), [rows, matches, sorted])
  // What is drawn: those, plus the kept row.
  const shown = useMemo(
    () =>
      kept === null ? visible : sorted(rows.filter((row) => rowKey(row) === kept || matches(row))),
    [kept, visible, rows, rowKey, matches, sorted]
  )

  const grouping = groupings.find((g) => g.key === group)
  const groups: Array<RowGroup<Row>> = useMemo(
    () =>
      grouping ? groupRows(shown, grouping.groupOf) : [{ id: '', heading: '', rows: [...shown] }],
    [shown, grouping]
  )
  const ordered = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  const order = useMemo(() => ordered.map(rowKey), [ordered, rowKey])
  // Without the kept row: a group's count and the CSV are of matching rows only.
  const counted = (list: readonly Row[]) =>
    kept === null ? list : list.filter((row) => rowKey(row) !== kept)

  const selection =
    selected !== undefined && onSelectedChange !== undefined
      ? { selected, onChange: onSelectedChange }
      : null
  const selectable = selection !== null
  const span = columns.length + (selectable ? 1 : 0)
  // The rows the search matches, without the kept row (`counted`): what Select all takes.
  const selectableKeys = counted(ordered).map(rowKey)
  const allSelected =
    selection !== null &&
    selectableKeys.length > 0 &&
    selectableKeys.every((key) => selection.selected.has(key))
  const toggleAll = () => {
    if (selection === null) return
    const next = new Set(selection.selected)
    for (const key of selectableKeys) {
      if (allSelected) next.delete(key)
      else next.add(key)
    }
    selection.onChange(next)
  }
  const toggleOne = (key: string) => {
    if (selection === null) return
    const next = new Set(selection.selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    selection.onChange(next)
  }

  useEffect(() => {
    if (!arrowKeys) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      // Not while a field (the search box, the editor) owns the key, a modifier is held, a modal is
      // open, or the key was already handled, held down or part of an IME composition (isPageKey).
      // Nor while focus is anywhere in the editor row (a Save button is not a typing target).
      if (event.target instanceof Element && event.target.closest('[data-aid-editor]') !== null)
        return
      if (!isPageKey(event) || order.length === 0) return
      event.preventDefault()
      setHighlight(stepHighlight(order, highlighted, event.key === 'ArrowDown' ? 1 : -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [arrowKeys, order, highlighted, setHighlight])

  useEffect(() => {
    if (highlighted !== null) rowRefs.current.get(highlighted)?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  // Each move is worked out from the highlight this render shows, so two moves in one tick can't
  // step twice.
  const nav: AidRowNav = useMemo(
    () => ({
      next: () => setHighlight(stepHighlight(order, highlighted, 1)),
      previous: () => setHighlight(stepHighlight(order, highlighted, -1)),
      close: () => setHighlight(null),
      highlight: setHighlight,
    }),
    [order, highlighted, setHighlight]
  )

  const pinnedLeft = useMemo(() => {
    const out = new Map<string, number>()
    let left = selectable ? SELECT_WIDTH : 0
    for (const column of columns) {
      if (!column.pinned) break
      out.set(column.key, left)
      left += column.width ?? 0
    }
    return out
  }, [columns, selectable])
  const lastPinned = [...pinnedLeft.keys()].at(-1)
  const minWidth =
    columns.reduce((sum, c) => sum + (c.flex ? FLEX_MIN : (c.width ?? 0)), 0) +
    (selectable ? SELECT_WIDTH : 0)

  const pinStyle = (column: AidColumn<Row>): CSSProperties | undefined =>
    pinnedLeft.has(column.key) ? { left: pinnedLeft.get(column.key) } : undefined
  const pinClasses = (column: AidColumn<Row>, layer: string) =>
    join(pinnedLeft.has(column.key) && `sticky ${layer}`, column.key === lastPinned && PINNED_EDGE)
  // One shadow class per cell (Ruling 2026-10-01 (plan review)): a highlighted first cell that is
  // also the last pinned one gets the combined shadow, never two competing `shadow-[…]` classes.
  // A marked row (a failed save) wears the same amber bar as the highlight, on its first cell only.
  const bodyEdge = (
    column: AidColumn<Row>,
    index: number,
    isHighlighted: boolean,
    isMarked: boolean
  ) => {
    // With a checkbox column the bar belongs to that cell instead.
    const highlightEdge = (isHighlighted || isMarked) && index === 0 && !selectable
    const pinnedEdge = column.key === lastPinned
    if (highlightEdge && pinnedEdge) return HIGHLIGHT_PINNED_EDGE
    return highlightEdge ? HIGHLIGHT_EDGE : pinnedEdge ? PINNED_EDGE : ''
  }
  const alignClass = (column: AidColumn<Row>) =>
    column.align === 'right' ? 'text-right tabular-nums' : ''

  const download = () => {
    const csvColumns = columns.filter((c) => c.inCsv !== false)
    const extra = csvExtra ?? []
    // counted(): the kept row (shown only because it is highlighted) stays out of the file.
    const data = counted(ordered).map((row) => [
      ...csvColumns.map((c) =>
        c.csv ? c.csv(row) : c.total ? moneyCsv(moneyValue(c.value(row))) : csvCell(c.value(row))
      ),
      ...extra.map((e) => e.value(row)),
    ])
    downloadCsv(
      buildCsvContent(
        [...csvColumns.map((c) => c.header), ...extra.map((e) => e.header)],
        withLinkLine(data, window.location.href)
      ),
      csvFilename
    )
  }

  const hasTotals = columns.some((c) => c.total)
  const labelSpan = (() => {
    if (!footerLabel) return 1
    let span = 0
    for (const c of columns) {
      if (!pinnedLeft.has(c.key) || c.total) break
      span += 1
    }
    return Math.max(span, 1)
  })()

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
            {selectable && <col style={{ width: SELECT_WIDTH }} />}
            {columns.map((c) => (
              <col key={c.key} style={c.flex ? undefined : { width: c.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {selection && (
                <th className={join(TH, 'sticky left-0 z-20')}>
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                </th>
              )}
              {columns.map((c) => (
                <SortableColumnHeader
                  key={c.key}
                  label={c.header}
                  direction={
                    sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null
                  }
                  onSort={() => toggleSort(c.key)}
                  style={pinStyle(c)}
                  className={join(TH, pinClasses(c, 'z-20'))}
                  {...(c.align === 'right' ? { buttonClassName: 'justify-end' } : {})}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={span}
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
                    <td colSpan={span} className={GROUP_ROW} data-group-heading="">
                      <span className="sticky left-2">{g.heading}</span>
                      {groupCount ? (
                        <span className="ml-2 font-normal">{groupCount(counted(g.rows))}</span>
                      ) : null}
                    </td>
                  </tr>
                )}
                {g.rows.map((row) => {
                  const key = rowKey(row)
                  const isHighlighted = key === highlighted
                  const isMarked = markedKeys?.has(key) === true
                  return (
                    <Fragment key={key}>
                      <tr
                        data-row-key={key}
                        data-highlighted={isHighlighted ? 'true' : undefined}
                        data-marked={isMarked ? 'true' : undefined}
                        ref={(element) => {
                          if (element) rowRefs.current.set(key, element)
                          else rowRefs.current.delete(key)
                        }}
                        onClick={() => {
                          if (key !== highlighted) setHighlight(key)
                        }}
                        className="cursor-pointer"
                      >
                        {selection && (
                          <td
                            className={join(
                              TD,
                              isHighlighted ? ROW_HIGHLIGHT : CELL_BG,
                              'sticky left-0 z-10 whitespace-nowrap',
                              (isHighlighted || isMarked) && HIGHLIGHT_EDGE
                            )}
                          >
                            <input
                              type="checkbox"
                              aria-label="Select"
                              checked={selection.selected.has(key)}
                              // A tick is not a click on the row: no highlight, so no save-then-move.
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleOne(key)}
                            />
                          </td>
                        )}
                        {columns.map((c, index) => (
                          <td
                            key={c.key}
                            style={pinStyle(c)}
                            className={join(
                              TD,
                              isHighlighted ? ROW_HIGHLIGHT : CELL_BG,
                              bodyEdge(c, index, isHighlighted, isMarked),
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
                          <td colSpan={span} className={EDITOR_ROW} data-aid-editor="">
                            {/* Sticky-left like the group headings, so focus doesn't snap a right-scrolled table back. */}
                            <div className="sticky left-3 w-fit max-w-5xl">
                              {renderBelowHighlighted(row, nav)}
                            </div>
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
                  // The footer label spans the leading pinned columns that carry no total, so the
                  // sticky cell after it can't paint over it (I1).
                  if (index > 0 && index < labelSpan) return null
                  const spans = index === 0 && labelSpan > 1
                  // The checkbox column has no footer cell: the first one covers it too.
                  const leadsSelect = index === 0 && selectable
                  const total = c.total ? c.total(visible) : null
                  return (
                    <td
                      key={c.key}
                      colSpan={(spans ? labelSpan : 1) + (leadsSelect ? 1 : 0) || undefined}
                      style={leadsSelect ? { left: 0 } : pinStyle(c)}
                      className={join(
                        TFOOT_CELL,
                        pinClasses(c, 'z-10'),
                        spans && labelSpan === pinnedLeft.size && PINNED_EDGE,
                        alignClass(c)
                      )}
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
