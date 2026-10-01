import { useMemo, type MouseEvent, type ReactNode } from 'react'

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
import { ConfirmationState, IdChip, StatusPill } from '../kit/Pills'
import { matchedId, type CellValue } from '../kit/table'
import { attentionFor } from './attention'
import { requestStage, roundOf } from './stage'
import {
  countWords,
  familyGroup,
  footerWords,
  GRID_COLUMNS,
  moneyTotal,
  reasonGroup,
  viewColumns,
  viewCount,
  type ColumnContext,
  type GridColumnKey,
  type RequestView,
} from './views'

/** How a row reaches its household page (slice 1 Decision 1): the link, and the surface's way to go there. */
export interface HouseholdLinks {
  readonly href: (row: ApiAidGridRow) => string
  readonly open: (row: ApiAidGridRow, href: string) => void
}

interface RequestsGridProps {
  /** Already the view's rows (filterRows). */
  readonly rows: readonly ApiAidGridRow[]
  readonly view: RequestView
  readonly showIds: boolean
  readonly today: string
  readonly csvFilename: string
  readonly highlighted: string | null
  /** Stable (useCallback or a state setter): AidTable's `nav` memo depends on it. */
  readonly onHighlight: (key: string | null) => void
  /** Stable (useMemo): the columns memo depends on it. */
  readonly links: HouseholdLinks
  readonly renderBelowHighlighted?: ((row: ApiAidGridRow, nav: AidRowNav) => ReactNode) | undefined
}

const requestKey = (row: ApiAidGridRow) => row.request_id
const idsOf = (row: ApiAidGridRow) => [row.household_cm_id, row.person_cm_id]
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
const ACTION_LINK_CLASS =
  'border-border text-primary shrink-0 rounded border px-1.5 text-xs font-medium hover:underline'

function HouseholdLink({
  row,
  links,
  className,
  children,
}: {
  row: ApiAidGridRow
  links: HouseholdLinks
  className: string
  children: ReactNode
}) {
  const href = links.href(row)
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // A modified click opens a new tab, as any link does (Decision 1).
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    // Opening the family is not a click on the row: no highlight, so no save-then-move (ruling B).
    event.stopPropagation()
    links.open(row, href)
  }
  return (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  )
}

function renderFor(
  key: GridColumnKey,
  ctx: ColumnContext,
  links: HouseholdLinks
): AidColumn<ApiAidGridRow>['render'] {
  switch (key) {
    case 'family':
      return (row, { query }) => {
        const matched = matchedId([row.household_cm_id, row.person_cm_id], query)
        return (
          <div className="min-w-0">
            <HouseholdLink row={row} links={links} className={NAME_LINK}>
              {row.family_name}
            </HouseholdLink>
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
        return stage ? <StatusPill tone={stage.tone}>{stage.text}</StatusPill> : '—'
      }
    case 'r3':
      return (row) => {
        const r3 = roundOf(row, 3)
        if (r3?.status === 'pending_approval') {
          return <span className={AMBER_NOTE}>pending {formatMoney(r3.pending_approval)}</span>
        }
        return <Money value={r3?.decided ?? null} />
      }
    case 'confirmed':
      return (row) =>
        row.confirmation ? <ConfirmationState confirmation={row.confirmation} /> : '—'
    case 'cancelledOn':
      return (row) => (row.cancellation?.on ? formatShortDate(row.cancellation.on) : '—')
    case 'attention':
      return (row, { highlighted }) => {
        const found = attentionFor(row, ctx.view, ctx.today)
        if (found === null) return null
        const action =
          ctx.view === 'all' && found.action !== null ? (
            <HouseholdLink row={row} links={links} className={ACTION_LINK_CLASS}>
              {found.action}
            </HouseholdLink>
          ) : undefined
        return <NeedsAttentionCell item={found.item} highlighted={highlighted} action={action} />
      }
    default: {
      const spec = GRID_COLUMNS[key]
      return spec.money ? (row) => <Money value={asMoney(spec.value(row, ctx))} /> : undefined
    }
  }
}

function buildColumns(
  view: RequestView,
  showIds: boolean,
  today: string,
  links: HouseholdLinks
): Array<AidColumn<ApiAidGridRow>> {
  const ctx: ColumnContext = { view: view.key, today }
  return viewColumns(view, showIds).map((key) => {
    const spec = GRID_COLUMNS[key]
    return {
      key,
      header: spec.header,
      width: spec.width,
      align: spec.align,
      flex: spec.flex,
      pinned: spec.pinned,
      inCsv: spec.inCsv,
      searchable: key === 'family' || key === 'camper',
      value: (row: ApiAidGridRow) => spec.value(row, ctx),
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
  today,
  csvFilename,
  highlighted,
  onHighlight,
  links,
  renderBelowHighlighted,
}: RequestsGridProps) {
  const columns = useMemo(
    () => buildColumns(view, showIds, today, links),
    [view, showIds, today, links]
  )
  const groupings = useMemo(
    (): Array<AidGrouping<ApiAidGridRow>> => [
      { key: 'reason', label: 'By reason', groupOf: reasonGroup(view, today) },
      { key: 'family', label: 'By family', groupOf: familyGroup },
    ],
    [view, today]
  )
  return (
    <AidTable<ApiAidGridRow>
      rows={rows}
      columns={columns}
      rowKey={requestKey}
      searchExtra={idsOf}
      groupings={groupings}
      defaultGrouping={view.groupBy === null ? undefined : 'reason'}
      csvFilename={csvFilename}
      csvExtra={
        view.columns.includes('r3') || view.columns.includes('r3Ask') ? R3_PENDING_CSV : undefined
      }
      arrowKeys
      highlighted={highlighted}
      onHighlight={onHighlight}
      renderBelowHighlighted={renderBelowHighlighted}
      footerLabel={footer}
      groupCount={groupCount}
      emptyText="No requests in this view."
    />
  )
}
