import { Fragment, type ReactNode } from 'react'

import type { ApiAidHistoryOperation } from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import {
  CS_DETAIL_LINE,
  CS_DETAIL_ROW,
  CS_HIGHLIGHT_EDGE,
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

const NO_STARTS: ReadonlyArray<{ page: number; index: number }> = []

/** CS_TD aligns to the top, so a wrapping "What happened" doesn't float the others (history.html B). */
const CELL_ONE_LINE = `${CS_TD} whitespace-nowrap`
const CELL_MONEY = `${CS_TD} text-right tabular-nums whitespace-nowrap`
/** The header stays at the box's top while the rows scroll under it (history-v2.html `table.h th`). */
const HEAD = `${CS_TH} sticky top-0 z-30`
const HEAD_MONEY = `${TH_MONEY} sticky top-0 z-30`

/**
 * Season › History's log, inside the box (spec §7.2 C; D49; history-v2.html): one line per operation,
 * newest first, as the server sent them, `table-fixed` at 122/214/128/auto/56. A page-break row starts
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
}) {
  const breakAt = new Map(starts.map((s) => [s.index, s.page]))
  return (
    <table className={TABLE}>
      <colgroup>
        <col className="w-[122px]" />
        <col className="w-[214px]" />
        <col className="w-[128px]" />
        <col />
        <col className="w-[56px]" />
      </colgroup>
      <thead>
        <tr>
          <th className={HEAD}>When</th>
          <th className={HEAD}>Who</th>
          <th className={HEAD}>Kind</th>
          <th className={HEAD}>What happened</th>
          <th className={HEAD_MONEY}>Rows</th>
        </tr>
      </thead>
      <tbody>
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
                  <span className="text-muted-foreground mr-1 inline-block w-3">
                    {isOpen ? '▾' : '▸'}
                  </span>
                  {words.when}
                </td>
                <td className={CELL_ONE_LINE}>{words.who}</td>
                <td className={CELL_ONE_LINE}>
                  <span className={CS_PILL[KIND_TONE[op.kind]]}>{KIND_LABELS[op.kind]}</span>
                </td>
                <td className={CS_TD}>
                  <span>{words.what}</span>
                  {words.reason !== null && (
                    <span className="text-muted-foreground">{` · “${words.reason}”`}</span>
                  )}
                </td>
                <td className={CELL_MONEY}>{op.rows}</td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={5} className={CS_DETAIL_ROW}>
                    <div className={CS_DETAIL_LINE} style={{ width: lineWidth || undefined }}>
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
