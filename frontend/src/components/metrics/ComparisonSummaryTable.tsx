/**
 * ComparisonSummaryTable - Lightweight wrapper around ComparisonTable for
 * common patterns. Accepts two arrays of {name, value} and merges them
 * into comparison rows with delta calculation.
 *
 * Handles items existing in one year but not the other (NEW/GONE indicators).
 */

import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { mergeDataForComparison } from '../../utils/comparisonUtils'

interface DataItem {
  name: string
  value: number
  [key: string]: unknown
}

interface ComparisonSummaryTableProps {
  title: string
  primaryYear: number
  compareYear: number
  primaryData: DataItem[]
  compareData: DataItem[]
  className?: string
  /** Key to use for matching items between datasets (default: 'name') */
  nameKey?: string
}

export function ComparisonSummaryTable({
  title,
  primaryYear,
  compareYear,
  primaryData,
  compareData,
  className = '',
  nameKey = 'name',
}: ComparisonSummaryTableProps) {
  const merged = mergeDataForComparison(primaryData, compareData, nameKey)

  if (merged.length === 0) {
    return (
      <div className={`card-lodge overflow-hidden ${className}`}>
        <div className="border-border border-b px-4 py-3">
          <h3 className="text-foreground text-base font-semibold">{title}</h3>
        </div>
        <div className="text-muted-foreground p-8 text-center text-sm">No data to compare</div>
      </div>
    )
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
                {primaryYear}
              </th>
              <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                {compareYear}
              </th>
              <th className="text-muted-foreground px-4 py-3 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {merged.map((row) => {
              const isNew = row.compareValue === 0 && row.primaryValue > 0
              const isGone = row.primaryValue === 0 && row.compareValue > 0

              let changeClass = 'text-muted-foreground'
              let Icon = Minus
              if (row.change > 0) {
                changeClass = 'text-emerald-600 dark:text-emerald-400'
                Icon = TrendingUp
              } else if (row.change < 0) {
                changeClass = 'text-red-600 dark:text-red-400'
                Icon = TrendingDown
              }

              return (
                <tr
                  key={row.name}
                  className="border-border hover:bg-muted/20 border-b transition-colors last:border-0"
                >
                  <td className="text-foreground px-4 py-3 font-medium">{row.name}</td>
                  <td className="text-foreground px-4 py-3 text-right">
                    {row.primaryValue}
                    {isGone && <span className="text-muted-foreground ml-1 text-xs">(0)</span>}
                  </td>
                  <td className="text-foreground px-4 py-3 text-right">
                    {row.compareValue}
                    {isNew && <span className="text-muted-foreground ml-1 text-xs">(0)</span>}
                  </td>
                  <td className={`px-4 py-3 text-right ${changeClass}`}>
                    <span className="flex items-center justify-end gap-1">
                      {isNew ? (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                          NEW
                        </span>
                      ) : isGone ? (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          GONE
                        </span>
                      ) : (
                        <>
                          <Icon className="h-4 w-4" />
                          {row.change > 0 ? '+' : ''}
                          {row.change}
                          {row.changePercent !== null && (
                            <span className="text-muted-foreground ml-0.5 text-xs">
                              ({row.changePercent > 0 ? '+' : ''}
                              {row.changePercent.toFixed(1)}%)
                            </span>
                          )}
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
