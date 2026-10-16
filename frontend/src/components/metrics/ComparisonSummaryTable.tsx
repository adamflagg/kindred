/**
 * ComparisonSummaryTable - Lightweight wrapper around ComparisonTable for
 * common patterns. Accepts two arrays of {name, value} and merges them
 * into comparison rows with delta calculation.
 *
 * Handles items existing in one year but not the other (NEW/GONE indicators).
 */

import type { ReactNode } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { mergeDataForComparison } from '../../utils/comparisonUtils'
import { formatCount, formatSignedCount, formatSignedPercent } from '../../utils/numberFormat'
import { deltaInk } from '../../utils/deltaTokens'
import { useTableSort } from '../../hooks/useTableSort'
import { MetricSortHeader } from './MetricSortHeader'
import { TableExportButtons } from './TableExportButtons'
import { csvFilename } from './exportFilename'

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
  /** Key to use for display name lookup (default: 'name') */
  nameKey?: string
  /** Separate key for matching items between datasets (default: nameKey) */
  matchKey?: string
  /** Color semantics for change direction */
  sentiment?: 'default' | 'inverse' | 'neutral' | undefined
  /** Alias map for resolving renamed items across years */
  aliasMap?: Record<string, string>
  /** Label for the first column header (default: 'Category') */
  categoryLabel?: string
  /** Sort by any column, with Copy and Download CSV in the heading (#3207 PR 10: the long per-session lists). */
  sortable?: boolean
  /** A swatch before each row's name, keyed by name (gender identity, #2898). */
  colorMap?: Record<string, string>
  /** Under the table: visible note lines (#2898's Gender field count). */
  footer?: ReactNode
}

export function ComparisonSummaryTable({
  title,
  primaryYear,
  compareYear,
  primaryData,
  compareData,
  className = '',
  nameKey = 'name',
  matchKey,
  sentiment,
  aliasMap,
  categoryLabel = 'Category',
  sortable = false,
  colorMap,
  footer,
}: ComparisonSummaryTableProps) {
  const mergedNatural = mergeDataForComparison(
    primaryData,
    compareData,
    nameKey,
    matchKey,
    aliasMap
  )
  const sort = useTableSort<'name' | 'primary' | 'compare' | 'change'>('name')
  const merged = sortable
    ? sort.apply(mergedNatural, (row, field) =>
        field === 'name'
          ? row.name
          : field === 'primary'
            ? row.primaryValue
            : field === 'compare'
              ? row.compareValue
              : row.change
      )
    : mergedNatural

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
      <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
        <h3 className="text-foreground text-base font-semibold">{title}</h3>
        {sortable && (
          <TableExportButtons
            filename={csvFilename(primaryYear, title)}
            headers={[
              categoryLabel,
              String(primaryYear),
              String(compareYear),
              'Change',
              'Change %',
            ]}
            rows={merged.map((row) => [
              row.name,
              row.primaryValue,
              row.compareValue,
              row.change,
              row.changePercent,
            ])}
          />
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border bg-muted/30 border-b">
              {sortable ? (
                <>
                  <MetricSortHeader
                    label={categoryLabel}
                    align="left"
                    direction={sort.direction('name')}
                    onSort={() => sort.toggle('name')}
                  />
                  <MetricSortHeader
                    label={String(primaryYear)}
                    direction={sort.direction('primary')}
                    onSort={() => sort.toggle('primary')}
                  />
                  <MetricSortHeader
                    label={String(compareYear)}
                    direction={sort.direction('compare')}
                    onSort={() => sort.toggle('compare')}
                  />
                  <MetricSortHeader
                    label="Change"
                    direction={sort.direction('change')}
                    onSort={() => sort.toggle('change')}
                  />
                </>
              ) : (
                <>
                  <th className="text-muted-foreground px-4 py-3 text-left font-medium">
                    {categoryLabel}
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                    {primaryYear}
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-right font-medium">
                    {compareYear}
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-right font-medium">Change</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {merged.map((row) => {
              const isNew = row.compareValue === 0 && row.primaryValue > 0
              const isGone = row.primaryValue === 0 && row.compareValue > 0

              // The app-wide delta tokens (#3207 PR 8): 'neutral' is grey either way (ruling #17).
              const changeClass = deltaInk(
                row.change,
                sentiment === 'neutral' ? 'neutral' : sentiment === 'inverse' ? 'up-bad' : 'up-good'
              )
              const Icon = row.change > 0 ? TrendingUp : row.change < 0 ? TrendingDown : Minus

              return (
                <tr
                  key={row.name}
                  className="border-border hover:bg-muted/20 border-b transition-colors last:border-0"
                >
                  <td className="text-foreground px-4 py-3 font-medium">
                    {colorMap?.[row.name] && (
                      <span
                        className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]"
                        style={{ backgroundColor: colorMap[row.name] }}
                      />
                    )}
                    {row.name}
                    {row.compareName && (
                      <span className="text-muted-foreground ml-1 text-xs">
                        (was: {row.compareName})
                      </span>
                    )}
                  </td>
                  <td className="text-foreground px-4 py-3 text-right">
                    {formatCount(row.primaryValue)}
                  </td>
                  <td className="text-foreground px-4 py-3 text-right">
                    {formatCount(row.compareValue)}
                  </td>
                  <td className={`px-4 py-3 text-right ${changeClass}`}>
                    <span className="flex items-center justify-end gap-1">
                      {isNew ? (
                        <span className="bg-forest-100 text-forest-700 dark:bg-forest-900/30 dark:text-forest-300 rounded px-1.5 py-0.5 text-xs font-medium">
                          NEW
                        </span>
                      ) : isGone ? (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          GONE
                        </span>
                      ) : (
                        <>
                          <Icon className="h-4 w-4" />
                          {formatSignedCount(row.change)}
                          {row.changePercent !== null && (
                            <span className="text-muted-foreground ml-0.5 text-xs">
                              ({formatSignedPercent(row.changePercent)})
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
      {footer && <div className="px-4 pb-3">{footer}</div>}
    </div>
  )
}
