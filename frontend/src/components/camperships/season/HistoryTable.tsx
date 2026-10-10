import { Fragment, type ReactNode } from 'react'

import type { ApiAidHistoryOperation } from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import {
  CS_HIGHLIGHT_EDGE,
  CS_LINK_SM,
  CS_META,
  CS_PANEL,
  CS_PILL,
  CS_ROW_HIGHLIGHT,
  CS_TD,
  CS_TH,
} from '../kit/csType'
import { TABLE } from '../kit/kitStyles'
import { HistoryPanels } from './HistoryPanels'
import { KIND_LABELS, KIND_TONE, operationWords, PER_PAGE, pageBreakWords } from './historyModel'
import { TH_MONEY } from './seasonStyles'

/**
 * The opened row's cell (mock td.cf-detail): the summary row's amber edge continues down it, and in dark it is a
 * shade darker than the summary (amber-900 18%, not 30%). Its padding (3px 12px 8px 34px, so the panels start
 * under the date) sits on the sticky frame, which is as wide as the box: padding on the cell would push it off.
 */
const DETAIL_CELL = `${CS_HIGHLIGHT_EDGE} overflow-visible border-b border-amber-300 bg-amber-50 p-0 dark:border-amber-800 dark:bg-[color-mix(in_oklab,var(--color-amber-900)_18%,var(--color-card))]`
const DETAIL_FRAME = 'sticky left-0 box-border pt-[3px] pr-3 pb-2 pl-[34px] whitespace-normal'

const NO_STARTS: ReadonlyArray<{ page: number; index: number }> = []

/** One line per row (history-8): every cell nowrap, the long ones cut with ellipsis and their words in a title. */
const CELL_ONE_LINE = `${CS_TD} whitespace-nowrap`
const CELL_CUT = `${CELL_ONE_LINE} overflow-hidden text-ellipsis`
const CELL_MONEY = `${CS_TD} text-right tabular-nums whitespace-nowrap`
/** The header stays at the box's top while the rows scroll under it (history-v2.html `table.h th`). */
const HEAD = `${CS_TH} whitespace-nowrap sticky top-0 z-30`
const HEAD_MONEY = `${TH_MONEY} whitespace-nowrap sticky top-0 z-30`

/**
 * Season › History's log, inside the box (spec §7.2 C; D49; history-v2.html): one line per operation,
 * newest first, as the server sent them, `table-fixed` at 124/190/132/auto/60. A page-break row starts
 * each later page (`starts`, from `pageStarts`); `tail` is the last row while more is to come. A click
 * opens or closes a line (the page keeps `open=` in the URL); the opened line is as wide as the box
 * (`lineWidth`, from `useFitToViewport`), stuck at its left.
 */
export function HistoryTable({
  operations,
  open,
  onToggle,
  view,
  starts = NO_STARTS,
  perPage = PER_PAGE,
  total = operations.length,
  lineWidth = 0,
  tail = null,
  onClearFilters,
}: {
  operations: readonly ApiAidHistoryOperation[]
  open: readonly string[]
  onToggle: (operationId: string) => void
  view: AidView
  starts?: ReadonlyArray<{ page: number; index: number }>
  perPage?: number
  total?: number
  lineWidth?: number
  tail?: ReactNode
  /** With no operations, the empty row's Clear filters link (history-m3). */
  onClearFilters?: () => void
}) {
  const breakAt = new Map(starts.map((s) => [s.index, s.page]))
  return (
    <table className={TABLE}>
      <colgroup>
        <col className="w-[124px]" />
        <col className="w-[190px]" />
        <col className="w-[132px]" />
        <col />
        <col className="w-[60px]" />
      </colgroup>
      <thead>
        <tr>
          <th className={HEAD}>When</th>
          <th className={HEAD}>Who</th>
          <th className={HEAD}>Kind</th>
          <th className={HEAD}>What happened</th>
          <th className={HEAD_MONEY} title="How many records the operation wrote">
            Rows
          </th>
        </tr>
      </thead>
      <tbody>
        {operations.length === 0 && (
          <tr>
            <td colSpan={5} className={`${CS_PANEL} px-2 py-1.5`}>
              <span className="text-muted-foreground">No operations match these filters.</span>
              {onClearFilters !== undefined && (
                <>
                  {' '}
                  <button type="button" className={CS_LINK_SM} onClick={onClearFilters}>
                    Clear filters
                  </button>
                </>
              )}
            </td>
          </tr>
        )}
        {operations.map((op, index) => {
          const words = operationWords(op)
          const isOpen = open.includes(op.operation_id)
          const page = breakAt.get(index)
          return (
            <Fragment key={op.operation_id}>
              {page !== undefined && (
                <tr data-page-start={page}>
                  <td colSpan={5} className={`${CS_META} bg-muted/35 px-2 py-0.5`}>
                    {pageBreakWords(page, perPage, total)}
                  </td>
                </tr>
              )}
              <tr
                data-operation={op.operation_id}
                className={
                  isOpen ? `cursor-pointer ${CS_ROW_HIGHLIGHT}` : 'hover:bg-muted/40 cursor-pointer'
                }
                onClick={() => onToggle(op.operation_id)}
              >
                <td className={isOpen ? `${CELL_ONE_LINE} ${CS_HIGHLIGHT_EDGE}` : CELL_ONE_LINE}>
                  <span className="text-muted-foreground mr-1 inline-block w-3 text-[10px]">
                    {isOpen ? '▾' : '▸'}
                  </span>
                  {words.when}
                </td>
                <td className={CELL_CUT} title={words.who}>
                  {words.who}
                </td>
                <td className={CELL_ONE_LINE}>
                  <span className={CS_PILL[KIND_TONE[op.kind]]}>{KIND_LABELS[op.kind]}</span>
                </td>
                <td
                  className={CELL_CUT}
                  title={`${words.what}${words.reason === null ? '' : ` · “${words.reason}”`}`}
                >
                  <span>{words.what}</span>
                  {words.reason !== null && (
                    <span className="text-muted-foreground text-xs">{` · “${words.reason}”`}</span>
                  )}
                </td>
                <td className={CELL_MONEY}>{op.rows}</td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={5} className={DETAIL_CELL}>
                    <div className={DETAIL_FRAME} style={{ width: lineWidth || undefined }}>
                      <HistoryPanels operation={op} view={view} />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
        {tail !== null && (
          <tr>
            <td colSpan={5} className={`${CS_PANEL} text-muted-foreground px-2 py-1.5`}>
              {tail}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}
