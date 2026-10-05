import { ListFilter } from 'lucide-react'
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
import { NeedsAttentionCell } from '../kit/NeedsAttentionCell'
import { TICK_BUTTON } from '../kit/kitStyles'
import { IdChip, StatusPill } from '../kit/Pills'
import { matchedId, type CellValue } from '../kit/table'
import { attentionFor } from './attention'
import { HouseholdLink, type HouseholdLinks } from './HouseholdLink'
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
  /**
   * The opened row's editor (owner fast-follow 10-03, arrangement 3): drawn inside the detail line,
   * as its right panel on a row that takes an ask, handed the row's next step to end its line with
   * (null on a row that takes none, where the step stays in the detail line).
   */
  readonly renderEditor?:
    ((row: ApiAidGridRow, nav: AidRowNav, step: ReactNode) => ReactNode) | undefined
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

const NAME_LINK = 'text-primary font-medium hover:underline'

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
        return (
          <div className="min-w-0 truncate">
            {row.requested_by ? (
              <HouseholdLink row={row} links={links} className={NAME_LINK}>
                {row.requested_by}
              </HouseholdLink>
            ) : (
              '—'
            )}
            {matched !== null && (
              <div>
                <IdChip id={matched} />
              </div>
            )}
          </div>
        )
      }
    case 'camper':
      return (row) => (
        <HouseholdLink row={row} links={links} className={NAME_LINK}>
          {row.camper_name === '' ? 'Household request' : row.camper_name}
        </HouseholdLink>
      )
    case 'stage':
      return (row) => {
        const stage = requestStage(row)
        return stage ? (
          <StatusPill tone={stage.tone} wrap>
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
        return <Money value={r3?.decided ?? null} />
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
      return spec.money ? (row) => <Money value={asMoney(spec.value(row, ctx))} /> : undefined
    }
  }
}

function buildColumns(
  view: RequestView,
  showIds: boolean,
  tickedSeason: boolean,
  today: string,
  links: HouseholdLinks,
  onTick: ((row: ApiAidGridRow, action: TickAction) => void) | undefined
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
 * width. The server decided every row (D21); this only draws them.
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
  renderEditor,
  marked,
  selected,
  onSelectedChange,
  onMatchingChange,
  onTick,
  onMarkPosted,
}: RequestsGridProps) {
  const columns = useMemo(
    () => buildColumns(view, showIds, tickedSeason, today, links, onTick),
    [view, showIds, tickedSeason, today, links, onTick]
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
        editor={renderEditor ? (step: ReactNode) => renderEditor(row, nav, step) : undefined}
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
        view.columns.includes('r3') || view.columns.includes('r3Ask') ? R3_PENDING_CSV : undefined
      }
      toolbarLead={filters}
      toolbarAfterGrouping={filtersAfterGrouping}
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
