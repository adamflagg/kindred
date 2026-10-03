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
import { IdChip, StatusPill } from '../kit/Pills'
import { matchedId, type CellValue } from '../kit/table'
import { attentionFor } from './attention'
import { HouseholdLink, type HouseholdLinks } from './HouseholdLink'
import { RequestDetailLine } from './RequestDetailLine'
import { requestStage, roundOf } from './stage'
import {
  cmChip,
  countWords,
  footerWords,
  GRID_COLUMNS,
  moneyTotal,
  reasonGroup,
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
  readonly renderBelowHighlighted?: ((row: ApiAidGridRow, nav: AidRowNav) => ReactNode) | undefined
  /** Rows whose save failed (Decision 3): marked in place. Stable (useMemo). */
  readonly marked?: ReadonlySet<string> | undefined
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
  links: HouseholdLinks
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
  links: HouseholdLinks
): Array<AidColumn<ApiAidGridRow>> {
  const ctx: ColumnContext = columnContext(view, today)
  return viewColumns(view, showIds, tickedSeason).map((key) => {
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
      render: renderFor(key, ctx, links),
      total: spec.money
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
  renderBelowHighlighted,
  marked,
}: RequestsGridProps) {
  const columns = useMemo(
    () => buildColumns(view, showIds, tickedSeason, today, links),
    [view, showIds, tickedSeason, today, links]
  )
  const renderDetail = useCallback(
    (row: ApiAidGridRow) => (
      <RequestDetailLine
        row={row}
        ctx={columnContext(view, today)}
        links={links}
        showConfirmation={tickedSeason}
      />
    ),
    [view, today, links, tickedSeason]
  )
  const groupings = useMemo(
    (): Array<AidGrouping<ApiAidGridRow>> => [
      { key: 'reason', label: 'By reason', groupOf: reasonGroup(view, today) },
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
      arrowKeys
      scrollBox
      highlighted={highlighted}
      onHighlight={onHighlight}
      renderDetail={renderDetail}
      renderBelowHighlighted={renderBelowHighlighted}
      markedKeys={marked}
      footerLabel={footer}
      groupCount={groupCount}
      emptyText="No requests in this view."
    />
  )
}
