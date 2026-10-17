import type { ReactNode } from 'react'
import type { VelocityCurve, PriorYearSessionSummary } from '../../types/velocity'
import { sessionPriorOf } from './velocityCompare'
import { useTableSort } from '../../hooks/useTableSort'
import type { SortValue } from '../../utils/tableSort'
import { MetricSortHeader } from '../metrics/MetricSortHeader'
import { TableExportButtons } from '../metrics/TableExportButtons'

export interface SessionColumnDef {
  header: string
  accessor: (session: VelocityCurve, priorData?: PriorYearSessionSummary) => ReactNode
  className?: string
  /** The figure behind the cell, for sorting and the CSV; a column without one is not sorted and exports empty. */
  value?: (session: VelocityCurve, priorData?: PriorYearSessionSummary) => SortValue
}

interface SessionBreakdownTableProps {
  sortedBySession: VelocityCurve[]
  /** Keyed by current session cm_id when matched, else by canonical session name. */
  priorSessionMap: Map<number | string, PriorYearSessionSummary>
  columns: SessionColumnDef[]
  /** The CSV file name (<season>-<view>-<date>.csv). Giving one turns on sorting, Copy and Download CSV. */
  exportFile?: string
}

export function SessionBreakdownTable({
  sortedBySession,
  priorSessionMap,
  columns,
  exportFile,
}: SessionBreakdownTableProps) {
  const sort = useTableSort<string>('col:0', ['col:0'])
  if (sortedBySession.length === 0) {
    return (
      <div className="card-lodge p-4">
        <p className="text-muted-foreground text-sm">No session data available</p>
      </div>
    )
  }

  const priorOf = (session: VelocityCurve) => sessionPriorOf(session, priorSessionMap)
  const sortable = exportFile !== undefined
  const shown = sortable
    ? sort.apply(sortedBySession, (session, field) => {
        const col = columns[Number(field.slice(4))]
        return col?.value?.(session, priorOf(session))
      })
    : sortedBySession

  return (
    <div className="overflow-x-auto">
      {sortable && (
        <div className="flex justify-end px-4 pb-2">
          <TableExportButtons
            filename={exportFile}
            headers={columns.map((col) => col.header)}
            rows={shown.map((session) =>
              columns.map((col) => col.value?.(session, priorOf(session)) ?? null)
            )}
          />
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border bg-muted/30 border-b">
            {columns.map((col, i) =>
              sortable && col.value ? (
                <MetricSortHeader
                  key={col.header}
                  label={col.header}
                  align={col.className?.includes('text-right') ? 'right' : 'left'}
                  direction={sort.direction(`col:${String(i)}`)}
                  onSort={() => sort.toggle(`col:${String(i)}`)}
                />
              ) : (
                <th
                  key={col.header}
                  className={`text-muted-foreground px-4 py-3 font-medium ${col.className ?? 'text-left'}`}
                >
                  {col.header}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {shown.map((session) => {
            const priorSession = priorOf(session)

            return (
              <tr
                key={session.session_cm_id}
                className="border-border hover:bg-muted/20 border-b transition-colors last:border-0"
              >
                {columns.map((col) => (
                  <td key={col.header} className={`px-4 py-3 ${col.className ?? ''}`}>
                    {col.accessor(session, priorSession)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
