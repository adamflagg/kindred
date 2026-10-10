import { Home, ListFilter } from 'lucide-react'
import { useCallback, useMemo, type ReactNode } from 'react'

import type { ApiAidGridRow } from '../../../types/api-types'
import { AMBER_NOTE } from '../../admin/lodging/lodgingStyles'
import {
  AidTable,
  type AidColumn,
  type AidCsvExtra,
  type AidGrouping,
  type AidRowNav,
} from '../kit/AidTable'
import { formatShortDate } from '../kit/dates'
import { formatMoney, moneyCsv } from '../kit/money'
import { Money } from '../kit/MoneyText'
import { DefRef } from '../kit/DefinitionNotes'
import { NeedsAttentionCell } from '../kit/NeedsAttentionCell'
import { TICK_BUTTON } from '../kit/kitStyles'
import { IdChip, StatusPill } from '../kit/Pills'
import { matchedId, type CellValue } from '../kit/table'
import { attentionFor } from './attention'
import { camperLabel, camperTitle, householdLabelOf, sessionCell } from './cells'
import { HouseholdLink, type HouseholdLinks } from './HouseholdLink'
import {
  listOutside,
  outsideOfPosted,
  outsideOfRound,
  outsideOfTotal,
  outsideTagWords,
  type CellOutside,
} from './outside'
import { RequestDetailLine, type MarkPosted } from './RequestDetailLine'
import { requestStage, roundOf } from './stage'
import { acceptedTarget, type TickAction } from './ticks'
import {
  cmChip,
  countWords,
  footerWords,
  GRID_COLUMNS,
  moneyTotal,
  reasonGroup,
  reasonOrder,
  viewColumns,
  viewCount,
  columnContext,
  type ColumnContext,
  type GridColumnKey,
  type RequestView,
} from './views'

export type { HouseholdLinks } from './HouseholdLink'

/** A footnote mark: its number on the page (the registry's order) and the note's words for its title. */
export interface NoteMark {
  readonly n: number
  readonly title: string
}

interface RequestsGridProps {
  /** Already the view's rows (filterRows). */
  readonly rows: readonly ApiAidGridRow[]
  readonly view: RequestView
  readonly showIds: boolean
  /** The read's `ticked_season` (#2994): CM ✓ only exists in a season with Posted ticks. */
  readonly tickedSeason: boolean
  readonly today: string
  readonly csvFilename: string
  readonly highlighted: string | null
  /** Stable (useCallback or a state setter): AidTable's `nav` memo depends on it. */
  readonly onHighlight: (key: string | null) => void
  /** Stable (useMemo): the columns memo depends on it. */
  readonly links: HouseholdLinks
  /** The filter controls: they share the table's toolbar line with search and Download CSV. */
  readonly filters?: ReactNode
  /**
   * Controls after the Flat / By reason switch, which then sits right after `filters` (owner rulings
   * 10-04 late (grid follow-up): Program · Round · Flat / By reason · Show IDs · filter · CSV).
   */
  readonly filtersAfterGrouping?: ReactNode
  /** The registry's notes by key, so a marked header (Decided¹, Posted², CM ✓³, Cost⁴) can carry its number (§12). */
  readonly noteMarks?: Readonly<Record<string, NoteMark>> | undefined
  /** The outside note's mark, beside the footer's "incl. $X outside the budget" (§10, §12). */
  readonly outsideMark?: NoteMark | undefined
  /** Controls between the status and the search: Check Accepted… and Clear (§5). */
  readonly toolbarBeforeSearch?: ReactNode
  /** The search box's width: the page narrows it when the row is crowded (§5). */
  readonly searchWidth?: number | undefined
  /** Extra items in Download CSV's menu (the March file on Needs an offer, R1); sets the split button. */
  readonly csvMenu?: ReactNode
  /** The toolbar's one status slot (§5–6): a failed save, the checked count, a bulk result or the March File's. */
  readonly toolbarStatus?: ReactNode
  /** Passed to the table: runs when the CSV downloads. */
  readonly onCsvDownload?: (() => void) | undefined
  /** The page's save-first way out (the walk's `leave`): folding the opened row's group goes through it. */
  readonly onLeave?: ((go: () => void) => void) | undefined
  /** What a fold belongs to (the page's lens and view); a change opens every group. Default: the view. */
  readonly foldScope?: string | undefined
  /**
   * The opened row's editor: drawn inside the detail line, full width under its text (§24, owner
   * 10-09). The row's next step stays in the detail line.
   */
  readonly renderEditor?: ((row: ApiAidGridRow, nav: AidRowNav) => ReactNode) | undefined
  /** Rows whose save failed (Decision 3): marked in place. Stable (useMemo). */
  readonly marked?: ReadonlySet<string> | undefined
  readonly selected?: ReadonlySet<string> | undefined
  readonly onSelectedChange?: ((next: ReadonlySet<string>) => void) | undefined
  /** The rows the table's search matches, for the ticks it hides. Stable. */
  readonly onMatchingChange?: ((keys: ReadonlySet<string>) => void) | undefined
  /** `casework` only: a single tick opens the same confirmation as bulk (Decision 15). Stable. */
  readonly onTick?: ((row: ApiAidGridRow, action: TickAction) => void) | undefined
  /** `casework` only: the hand Posted tick on a Not reconciled row the server allows it on (#2996). Stable. */
  readonly onMarkPosted?: MarkPosted | undefined
}

const requestKey = (row: ApiAidGridRow) => row.request_id
/** Searched beside the shown names (D27; Q-L2): the family name, though no column shows it, and the ids. */
const searchExtra = (row: ApiAidGridRow) => [row.family_name, row.household_cm_id, row.person_cm_id]
const footer = (rows: readonly ApiAidGridRow[]) => footerWords(viewCount(rows))
const groupCount = (rows: readonly ApiAidGridRow[]) => countWords(viewCount(rows))
const asMoney = (value: CellValue) => (typeof value === 'number' ? value : null)
/** The amber "pending $450" drawn in R3, as its own CSV column (M16; §11). */
const R3_PENDING_CSV: ReadonlyArray<AidCsvExtra<ApiAidGridRow>> = [
  {
    header: 'R3 pending approval',
    value: (row) => moneyCsv(roundOf(row, 3)?.pending_approval ?? null),
  },
]

/** Every view's CSV carries the row's outside money across its rounds (spec §12.2, owner 10-07). */
const OUTSIDE_CSV: ReadonlyArray<AidCsvExtra<ApiAidGridRow>> = [
  {
    header: 'Outside the budget',
    value: (row) => moneyCsv(outsideOfTotal(row)?.amount ?? null),
  },
]
const CSV_EXTRA_WITH_R3: ReadonlyArray<AidCsvExtra<ApiAidGridRow>> = [
  ...OUTSIDE_CSV,
  ...R3_PENDING_CSV,
]

/** The muted second line under an amount: "outside" or "$1,224 outside" (spec §12.2, knob 1 a). */
function OutsideTag({ cell }: { cell: CellOutside | null }) {
  return cell ? (
    <span className="text-muted-foreground block text-xs whitespace-normal">
      {outsideTagWords(cell)}
    </span>
  ) : null
}

/** The money columns that carry the tag: R1, R2, R3, Total and Posted. */
const OUTSIDE_OF: Partial<Record<GridColumnKey, (row: ApiAidGridRow) => CellOutside | null>> = {
  r1: (row) => outsideOfRound(row, 1),
  r2: (row) => outsideOfRound(row, 2),
  r3: (row) => outsideOfRound(row, 3),
  total: outsideOfTotal,
  posted: outsideOfPosted,
}

const NAME_LINK = 'text-primary font-medium hover:underline'

const splitTitle = (payers: number) =>
  `Split between ${String(payers)} households: each posts its own amount. Open the household for each share.`

function renderFor(
  key: GridColumnKey,
  ctx: ColumnContext,
  links: HouseholdLinks,
  onTick: ((row: ApiAidGridRow, action: TickAction) => void) | undefined
): AidColumn<ApiAidGridRow>['render'] {
  switch (key) {
    case 'requestedBy':
      return (row, { query }) => {
        const matched = matchedId([row.household_cm_id, row.person_cm_id], query)
        // One line even on the highlighted row (batch 4: the opened row no longer grows tall), though
        // the kit wraps a flexible column there. No name, no link: the Camper opens the household too.
        // §6: the split chip sits beside the name (kit CF.nc), its sentence in its title.
        const payers = ctx.view === 'needs_offer' ? (row.payer_count ?? 1) : 1
        return (
          <div className="flex min-w-0 items-center gap-1.5">
            {row.requested_by ? (
              <HouseholdLink row={row} links={links} className={`${NAME_LINK} min-w-0 truncate`}>
                {row.requested_by}
              </HouseholdLink>
            ) : (
              '—'
            )}
            {payers >= 2 && (
              <span className="flex-none">
                <StatusPill
                  tone="sky"
                  title={splitTitle(payers)}
                >{`split · ${String(payers)}`}</StatusPill>
              </span>
            )}
            {matched !== null && (
              <span className="flex-none">
                <IdChip id={matched} />
              </span>
            )}
          </div>
        )
      }
    case 'camper':
      return (row) => {
        const household = householdLabelOf(row)
        if (household === null) {
          return (
            <HouseholdLink row={row} links={links} className={`${NAME_LINK} block truncate`}>
              {camperLabel(row)}
            </HouseholdLink>
          )
        }
        // §15: ⌂, the label as the usual name link, the tiebreak muted after it. Only the tiebreak
        // gives way when the cell is cut.
        return (
          <span className="flex min-w-0 items-center gap-1">
            <Home className="text-muted-foreground h-3 w-3 flex-none" />
            <HouseholdLink row={row} links={links} className={`${NAME_LINK} min-w-0 truncate`}>
              {household.text}
            </HouseholdLink>
            {household.tiebreak !== '' && (
              <span className="text-muted-foreground min-w-0 shrink-[999] truncate font-normal">
                {household.tiebreak}
              </span>
            )}
          </span>
        )
      }
    case 'session':
      // A truncating span, so AidTable can measure the name's natural width (ux3 requests-11).
      return (row) => (
        <span className="inline-block max-w-full truncate align-bottom">
          {sessionCell(row).text}
        </span>
      )
    case 'stage':
      return (row) => {
        const stage = requestStage(row)
        return stage ? (
          <StatusPill tone={stage.tone} title={stage.text}>
            {stage.text}
          </StatusPill>
        ) : (
          '—'
        )
      }
    case 'r3':
      return (row) => {
        const r3 = roundOf(row, 3)
        if (r3?.status === 'pending_approval') {
          return <span className={AMBER_NOTE}>pending {formatMoney(r3.pending_approval)}</span>
        }
        return (
          <>
            <Money value={r3?.decided ?? null} />
            <OutsideTag cell={outsideOfRound(row, 3)} />
          </>
        )
      }
    case 'cancelledOn':
      return (row) => (row.cancellation?.on ? formatShortDate(row.cancellation.on) : '—')
    case 'confirmed':
      return (row) => {
        const chip = cmChip(row)
        return chip ? <StatusPill tone={chip.tone}>{chip.word}</StatusPill> : '—'
      }
    case 'tick':
      return (row) => {
        if (onTick === undefined) return null
        return acceptedTarget(row) ? (
          <button
            type="button"
            className={TICK_BUTTON}
            onClick={(event) => {
              event.stopPropagation()
              onTick(row, 'accepted')
            }}
          >
            Accepted
          </button>
        ) : null
      }
    case 'attention':
      // The chip only (batch 4); the full text and the next step are in the detail line.
      return (row) => (
        <NeedsAttentionCell
          item={attentionFor(row, ctx.view, ctx.today, ctx.cancelledOnShown)?.item ?? null}
        />
      )
    default: {
      const spec = GRID_COLUMNS[key]
      if (!spec.money) return undefined
      const outsideOf = OUTSIDE_OF[key]
      return (row) => (
        <>
          <Money value={asMoney(spec.value(row, ctx))} />
          {outsideOf ? <OutsideTag cell={outsideOf(row)} /> : null}
        </>
      )
    }
  }
}

/**
 * "incl. $X outside the budget⁵" in the Requested by footer cell, only when the shown rows hold some
 * (spec §12.2, knob 2; §10: one line, the mark after it, the long form in the cell's title).
 */
function outsideFooterNote(rows: readonly ApiAidGridRow[], mark: NoteMark | undefined): ReactNode {
  const outside = listOutside(rows)
  return outside > 0 ? (
    <span className="text-muted-foreground block truncate font-normal">
      {`incl. ${formatMoney(outside)} outside the budget`}
      {mark ? <DefRef n={mark.n} title={mark.title} /> : null}
    </span>
  ) : null
}

const outsideFooterTitle = (rows: readonly ApiAidGridRow[]) => {
  const outside = listOutside(rows)
  return outside > 0
    ? `The totals include ${formatMoney(outside)} a named fund pays outside the budget; Rounds & budget doesn't count it.`
    : undefined
}

/** The cells that can be cut carry their full words as a native title (§13). */
const CELL_TITLE: Partial<Record<GridColumnKey, (row: ApiAidGridRow) => string | undefined>> = {
  camper: camperTitle,
  session: (row) => sessionCell(row).title,
  r3: (row) => {
    const r3 = roundOf(row, 3)
    return r3?.status === 'pending_approval'
      ? `Pending approval: ${formatMoney(r3.pending_approval)}, never summed until approved`
      : undefined
  },
  requestedBy: (row) =>
    row.requested_by
      ? `${row.requested_by}${(row.payer_count ?? 1) >= 2 ? ` · split between ${String(row.payer_count)} households` : ''}`
      : undefined,
}

function buildColumns(
  view: RequestView,
  showIds: boolean,
  tickedSeason: boolean,
  today: string,
  links: HouseholdLinks,
  onTick: ((row: ApiAidGridRow, action: TickAction) => void) | undefined,
  noteMarks: Readonly<Record<string, NoteMark>> | undefined,
  outsideMark: NoteMark | undefined
): Array<AidColumn<ApiAidGridRow>> {
  const ctx: ColumnContext = columnContext(view, today)
  return viewColumns(view, showIds, tickedSeason, onTick !== undefined).map((key) => {
    const spec = GRID_COLUMNS[key]
    return {
      key,
      header: spec.header,
      help: spec.help,
      csvHeader: spec.csvHeader,
      width: spec.width,
      align: spec.align,
      flex: spec.flex,
      pinned: spec.pinned,
      pinnedRight: spec.pinnedRight,
      fitContent: spec.fitContent,
      inCsv: spec.inCsv,
      csv: spec.csv ? (row: ApiAidGridRow) => spec.csv?.(row, ctx) ?? '' : undefined,
      searchable: key === 'requestedBy' || key === 'camper',
      value: (row: ApiAidGridRow) => spec.value(row, ctx),
      sortValue: spec.sortValue,
      render: renderFor(key, ctx, links, onTick),
      mark: spec.noteKey !== undefined ? noteMarks?.[spec.noteKey] : undefined,
      // A money cell is cut in a narrow column ($6,866.41 in 74px): its title is the full figure.
      title:
        CELL_TITLE[key] ??
        (spec.money
          ? (row: ApiAidGridRow) => {
              const value = asMoney(spec.value(row, ctx))
              return value === null ? undefined : formatMoney(value)
            }
          : undefined),
      footerNote:
        key === 'requestedBy'
          ? (rows: readonly ApiAidGridRow[]) => outsideFooterNote(rows, outsideMark)
          : undefined,
      footerTitle: key === 'requestedBy' ? outsideFooterTitle : undefined,
      total:
        spec.money && spec.noTotal !== true
          ? (rows: readonly ApiAidGridRow[]) => moneyTotal(rows.map((row) => spec.value(row, ctx)))
          : undefined,
    }
  })
}

/**
 * The Requests grid (§6.1; D23–D27, D29, D31; round7.html): one row per request, the view's own
 * columns, the names opening the family (Decision 1), and the needs-attention cell taking the spare
 * width. The server decided every row (D21); this draws them and decides which rows can take a
 * tick (`ticks.ts`), and the pieces that open the editor and the tick dialog.
 */
export function RequestsGrid({
  rows,
  view,
  showIds,
  tickedSeason,
  today,
  csvFilename,
  highlighted,
  onHighlight,
  links,
  filters,
  filtersAfterGrouping,
  noteMarks,
  outsideMark,
  toolbarBeforeSearch,
  searchWidth,
  csvMenu,
  toolbarStatus,
  onCsvDownload,
  onLeave,
  foldScope,
  renderEditor,
  marked,
  selected,
  onSelectedChange,
  onMatchingChange,
  onTick,
  onMarkPosted,
}: RequestsGridProps) {
  const columns = useMemo(
    () => buildColumns(view, showIds, tickedSeason, today, links, onTick, noteMarks, outsideMark),
    [view, showIds, tickedSeason, today, links, onTick, noteMarks, outsideMark]
  )
  const renderDetail = useCallback(
    (row: ApiAidGridRow, nav: AidRowNav) => (
      <RequestDetailLine
        row={row}
        ctx={columnContext(view, today)}
        links={links}
        showConfirmation={tickedSeason}
        onTick={onTick}
        onMarkPosted={onMarkPosted}
        editor={renderEditor ? () => renderEditor(row, nav) : undefined}
      />
    ),
    [view, today, links, tickedSeason, onTick, onMarkPosted, renderEditor]
  )
  const groupings = useMemo(
    (): Array<AidGrouping<ApiAidGridRow>> => [
      {
        key: 'reason',
        label: 'By reason',
        groupOf: reasonGroup(view, today),
        order: reasonOrder(view),
      },
    ],
    [view, today]
  )
  return (
    <AidTable<ApiAidGridRow>
      rows={rows}
      columns={columns}
      rowKey={requestKey}
      searchExtra={searchExtra}
      groupings={groupings}
      defaultGrouping={view.groupBy === null ? undefined : 'reason'}
      csvFilename={csvFilename}
      csvExtra={
        view.columns.includes('r3') || view.columns.includes('r3Ask')
          ? CSV_EXTRA_WITH_R3
          : OUTSIDE_CSV
      }
      toolbarLead={filters}
      toolbarAfterGrouping={filtersAfterGrouping}
      toolbarBeforeSearch={toolbarBeforeSearch}
      searchWidth={searchWidth}
      nowrapHeaders
      footerSpan={columns.findIndex((c) => c.key === 'session') + 1}
      footerTitle={footer}
      csvMenu={csvMenu}
      toolbarStatus={toolbarStatus}
      onCsvDownload={onCsvDownload}
      onLeave={onLeave}
      // Lead ruling (scan of #3005): a fold in one view never shows up folded in another.
      foldScope={foldScope ?? view.key}
      // Owner rulings 10-04 late (search words, option A): this box filters the list it sits on.
      searchPlaceholder="Filter this list…"
      searchIcon={ListFilter}
      arrowKeys
      scrollBox
      highlighted={highlighted}
      onHighlight={onHighlight}
      renderDetail={renderDetail}
      markedKeys={marked}
      selected={selected}
      onSelectedChange={onSelectedChange}
      onMatchingChange={onMatchingChange}
      footerLabel={footer}
      groupCount={groupCount}
      emptyText="No requests in this view."
    />
  )
}
