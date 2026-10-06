import { Fragment, useState } from 'react'
import { Link } from 'react-router'

import { useAidHistoryOperation } from '../../../hooks/camperships/useAidHistory'
import { useAidSessionNames } from '../../../hooks/camperships/useAidSessionNames'
import { hasStatus } from '../../../services/camperships/aidApi'
import type { ApiAidHistoryOperation } from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import { ACTION_LINK } from '../../admin/lodging/lodgingStyles'
import { PILL, ROW_HIGHLIGHT, TABLE_CARD } from '../kit/kitStyles'
import {
  householdHref,
  KIND_LABELS,
  KIND_TONE,
  operationWords,
  rowView,
  rulesLink,
} from './historyModel'
import { TD_LABEL, TD_MONEY, TH_LABEL, TH_MONEY } from './seasonStyles'

/** An opened line shows this many rows until asked for the rest (an intake run can hold hundreds). */
const ROWS_SHOWN = 25

/** Links and the two buttons that read as links: lodgingStyles' action link, in the primary colour. */
const LINK = `text-primary ${ACTION_LINK}`

/** Cells align to the top, so a wrapping "What happened" doesn't float the others (history.html B). */
const CELL_LABEL = `${TD_LABEL} align-top`
const CELL_MONEY = `${TD_MONEY} align-top`

function OperationDetail({
  operation,
  view,
}: {
  operation: ApiAidHistoryOperation
  view: AidView
}) {
  const detail = useAidHistoryOperation(operation.operation_id)
  // A row's session reads by its name ("Session 2"), as the Rules tab's do.
  const sessions = useAidSessionNames(view.year)
  const [all, setAll] = useState(false)
  if (detail.isLoading) return <p className="text-muted-foreground text-xs">Loading its rows…</p>
  if (detail.data === undefined) {
    // A 404 is an answer (not in this season's log, or a rules one without `rules`): retrying can't change it.
    if (hasStatus(detail.error, 404)) {
      return (
        <p className="text-xs text-red-700 dark:text-red-400">
          This operation is not in the log you can read.
        </p>
      )
    }
    return (
      <p className="text-xs text-red-700 dark:text-red-400">
        Its rows didn&apos;t load.{' '}
        <button type="button" className={LINK} onClick={() => void detail.refetch()}>
          Try Again
        </button>
      </p>
    )
  }
  const rows = detail.data.rows
  const shown = all ? rows : rows.slice(0, ROWS_SHOWN)
  const rules = rulesLink(operation, view)
  return (
    <div className="space-y-1.5 text-xs">
      {operation.reason !== '' && <p>{`Reason: “${operation.reason}”`}</p>}
      <ul className="space-y-1">
        {shown.map((row, index) => {
          const v = rowView(row, sessions)
          return (
            <li key={`${row.entity}:${row.entity_id}:${String(index)}`} data-history-row>
              <span className="font-medium">{v.head}</span>
              {v.camperName !== null && ` · ${v.camperName}`}
              {v.householdCmId !== null && (
                <>
                  {' · '}
                  <Link to={householdHref(v.householdCmId, view)} className={LINK}>
                    {`${v.householdName ?? `Household ${String(v.householdCmId)}`} ›`}
                  </Link>
                </>
              )}
              {v.lines.length > 0 && (
                <ul className="text-muted-foreground ml-4">
                  {v.lines.map((text, i) => (
                    <li key={`${String(i)}:${text}`}>{text}</li>
                  ))}
                </ul>
              )}
              {v.hidden > 0 && (
                <div className="text-muted-foreground ml-4">
                  {`and ${String(v.hidden)} recorded ${v.hidden === 1 ? 'detail' : 'details'} not listed`}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {!all && rows.length > ROWS_SHOWN && (
        <button type="button" className={LINK} onClick={() => setAll(true)}>
          {`Show all ${String(rows.length)} rows`}
        </button>
      )}
      {rules !== null && (
        <div>
          <Link to={rules.href} className={LINK}>
            {rules.label}
          </Link>
        </div>
      )}
    </div>
  )
}

/**
 * Season › History's log (spec §7.6; D49; history.html B): one line per operation, newest first, as
 * the server sent them; a click opens or closes a line (the page keeps `open=` in the URL). The Rows
 * column is a count, right-aligned like a figure (seasonStyles' money cells).
 */
export function HistoryTable({
  operations,
  open,
  onToggle,
  view,
}: {
  operations: readonly ApiAidHistoryOperation[]
  open: readonly string[]
  onToggle: (operationId: string) => void
  view: AidView
}) {
  return (
    <div className={TABLE_CARD}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={TH_LABEL}>When</th>
            <th className={TH_LABEL}>Who</th>
            <th className={TH_LABEL}>Kind</th>
            <th className={TH_LABEL}>What happened</th>
            <th className={TH_MONEY}>Rows</th>
          </tr>
        </thead>
        <tbody>
          {operations.map((op) => {
            const words = operationWords(op)
            const isOpen = open.includes(op.operation_id)
            return (
              <Fragment key={op.operation_id}>
                <tr
                  data-operation={op.operation_id}
                  className={
                    isOpen ? `cursor-pointer ${ROW_HIGHLIGHT}` : 'hover:bg-muted/40 cursor-pointer'
                  }
                  onClick={() => onToggle(op.operation_id)}
                >
                  <td className={CELL_LABEL}>
                    <span className="text-muted-foreground mr-1 inline-block w-3">
                      {isOpen ? '▾' : '▸'}
                    </span>
                    {words.when}
                  </td>
                  <td className={CELL_LABEL}>{words.who}</td>
                  <td className={CELL_LABEL}>
                    <span className={PILL[KIND_TONE[op.kind]]}>{KIND_LABELS[op.kind]}</span>
                  </td>
                  <td className="border-border border-b px-2 py-1.5 align-top">
                    <span>{words.what}</span>
                    {words.reason !== null && (
                      <span className="text-muted-foreground">{` · “${words.reason}”`}</span>
                    )}
                  </td>
                  <td className={CELL_MONEY}>{op.rows}</td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={5} className="bg-muted/20 border-border border-b py-2 pr-3 pl-9">
                      <OperationDetail operation={op} view={view} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
