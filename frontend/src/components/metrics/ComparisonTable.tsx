/**
 * ComparisonTable - Display year-over-year comparison data in a table.
 */

import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { formatCount, formatSignedCount, formatSignedPercent } from '../../utils/numberFormat'
import { DELTA_INK, deltaInk } from '../../utils/deltaTokens'

interface ComparisonRow {
  label: string
  yearA: number
  yearB: number
  change?: number
  changePercent?: number
}

interface ComparisonTableProps {
  title: string
  yearALabel: string
  yearBLabel: string
  rows: ComparisonRow[]
  className?: string
}

export function ComparisonTable({
  title,
  yearALabel,
  yearBLabel,
  rows,
  className = '',
}: ComparisonTableProps) {
  const getTrendIcon = (change: number | undefined) => {
    if (change === undefined || change === 0) {
      return <Minus className="text-muted-foreground h-4 w-4" />
    }
    return change > 0 ? (
      <TrendingUp className={`h-4 w-4 ${DELTA_INK.good}`} />
    ) : (
      <TrendingDown className={`h-4 w-4 ${DELTA_INK.bad}`} />
    )
  }

  const formatChange = (change: number | undefined, percent?: number) => {
    if (change === undefined) return ''
    const changeStr = formatSignedCount(change)
    if (percent !== undefined) {
      return `${changeStr} (${formatSignedPercent(percent)})`
    }
    return changeStr
  }

  const getChangeClass = (change: number | undefined) => {
    return deltaInk(change ?? 0, 'up-good')
  }

  return (
    <div className={`card-lodge overflow-hidden ${className}`}>
      <div className="border-border border-b px-4 py-3">
        <h3 className="text-foreground text-base font-semibold">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border bg-muted/30 border-b">
              <th className="text-muted-foreground px-4 py-3 text-left font-medium">Category</th>
              <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                {yearALabel}
              </th>
              <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                {yearBLabel}
              </th>
              <th className="text-muted-foreground px-4 py-3 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={index}
                className="border-border hover:bg-muted/20 border-b transition-colors last:border-0"
              >
                <td className="text-foreground px-4 py-3 font-medium">{row.label}</td>
                <td className="text-foreground px-4 py-3 text-right">{formatCount(row.yearA)}</td>
                <td className="text-foreground px-4 py-3 text-right">{formatCount(row.yearB)}</td>
                <td className={`px-4 py-3 text-right ${getChangeClass(row.change)}`}>
                  <span className="flex items-center justify-end gap-1">
                    {getTrendIcon(row.change)}
                    {formatChange(row.change, row.changePercent)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
