import { Search, type LucideIcon } from 'lucide-react'
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react'

import { buildCsvContent, downloadCsv } from '../../../utils/csvExport'
import { SortableColumnHeader } from '../../ui/SortableColumnHeader'
import { Tooltip } from '../../ui/Tooltip'
import { AidCsvButton } from './CsvButton'
import { DefRef } from './DefinitionNotes'
import { CS_BOUNDED, CS_TOOLBAR, CS_TOOLBAR_LEFT, CS_TOOLBAR_RIGHT } from './csType'
import { AidSegmented } from './Segmented'
import {
  AID_SEARCH_INPUT,
  CELL_BG,
  CS_BAND,
  CS_BAND_WARN,
  DETAIL_LINE,
  DETAIL_ROW,
  EDITOR_ROW,
  GROUP_ROW,
  HELP_HEADER,
  HIGHLIGHT_EDGE,
  HIGHLIGHT_PINNED_EDGE,
  PINNED_EDGE,
  RIGHT_PINNED_EDGE,
  ROW_HIGHLIGHT,
  SCROLL_BOX,
  TABLE,
  TABLE_CARD,
  TD,
  TFOOT_CELL,
  TFOOT_CELL_WRAP,
  TH,
  TOTAL_BUTTON,
  TOTAL_LINK,
} from './kitStyles'
import { csvCell, withLinkLine } from './csv'
import { isPageKey } from './keyboard'
import { moneyCsv } from './money'
import { Money } from './MoneyText'
import {
  fitColumnWidth,
  groupRows,
  matchesSearch,
  sortRows,
  stepHighlight,
  type CellValue,
  type FitContent,
  type RowGroup,
} from './table'
import { useAidTableUrl } from './useAidTableUrl'

/** The grid's search box; it lives in kitStyles so csType can alias it without importing this module. */
export { AID_SEARCH_INPUT } from './kitStyles'

export interface CellContext {
  readonly highlighted: boolean
  /** The search typed, so a cell can show D27's matched-id chip (`matchedId`, `IdChip`). */
  readonly query: string
}

/**
 * Handed to the editor, in the detail line or the row under (Ruling 2026-10-01 (plan review)):
 * while the editor holds focus the table's own ↑/↓ stand aside (`isPageKey`, and anywhere inside
 * `data-aid-editor`, so a focused Save or Cancel button never lets ↓ unmount the editor with
 * unsaved input; the row's next step drawn there, `data-aid-step`, is the table's again), so the
 * editor moves the highlight through these. `highlight` puts it on any row: owner ruling A
 * (2026-10-01) jumps back to a row whose save failed.
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
  /** Explains the header on hover and click (the `Tooltip`); such a header does not sort. */
  readonly help?: string | undefined
  /** The CSV's own header name, when it is fuller than the screen's. */
  readonly csvHeader?: string | undefined
  readonly width?: number | undefined
  readonly flex?: boolean | undefined
  readonly align?: 'left' | 'right' | undefined
  readonly pinned?: boolean | undefined
  /**
   * Frozen on the right edge (batch 4: Needs attention), over the columns scrolling under it. Put
   * it last; it is never also `pinned`.
   */
  readonly pinnedRight?: boolean | undefined
  /**
   * The width comes from the cells drawn, not `width`: the widest first element of this column's
   * rendered body cells (its chip), plus `pad`, never under `min`, re-measured every render, so it
   * follows the rows, the view, the search and the filters (batch 4, round 6's fitAttn).
   */
  readonly fitContent?: FitContent | undefined
  readonly value: (row: Row) => CellValue
  /**
   * The cell's native title (§13). A string cell titles itself with its own words; this gives a
   * short form its full ones ("S2" → "Session 2"), or a figure a title.
   */
  readonly title?: ((row: Row) => string | undefined) | undefined
  /** What a header click sorts on, when it isn't the value (Requested by sorts on the last name, T3). */
  readonly sortValue?: ((row: Row) => CellValue) | undefined
  readonly render?: ((row: Row, ctx: CellContext) => ReactNode) | undefined
  readonly csv?: ((row: Row) => string) | undefined
  readonly total?: ((rows: readonly Row[]) => number | null) | undefined
  /** The opening total's native title ("In CampMinder (net): open the lines behind it"). Needs `onOpenTotal`. */
  readonly totalTitle?: ((rows: readonly Row[]) => string | undefined) | undefined
  /**
   * A line drawn in this column's footer cell when it has no `total` (spec §12.2: Requests' "incl. $X
   * outside the budget" in the Requested by footer). Null draws nothing.
   */
  readonly footerNote?: ((rows: readonly Row[]) => ReactNode) | undefined
  /**
   * The footer cell's native title when the cell is not the label's (§10): a footnote that can be
   * cut carries its full words. Undefined draws none.
   */
  readonly footerTitle?: ((rows: readonly Row[]) => string | undefined) | undefined
  readonly searchable?: boolean | undefined
  /** A footnote mark beside the header (§12: 0.72em, the note's words as its title). */
  readonly mark?: { readonly n: number; readonly title?: string | undefined } | undefined
  /** False leaves the column out of the CSV download: an action column has nothing to export (M16). */
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
  /** Group ids in the order they run (`groupRows`); without it, groups run in first-row order. */
  readonly order?: readonly string[] | undefined
}

/**
 * What a group's section above its table is handed (`groupSections`): the group's heading, its matching
 * rows (never the kept row), whether it is folded, and the fold's toggle. `grouped` is false for the one
 * section of a flat table, which has nothing to fold.
 */
export interface AidGroupSection<Row> {
  readonly id: string
  readonly heading: string
  readonly grouped: boolean
  readonly rows: readonly Row[]
  readonly folded: boolean
  readonly toggle: () => void
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
  /** Finished CSV rows added after the table's own, in the same column order (csvColumns, then csvExtra). */
  readonly csvAppend?: ReadonlyArray<readonly string[]> | undefined
  readonly onOpenTotal?: ((columnKey: string, rows: readonly Row[]) => void) | undefined
  /** True: the totals that open their rows are switched off (the rows on screen are a stand-in for a read in flight). */
  readonly totalsDisabled?: boolean | undefined
  /**
   * An editor row under the highlighted one (D22), marked `data-aid-editor`. The Requests grid moved
   * its editor into `renderDetail` (owner fast-follow 10-03); money's To place (#2990) still uses it.
   */
  readonly renderBelowHighlighted?: ((row: Row, nav: AidRowNav) => ReactNode) | undefined
  /**
   * The opened row's detail line (batch 4, owner LOCKED grid-layout-options.html#or=i): a row
   * straight under the highlighted one, as wide as the box's visible width and stuck at its left,
   * so it wraps and stays put while the rows scroll sideways. Esc closes the row (with `arrowKeys`).
   * It gets the row moves too, for an editor drawn inside it (the Requests grid, owner fast-follow
   * 10-03, arrangement 3); mark that editor's element `data-aid-editor` so ↑/↓ stay its own, and
   * any control drawn inside it that is not the editor's (the row's next step) `data-aid-step`, so
   * Esc and ↑/↓ stay the table's there.
   */
  readonly renderDetail?: ((row: Row, nav: AidRowNav) => ReactNode) | undefined
  readonly arrowKeys?: boolean | undefined
  /** Controls the page puts at the head of the toolbar line (the Requests filters). */
  readonly toolbarLead?: ReactNode
  /**
   * Controls drawn right after the Flat / By … switch. The toolbar is one row that never wraps (§5):
   * left, lead · switch · these; right, status · search · `toolbarActions` · Download CSV (always last).
   */
  readonly toolbarAfterGrouping?: ReactNode
  /** The page's own actions (Record a Commitment…), drawn after the search and before Download CSV. */
  readonly toolbarActions?: ReactNode
  /**
   * One control after Download CSV: the Ledger's lines card draws Close there (★13: "search, Download
   * CSV and Close on that same row"). Download CSV is last everywhere else.
   */
  readonly toolbarEnd?: ReactNode
  /**
   * Controls between the status and the search (Requests' checked-rows bar: Check Accepted… and
   * Clear, kit CF.bar's `acts` before `CF.search`). Everything else keeps §5's order.
   */
  readonly toolbarBeforeSearch?: ReactNode
  /** The search box's width in px; the default is the kit's 256. A crowded row narrows it (§5). */
  readonly searchWidth?: number | undefined
  /** True: every header stays on one line (§8), for a table whose columns are sized to its headers. */
  readonly nowrapHeaders?: boolean | undefined
  /**
   * Extra items for Download CSV's menu (slice 3 rework R1: the March file). When set, Download CSV becomes
   * a split button: the main part downloads as ever, the caret opens a menu holding Download CSV (hint "This
   * list, as filtered"), a rule, then these. Esc and an outside click close it; a click inside closes it.
   */
  readonly csvMenu?: ReactNode
  /** True: no toolbar at all (no search, switch or Download CSV), for a table whose page owns them. Default false. */
  readonly hideToolbar?: boolean | undefined
  /** True: the toolbar keeps its switch and Download CSV but draws no search box (a table with no names or ids). */
  readonly hideSearch?: boolean | undefined
  /** Runs when the CSV is downloaded, before the file is built (a page clearing a status line that is now stale). */
  readonly onCsvDownload?: (() => void) | undefined
  /** The result of the last action (the March file's), in the toolbar's right group before Download CSV (§5, §6). */
  readonly toolbarStatus?: ReactNode
  /** The search box's words and icon; the defaults are the kit's ("Search names or CM IDs", a magnifier). */
  readonly searchPlaceholder?: string | undefined
  readonly searchIcon?: LucideIcon | undefined
  /**
   * A controlled highlight (slice 1): pass both. Every change (a row click, ↑/↓, the editor's
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
  /**
   * The keys of the rows the search matches (never the kept row), fired when they change. The table
   * owns the search, so this is how a page learns which ticks the search hides (ticks persist across
   * searches; owner ruling 2026-10-02). Stable (useCallback or a state setter).
   */
  readonly onMatchingChange?: ((keys: ReadonlySet<string>) => void) | undefined
  readonly footerLabel?: ((rows: readonly Row[]) => ReactNode) | undefined
  /** The footer label's native title: it truncates (§10), so the full words live here. */
  readonly footerTitle?: ((rows: readonly Row[]) => string) | undefined
  /** How many columns the footer label spans; the default is the leading pinned columns with no total. */
  readonly footerSpan?: number | undefined
  readonly groupCount?: ((rows: readonly Row[]) => ReactNode) | undefined
  /** Words for an empty table; a function gets whether a search is active (typed) to pick between them. */
  readonly emptyText?: string | ((searching: boolean) => string) | undefined
  /**
   * Opt-in (grid layout T1, Scroll b): the table sits in one box that scrolls both ways, as tall as
   * the screen leaves room for, with the header and totals held, so the horizontal scrollbar is
   * always on screen. Off, the table renders as it always did.
   */
  readonly scrollBox?: boolean | undefined
  /**
   * A bounded card (§23): 420px tall at most, scrolling inside, in the page's flow and never sized
   * to the window, with the header and totals held. `scrollBox` wins when both are set.
   */
  readonly bounded?: boolean | undefined
  /**
   * A save-first way out (the Requests page's walk `leave`): folding the group that holds the
   * highlighted row goes through it, and folds only when it calls `go`, so a draft that can't be
   * saved yet, a save still out or a failure keeps the group open with the editor and its problem.
   * Without it the fold just asks `onHighlight` to drop the highlight.
   */
  readonly onLeave?: ((go: () => void) => void) | undefined
  /** Folds belong to this (the Requests grid's lens and view): a change clears them all. */
  readonly foldScope?: string | undefined
  /**
   * Draws a row as a group header inside a flat list (Money › Funders): a tinted, bold, ruled row
   * whose cells carry no background of their own, so text in one cell may run across the empty
   * cells beside it. `'warn'` is the same row in an amber tint. The row stays a row: it highlights,
   * opens and exports like any other.
   */
  readonly rowTone?: ((row: Row) => 'group' | 'warn' | undefined) | undefined
  /** False: the headers do not sort and any sort in the URL is ignored. Default true. */
  readonly sortable?: boolean | undefined
  /**
   * Opt-in (Money › To place, design-language §16, §19): each group is its own section and its own
   * table, as the approved mock draws it, instead of one table with group rows. The callback draws what
   * sits above a group's table (its heading, callout and actions); a folded group keeps its section and
   * loses its table; a group the search empties draws nothing. The search, the checks (a header box
   * checks its own group), ↑/↓ and the CSV stay the one table's. A flat table is one section.
   */
  readonly groupSections?: ((section: AidGroupSection<Row>) => ReactNode) | undefined
  /**
   * A search the page holds itself, so a second table on the page answers the same box: pass both to the
   * table that draws the box, only `query` to one with `hideToolbar`. Without them the table keeps its own.
   */
  readonly query?: string | undefined
  readonly onQueryChange?: ((query: string) => void) | undefined
}

/** The box stops this far short of the screen's bottom (§23: the first footnote peeks above the fold). */
const BOX_GAP = 40
const BOX_MIN_HEIGHT = 420

/** A column with a `total` is money: its value is a number, or nothing there. */
const moneyValue = (value: CellValue): number | null => (typeof value === 'number' ? value : null)

const NO_GROUPINGS: readonly never[] = []
/** A `rowTone` row's tint (§9), opaque in both themes (the row carries it; a pinned cell repeats it). */
const TONE_BG = { group: CS_BAND, warn: CS_BAND_WARN } as const
/** A group row's cell: unclipped, so a heading's words may run across the empty cells beside it. */
const TONE_TD = 'border-border border-t border-b px-2 py-[5px] align-top font-semibold'
const FLEX_MIN = 250
/** The selection's checkbox column (§4.10). */
const SELECT_WIDTH = 32

const join = (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' ')

/**
 * The finance kit's table (§4.3; D18, D20, D24, D25, D28, D29, D31; round7.html): sortable by
 * every column and searchable (names and CampMinder ids), sort and grouping in the URL,
 * identity columns pinned while the money scrolls under them, one flexible column, a footer of
 * totals that each open their rows, a highlighted row (click, or ↑/↓) with its detail line (and
 * the editor in it) or an editor row under it, and "Download CSV" of exactly what is on screen.
 * It renders rows it was given (D21).
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
  csvAppend,
  onOpenTotal,
  totalsDisabled = false,
  renderBelowHighlighted,
  renderDetail,
  arrowKeys = false,
  toolbarLead,
  toolbarAfterGrouping,
  toolbarActions,
  toolbarEnd,
  toolbarBeforeSearch,
  searchWidth,
  nowrapHeaders = false,
  csvMenu,
  toolbarStatus,
  hideToolbar = false,
  hideSearch = false,
  onCsvDownload,
  searchPlaceholder = 'Search names or CM IDs',
  searchIcon: SearchIcon = Search,
  highlighted: highlightedProp,
  onHighlight,
  footerLabel,
  footerTitle,
  footerSpan,
  markedKeys,
  selected,
  onSelectedChange,
  onMatchingChange,
  groupCount,
  emptyText = 'No rows match.',
  scrollBox = false,
  bounded = false,
  onLeave,
  foldScope,
  rowTone,
  sortable = true,
  groupSections,
  query: queryProp,
  onQueryChange,
}: AidTableProps<Row>) {
  const columnKeys = useMemo(() => columns.map((c) => c.key), [columns])
  const groupingKeys = useMemo(() => groupings.map((g) => g.key), [groupings])
  const { sort, group, toggleSort, setGroup } = useAidTableUrl(
    columnKeys,
    groupingKeys,
    urlPrefix,
    defaultGrouping
  )
  const [ownQuery, setOwnQuery] = useState('')
  const query = queryProp ?? ownQuery
  const setQuery = useCallback(
    (next: string) => {
      setOwnQuery(next)
      onQueryChange?.(next)
    },
    [onQueryChange]
  )
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
  const matchesQuery = useCallback(
    (row: Row, text: string) =>
      matchesSearch([...searchable.map((c) => c.value(row)), ...(searchExtra?.(row) ?? [])], text),
    [searchable, searchExtra]
  )
  const matches = useCallback((row: Row) => matchesQuery(row, query), [matchesQuery, query])
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
      const column = sortable && sort ? columns.find((c) => c.key === sort.key) : undefined
      return column && sort ? sortRows(list, column.sortValue ?? column.value, sort.dir) : [...list]
    },
    [columns, sort, sortable]
  )
  // The rows matching the search: what the totals, the counts and the CSV are of.
  const visible = useMemo(() => sorted(rows.filter(matches)), [rows, matches, sorted])
  // Their keys, for the page: independent of the sort, so only a change of match fires the callback.
  const matchingKeys = useMemo(
    () => new Set(rows.filter(matches).map(rowKey)),
    [rows, matches, rowKey]
  )
  useEffect(() => {
    onMatchingChange?.(matchingKeys)
  }, [matchingKeys, onMatchingChange])
  // What is drawn: those, plus the kept row.
  const shown = useMemo(
    () =>
      kept === null ? visible : sorted(rows.filter((row) => rowKey(row) === kept || matches(row))),
    [kept, visible, rows, rowKey, matches, sorted]
  )

  const grouping = groupings.find((g) => g.key === group)
  const groups: Array<RowGroup<Row>> = useMemo(
    () =>
      grouping
        ? groupRows(shown, grouping.groupOf, grouping.order)
        : [{ id: '', heading: '', rows: [...shown] }],
    [shown, grouping]
  )
  // Folded group ids (owner rulings 10-04 late (grid follow-up)): component state, so a fold lasts
  // the visit and never reaches the URL. Display only: the footer, the group counts and the CSV
  // still count a folded group's rows; ↑/↓, the editor's next / previous and Select all skip them.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  // A new scope (another lens or view) starts with every group open (lead ruling, scan of #3005);
  // Flat / By reason inside one view keeps them. Adjusted while rendering, so nothing draws stale.
  const [scopeSeen, setScopeSeen] = useState(foldScope)
  if (scopeSeen !== foldScope) {
    setScopeSeen(foldScope)
    setFolded(new Set())
  }
  // The highlighted row is always drawn: a highlight that lands in a folded group (a failed save
  // jumping back, a ?row= link, a save that regrouped the row, a refused leave) opens it for good.
  const highlightedGroup = useMemo(
    () =>
      grouping === undefined || highlighted === null
        ? undefined
        : groups.find((g) => g.rows.some((row) => rowKey(row) === highlighted))?.id,
    [grouping, highlighted, groups, rowKey]
  )
  if (highlightedGroup !== undefined && folded.has(highlightedGroup)) {
    const next = new Set(folded)
    next.delete(highlightedGroup)
    setFolded(next)
  }
  const isFolded = useCallback(
    (g: RowGroup<Row>) => grouping !== undefined && folded.has(g.id) && g.id !== highlightedGroup,
    [grouping, folded, highlightedGroup]
  )
  const ordered = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  // The rows on screen, in screen order: what ↑/↓ walk and Select all takes.
  const unfolded = useMemo(
    () => groups.flatMap((g) => (isFolded(g) ? [] : g.rows)),
    [groups, isFolded]
  )
  const order = useMemo(() => unfolded.map(rowKey), [unfolded, rowKey])
  // Without the kept row: a group's count and the CSV are of matching rows only.
  const counted = (list: readonly Row[]) =>
    kept === null ? list : list.filter((row) => rowKey(row) !== kept)

  const selection =
    selected !== undefined && onSelectedChange !== undefined
      ? { selected, onChange: onSelectedChange }
      : null
  const selectable = selection !== null
  const span = columns.length + (selectable ? 1 : 0)
  // The rows the search matches, without the kept row (`counted`) and outside any folded group (a
  // row you cannot see is never ticked by Select all): what Select all takes.
  const selectableKeys = counted(unfolded).map(rowKey)
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
  const toggleFold = (g: RowGroup<Row>) => {
    if (folded.has(g.id)) {
      setFolded((now) => {
        const next = new Set(now)
        next.delete(g.id)
        return next
      })
      return
    }
    const fold = () =>
      setFolded((now) => {
        const next = new Set(now)
        next.add(g.id)
        return next
      })
    if (g.id !== highlightedGroup) {
      fold()
      return
    }
    // Folding the row you are on closes it first: nothing is left on screen to hold its detail
    // line. A surface that refuses (an unsaveable draft) keeps the highlight, so the group's
    // highlighted row reopens it (highlightedGroup) before anything is drawn.
    const closeThenFold = () => {
      setHighlight(null)
      fold()
    }
    if (onLeave) onLeave(closeThenFold)
    else closeThenFold()
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
      const escape = event.key === 'Escape'
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && !escape) return
      // Not while a field (the search box, the editor) owns the key, a modifier is held, a modal is
      // open, or the key was already handled, held down or part of an IME composition (isPageKey).
      // Nor while focus is anywhere in the editor (a Save button is not a typing target), except on
      // a control drawn there that is not the editor's own, the row's next step (scan K1, #3000).
      if (
        event.target instanceof Element &&
        event.target.closest('[data-aid-editor]') !== null &&
        event.target.closest('[data-aid-step]') === null
      )
        return
      if (!isPageKey(event)) return
      // Esc closes the opened row (batch 4); an open tooltip or modal takes it first (isPageKey).
      if (escape) {
        if (highlighted !== null) setHighlight(null)
        return
      }
      if (order.length === 0) return
      event.preventDefault()
      setHighlight(stepHighlight(order, highlighted, event.key === 'ArrowDown' ? 1 : -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [arrowKeys, order, highlighted, setHighlight])

  // The screen box: its height is what the screen leaves under its own top, measured on mount, on
  // resize and when anything above it changes height; the held header and totals' heights become
  // the rows' scroll margin, so a row moved into view is never left under them.
  const boxRef = useRef<HTMLDivElement>(null)
  // A bounded card holds its header and totals too (§10, §23); only the screen box is sized to the window.
  const held = scrollBox || bounded

  const headRef = useRef<HTMLTableSectionElement>(null)
  const footRef = useRef<HTMLTableSectionElement>(null)
  const [margins, setMargins] = useState({ top: 0, bottom: 0 })
  const measure = useCallback(() => {
    const element = boxRef.current
    if (!held || element === null) return
    if (scrollBox) {
      const top = element.getBoundingClientRect().top + window.scrollY
      element.style.maxHeight = `${String(Math.max(BOX_MIN_HEIGHT, window.innerHeight - top - BOX_GAP))}px`
    }
    const next = {
      top: headRef.current?.getBoundingClientRect().height ?? 0,
      bottom: footRef.current?.getBoundingClientRect().height ?? 0,
    }
    setMargins((was) => (was.top === next.top && was.bottom === next.bottom ? was : next))
  }, [held, scrollBox])
  useLayoutEffect(() => {
    const element = boxRef.current
    if (!scrollBox || element === null) return
    window.addEventListener('resize', measure)
    // Whatever sits above the box (the views row, the filters, this table's own toolbar) moves it
    // when it changes height.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (observer) {
      for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        for (let above = node.previousElementSibling; above; above = above.previousElementSibling)
          observer.observe(above)
      }
    }
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
      element.style.maxHeight = ''
    }
  }, [scrollBox, measure])
  // Every render measures too: a note inserted above the box (a view change re-renders this table)
  // resizes no element the observer was handed, and the setState above is a no-op when unchanged.
  useLayoutEffect(measure)

  // Widths taken from what is drawn (batch 4): each fitted column from its rendered chips, and the
  // box's visible width for the detail line. Every render (the rows, view, search or filters may
  // have changed what is drawn) and on resize; each setState is a no-op when nothing moved.
  const [fitWidths, setFitWidths] = useState<Readonly<Record<string, number>>>({})
  const [boxWidth, setBoxWidth] = useState(0)
  const measureWidths = useCallback(() => {
    const element = boxRef.current
    if (element === null) return
    setBoxWidth(element.clientWidth)
    const next: Record<string, number> = {}
    for (const column of columns) {
      if (!column.fitContent) continue
      const chips = [...element.querySelectorAll(`td[data-fit-col="${column.key}"]`)]
        .map((cell) => cell.firstElementChild)
        .filter((chip): chip is Element => chip !== null)
        // A one-line chip truncates inside its column (§11), so its drawn width is capped by the
        // column being fitted; its natural width is the scroll width, or the column would creep.
        .map((chip) => Math.max(chip.getBoundingClientRect().width, chip.scrollWidth))
      next[column.key] = fitColumnWidth(chips, column.fitContent)
    }
    setFitWidths((was) => {
      const keys = Object.keys(next)
      const same =
        keys.length === Object.keys(was).length && keys.every((key) => was[key] === next[key])
      return same ? was : next
    })
  }, [columns])
  useLayoutEffect(measureWidths)
  useEffect(() => {
    window.addEventListener('resize', measureWidths)
    return () => window.removeEventListener('resize', measureWidths)
  }, [measureWidths])
  const widthOf = (column: AidColumn<Row>) =>
    column.fitContent ? (fitWidths[column.key] ?? column.fitContent.min) : column.width

  // The opened row comes into view with its detail line under it (batch 4): the line first, then
  // the row, so a row taller than the room left still shows its top. Again once the held header and
  // totals are measured, so a row restored from the URL is not left under them.
  const detailRef = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    if (highlighted === null) return
    detailRef.current?.scrollIntoView({ block: 'nearest' })
    rowRefs.current.get(highlighted)?.scrollIntoView({ block: 'nearest' })
  }, [highlighted, margins])

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
  // A flexible column with a width of its own never gets narrower than it (the Requests grid's
  // Requested by, which takes the spare width now Needs attention is fitted: batch 4, T3).
  const minWidth =
    columns.reduce((sum, c) => sum + (c.flex ? (c.width ?? FLEX_MIN) : (widthOf(c) ?? 0)), 0) +
    (selectable ? SELECT_WIDTH : 0)
  const isPinned = (column: AidColumn<Row>) =>
    pinnedLeft.has(column.key) || column.pinnedRight === true
  const edgeOf = (column: AidColumn<Row>) =>
    column.key === lastPinned ? PINNED_EDGE : column.pinnedRight ? RIGHT_PINNED_EDGE : undefined

  const pinStyle = (column: AidColumn<Row>): CSSProperties | undefined =>
    pinnedLeft.has(column.key)
      ? { left: pinnedLeft.get(column.key) }
      : column.pinnedRight
        ? { right: 0 }
        : undefined
  const pinClasses = (column: AidColumn<Row>, layer: string) =>
    join(isPinned(column) && `sticky ${layer}`, edgeOf(column))
  // In the screen box the header and totals are held on both axes: every cell sticks, and a pinned
  // one sits a layer above the rest (and above the pinned body cells), so nothing scrolls over it.
  const heldClasses = (column: AidColumn<Row>, side: 'top-0' | 'bottom-0', fallback: string) =>
    held
      ? join('sticky', side, isPinned(column) ? 'z-40' : 'z-30', edgeOf(column))
      : pinClasses(column, fallback)
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
    if (column.pinnedRight) return RIGHT_PINNED_EDGE
    return highlightEdge ? HIGHLIGHT_EDGE : pinnedEdge ? PINNED_EDGE : ''
  }
  const scrollMargins: CSSProperties | undefined = held
    ? { scrollMarginTop: margins.top, scrollMarginBottom: margins.bottom }
    : undefined
  // §8: a table can ask for headers on one line; TH wraps, so its wrap word is swapped, not stacked.
  const thClass = nowrapHeaders ? TH.replace('whitespace-normal', 'whitespace-nowrap') : TH
  const markOf = (column: AidColumn<Row>) =>
    column.mark ? <DefRef n={column.mark.n} title={column.mark.title} /> : null
  const alignClass = (column: AidColumn<Row>) =>
    column.align === 'right' ? 'text-right tabular-nums' : ''

  const download = () => {
    onCsvDownload?.()
    const csvColumns = columns.filter((c) => c.inCsv !== false)
    const extra = csvExtra ?? []
    // counted(): the kept row (shown only because it is highlighted) stays out of the file.
    const data: string[][] = counted(ordered).map((row) => [
      ...csvColumns.map((c) =>
        c.csv ? c.csv(row) : c.total ? moneyCsv(moneyValue(c.value(row))) : csvCell(c.value(row))
      ),
      ...extra.map((e) => e.value(row)),
    ])
    downloadCsv(
      buildCsvContent(
        [...csvColumns.map((c) => c.csvHeader ?? c.header), ...extra.map((e) => e.header)],
        withLinkLine([...data, ...(csvAppend ?? []).map((r) => [...r])], window.location.href)
      ),
      csvFilename
    )
  }

  const hasTotals = columns.some((c) => c.total)
  const labelSpan = (() => {
    // A caller's span stops before the first column with a total, so no total is swallowed.
    if (footerSpan !== undefined) {
      const firstTotal = columns.findIndex((c) => c.total)
      return Math.max(1, firstTotal < 0 ? footerSpan : Math.min(footerSpan, firstTotal))
    }
    if (!footerLabel) return 1
    let span = 0
    for (const c of columns) {
      if (!pinnedLeft.has(c.key) || c.total) break
      span += 1
    }
    return Math.max(span, 1)
  })()

  // Flat is always a choice, so one grouping is enough for a switch (owner ruling G1).
  const groupingSwitch =
    groupings.length > 0 ? (
      <AidSegmented
        label="Grouping"
        value={group ?? ''}
        options={[
          { value: '', label: 'Flat' },
          ...groupings.map((g) => ({ value: g.key, label: g.label })),
        ]}
        onChange={(key) => setGroup(key === '' ? null : key)}
      />
    ) : null

  const colgroup = (
    <colgroup>
      {selectable && <col style={{ width: SELECT_WIDTH }} />}
      {columns.map((c) => (
        <col key={c.key} style={c.flex ? undefined : { width: widthOf(c) }} />
      ))}
    </colgroup>
  )

  // The header row: its select-all box checks what `box` says (the whole table, or one section).
  const renderHead = (
    box: { readonly all: boolean; readonly toggle: () => void },
    ref?: Ref<HTMLTableSectionElement>
  ) => (
    <thead ref={ref}>
      <tr>
        {selection && (
          <th
            className={join(
              thClass,
              // Held top and left in the screen box, a layer above the scrolling headers.
              held ? 'sticky top-0 left-0 z-40' : 'sticky left-0 z-20'
            )}
          >
            <input
              type="checkbox"
              aria-label="Select all"
              checked={box.all}
              onChange={box.toggle}
            />
          </th>
        )}
        {columns.map((c) =>
          c.help || !sortable ? (
            <th
              key={c.key}
              style={pinStyle(c)}
              className={join(thClass, heldClasses(c, 'top-0', 'z-20'))}
            >
              {c.help ? (
                <Tooltip content={c.help} className={HELP_HEADER}>
                  {c.header}
                </Tooltip>
              ) : (
                c.header
              )}
              {markOf(c)}
            </th>
          ) : (
            <SortableColumnHeader
              key={c.key}
              label={c.header}
              direction={
                sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null
              }
              onSort={() => toggleSort(c.key)}
              style={pinStyle(c)}
              className={join(thClass, heldClasses(c, 'top-0', 'z-20'))}
              {...(c.mark
                ? {
                    indicator: (
                      <>
                        {markOf(c)}
                        {sort?.key === c.key ? (
                          <span className="ml-1">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                        ) : null}
                      </>
                    ),
                  }
                : {})}
              {...(c.align === 'right' || c.mark
                ? {
                    // A marked label sits on the baseline with no gap, so the mark reads "Decided¹" (§12);
                    // in a centred flex row vertical-align is ignored and the mark floated high and apart.
                    buttonClassName: join(
                      c.align === 'right' ? 'justify-end' : '',
                      c.mark ? 'items-baseline! gap-0!' : ''
                    ),
                  }
                : {})}
            />
          )
        )}
      </tr>
    </thead>
  )

  // The rows of one group (or the flat table): each with its detail line and editor row.
  const bodyRows = (list: readonly Row[]) =>
    list.map((row) => {
      const key = rowKey(row)
      const isHighlighted = key === highlighted
      const isMarked = markedKeys?.has(key) === true
      const tone = rowTone?.(row)
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
            data-row-tone={tone}
            className={join(
              'cursor-pointer',
              tone && (isHighlighted ? ROW_HIGHLIGHT : TONE_BG[tone])
            )}
            style={scrollMargins}
          >
            {selection && (
              <td
                // A tick is not a click on the row, and nor is the cell around the box:
                // no highlight, so no save-then-move.
                onClick={(event) => event.stopPropagation()}
                className={join(
                  TD,
                  isHighlighted ? ROW_HIGHLIGHT : CELL_BG,
                  'sticky left-0 z-10 whitespace-nowrap',
                  (isHighlighted || isMarked) && HIGHLIGHT_EDGE
                )}
              >
                {/* The kept row is on screen only for its highlight: it isn't a match, so it can't be ticked (R1). */}
                {key !== kept && (
                  <input
                    type="checkbox"
                    aria-label="Select"
                    checked={selection.selected.has(key)}
                    onChange={() => toggleOne(key)}
                  />
                )}
              </td>
            )}
            {columns.map((c, index) => {
              const value = c.render ? undefined : c.value(row)
              const content = c.render ? (
                c.render(row, { highlighted: isHighlighted, query })
              ) : c.total && typeof value === 'number' ? (
                <Money value={moneyValue(value)} />
              ) : (
                value
              )
              // §13: a cut cell carries its full words; a string titles itself (a
              // placeholder dash has nothing to add).
              const title = c.title
                ? c.title(row)
                : typeof content === 'string' && content !== '' && content !== '—'
                  ? content
                  : undefined
              return (
                <td
                  key={c.key}
                  title={title}
                  style={pinStyle(c)}
                  data-fit-col={c.fitContent ? c.key : undefined}
                  className={join(
                    tone ? TONE_TD : TD,
                    // A tone row's tint is on the row; only a pinned cell needs its own.
                    tone
                      ? isPinned(c) && (isHighlighted ? ROW_HIGHLIGHT : TONE_BG[tone])
                      : isHighlighted
                        ? ROW_HIGHLIGHT
                        : CELL_BG,
                    bodyEdge(c, index, isHighlighted, isMarked),
                    isPinned(c) && 'sticky z-10',
                    alignClass(c),
                    c.flex === true && isHighlighted ? 'whitespace-normal' : 'whitespace-nowrap'
                  )}
                >
                  {content ?? '—'}
                </td>
              )
            })}
          </tr>
          {isHighlighted && renderDetail && (
            <tr data-aid-detail="" ref={detailRef} style={scrollMargins}>
              {/* The cell must not clip, or the sticky line is trapped inside it (round 6). */}
              <td colSpan={span} className={DETAIL_ROW}>
                <div className={DETAIL_LINE} style={boxWidth > 0 ? { width: boxWidth } : undefined}>
                  {renderDetail(row, nav)}
                </div>
              </td>
            </tr>
          )}
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
    })

  // Money › To place's sections: each group a heading and its own table (`groupSections`).
  const cardClass = scrollBox ? SCROLL_BOX : bounded ? CS_BOUNDED : TABLE_CARD
  const sectionMode = groupSections !== undefined && shown.length > 0
  const sectionNodes =
    groupSections !== undefined && sectionMode
      ? groups
          .filter((g) => g.rows.length > 0)
          .map((g) => {
            const folded = isFolded(g)
            const keys = counted(g.rows).map(rowKey)
            const all =
              selection !== null &&
              keys.length > 0 &&
              keys.every((key) => selection.selected.has(key))
            const toggleGroup = () => {
              if (selection === null) return
              const next = new Set(selection.selected)
              for (const key of keys) {
                if (all) next.delete(key)
                else next.add(key)
              }
              selection.onChange(next)
            }
            return (
              <div key={g.id || 'all'} data-aid-section={g.id} className="space-y-1.5">
                {groupSections({
                  id: g.id,
                  heading: g.heading,
                  grouped: grouping !== undefined,
                  rows: counted(g.rows),
                  folded,
                  toggle: () => toggleFold(g),
                })}
                {!folded && (
                  <div className={cardClass}>
                    <table className={TABLE} style={{ minWidth }}>
                      {colgroup}
                      {renderHead({ all, toggle: toggleGroup })}
                      <tbody>{bodyRows(g.rows)}</tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })
      : null

  return (
    <div className="space-y-2">
      {!hideToolbar && (
        <div data-aid-toolbar="" className={CS_TOOLBAR}>
          <div className={CS_TOOLBAR_LEFT}>
            {toolbarLead}
            {groupingSwitch}
            {toolbarAfterGrouping}
          </div>
          <div className={CS_TOOLBAR_RIGHT}>
            {toolbarStatus !== undefined && (
              // The one part of the row that may shrink: it clips rather than push search and CSV off.
              <div className="max-w-[340px] min-w-0 overflow-hidden">{toolbarStatus}</div>
            )}
            {toolbarBeforeSearch}
            {!hideSearch && (
              <div
                className={
                  searchWidth === undefined ? 'relative w-64 flex-none' : 'relative flex-none'
                }
                style={searchWidth === undefined ? undefined : { width: searchWidth }}
              >
                <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2" />
                <input
                  type="search"
                  aria-label="Search"
                  placeholder={searchPlaceholder}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className={AID_SEARCH_INPUT}
                />
              </div>
            )}
            {toolbarActions}
            <AidCsvButton onDownload={download} menu={csvMenu} />
            {toolbarEnd}
          </div>
        </div>
      )}

      {sectionMode ? (
        // One measured box around every section (scan #3117 B): a ref on each card left it null once
        // the last section folded, and the widths stopped following the window.
        <div ref={boxRef} className="space-y-2">
          {sectionNodes}
        </div>
      ) : (
        <div ref={boxRef} data-aid-scroll-box={scrollBox ? '' : undefined} className={cardClass}>
          <table className={TABLE} style={{ minWidth }}>
            {colgroup}
            {renderHead({ all: allSelected, toggle: toggleAll }, headRef)}
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td
                    colSpan={span}
                    className={join(TD, CELL_BG, 'text-muted-foreground whitespace-nowrap')}
                  >
                    {typeof emptyText === 'function' ? emptyText(query.trim() !== '') : emptyText}
                  </td>
                </tr>
              )}
              {groups.map((g) => (
                <Fragment key={g.id || 'all'}>
                  {grouping && g.rows.length > 0 && (
                    <tr>
                      <td colSpan={span} className={GROUP_ROW} data-group-heading="">
                        {/* The heading folds its group (owner rulings 10-04 late); the count stays. */}
                        <button
                          type="button"
                          className="sticky left-2 cursor-pointer"
                          onClick={() => toggleFold(g)}
                        >
                          <span className="mr-1.5 inline-block w-3">{isFolded(g) ? '▸' : '▾'}</span>
                          <span>{g.heading}</span>
                        </button>
                        {groupCount ? (
                          <span className="ml-2 font-normal">{groupCount(counted(g.rows))}</span>
                        ) : null}
                      </td>
                    </tr>
                  )}
                  {bodyRows(isFolded(g) ? [] : g.rows)}
                </Fragment>
              ))}
            </tbody>
            {hasTotals && (
              <tfoot ref={footRef}>
                <tr>
                  {columns.map((c, index) => {
                    // The footer label spans the leading pinned columns that carry no total, so the
                    // sticky cell after it can't paint over it (I1).
                    if (index > 0 && index < labelSpan) return null
                    const spans = index === 0 && labelSpan > 1
                    // The checkbox column has no footer cell: the first one covers it too.
                    const leadsSelect = index === 0 && selectable
                    const cellSpan = (spans ? labelSpan : 1) + (leadsSelect ? 1 : 0)
                    const total = c.total ? c.total(visible) : null
                    return (
                      <td
                        key={c.key}
                        colSpan={cellSpan > 1 ? cellSpan : undefined}
                        title={
                          index === 0 && footerTitle
                            ? footerTitle(visible)
                            : (c.footerTitle?.(visible) ?? undefined)
                        }
                        style={leadsSelect ? { left: 0 } : pinStyle(c)}
                        className={join(
                          held && index === 0 && footerLabel && !footerTitle
                            ? TFOOT_CELL_WRAP
                            : TFOOT_CELL,
                          // §10: a titled label flows out of its column and truncates.
                          index === 0 && footerTitle && 'truncate',
                          // A footnote in its own cell (the outside note) is one line too.
                          !c.total && c.footerNote && 'truncate',
                          heldClasses(c, 'bottom-0', 'z-10'),
                          spans && labelSpan === pinnedLeft.size && PINNED_EDGE,
                          alignClass(c)
                        )}
                      >
                        {index === 0 && footerLabel ? footerLabel(visible) : null}
                        {!c.total && c.footerNote ? c.footerNote(visible) : null}
                        {c.total &&
                          (onOpenTotal ? (
                            <button
                              type="button"
                              className={c.totalTitle ? TOTAL_LINK : TOTAL_BUTTON}
                              title={c.totalTitle?.(visible)}
                              disabled={totalsDisabled}
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
      )}
    </div>
  )
}
