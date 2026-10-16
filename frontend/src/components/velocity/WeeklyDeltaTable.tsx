import type { ReactNode } from 'react'
import type { WeeklyDataPoint } from '../../types/velocity'
import { PhaseBadge } from '../../pages/metrics/trends/PhaseBadge'
import type { SortValue } from '../../utils/tableSort'
import { TableExportButtons } from '../metrics/TableExportButtons'

export interface DeltaColumnDef {
  header: string
  accessor: (week: WeeklyDataPoint, priorWeek?: WeeklyDataPoint) => ReactNode
  className?: string
  /** The figure behind the cell, for the CSV. */
  value?: (week: WeeklyDataPoint, priorWeek?: WeeklyDataPoint) => SortValue
}

interface WeeklyDeltaTableProps {
  weeks: WeeklyDataPoint[]
  priorWeekMap: Map<number, WeeklyDataPoint> | null
  columns: DeltaColumnDef[]
  phaseByWeek?: Map<number, { phase: string; label: string }>
  /** The CSV file name. Giving one adds Copy and Download CSV; the weeks stay in time order (no sort). */
  exportFile?: string
}

export function WeeklyDeltaTable({
  weeks,
  priorWeekMap,
  columns,
  phaseByWeek,
  exportFile,
}: WeeklyDeltaTableProps) {
  if (weeks.length === 0) {
    return (
      <div className="card-lodge p-4">
        <p className="text-muted-foreground text-sm">No weekly data available</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      {exportFile !== undefined && (
        <div className="flex justify-end px-4 py-2">
          <TableExportButtons
            filename={exportFile}
            headers={['Week', ...columns.map((col) => col.header)]}
            rows={weeks.map((week) => {
              const priorPoint = priorWeekMap?.get(week.week_number)
              return [
                week.week_label,
                ...columns.map((col) => col.value?.(week, priorPoint) ?? null),
              ]
            })}
          />
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border bg-muted/30 border-b">
            <th className="text-muted-foreground px-4 py-3 text-left font-medium">Week</th>
            {columns.map((col) => (
              <th
                key={col.header}
                className={`text-muted-foreground px-4 py-3 font-medium ${col.className ?? 'text-left'}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => {
            const priorPoint = priorWeekMap?.get(week.week_number)
            const marker = phaseByWeek?.get(week.week_number)

            return (
              <tr
                key={week.week_start}
                className={`border-border hover:bg-muted/20 border-b transition-colors last:border-0 ${week.is_partial ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}`}
              >
                <td className="text-foreground px-4 py-3 font-medium">
                  {week.week_label}
                  {marker && <PhaseBadge phase={marker.phase} label={marker.label} />}
                  {week.is_partial && (
                    <span className="ml-1.5 text-xs font-normal text-amber-600 dark:text-amber-400">
                      ({week.days_in_week}/7 days)
                    </span>
                  )}
                </td>
                {columns.map((col) => (
                  <td key={col.header} className={`px-4 py-3 ${col.className ?? ''}`}>
                    {col.accessor(week, priorPoint)}
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
