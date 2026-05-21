/**
 * GeoComparisonDetailList - Geographic comparison table for two years.
 *
 * Merges two years' geo data by name and renders a comparison table
 * with Name | Year A Count | Year B Count | Change columns.
 * Shows NEW/GONE indicators for items in only one year.
 * Supports collapsible header with optional controlled mode.
 */

import { useState } from 'react'
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight } from 'lucide-react'
import { mergeDataForComparison } from '../../../utils/comparisonUtils'
import type { GeoCategoryExtended } from './GeoCategoryTabs'

interface GeoDataItem {
  name: string
  count: number
  percentage: number
}

interface GeoComparisonDetailListProps {
  category: GeoCategoryExtended
  primaryData: GeoDataItem[]
  compareData: GeoDataItem[]
  primaryYear: number
  compareYear: number
  className?: string
  /** Externally controlled expand state */
  isOpen?: boolean | undefined
  /** Callback when header is clicked (for controlled mode) */
  onToggle?: (() => void) | undefined
}

const CATEGORY_PLURALS: Record<GeoCategoryExtended, string> = {
  city: 'Cities',
  school: 'Schools',
  synagogue: 'Synagogues',
  region: 'Regions',
}

export function GeoComparisonDetailList({
  category,
  primaryData,
  compareData,
  primaryYear,
  compareYear,
  className = '',
  isOpen,
  onToggle,
}: GeoComparisonDetailListProps) {
  const [internalExpanded, setInternalExpanded] = useState(false)
  const isExpanded = isOpen ?? internalExpanded

  // Transform geo data to {name, value} for merging
  const primaryItems = primaryData.map((d) => ({ name: d.name, value: d.count }))
  const compareItems = compareData.map((d) => ({ name: d.name, value: d.count }))
  const merged = mergeDataForComparison(primaryItems, compareItems)

  if (merged.length === 0) {
    return (
      <div className={`card-lodge overflow-hidden ${className}`}>
        <div className="px-4 py-3">
          <span className="text-foreground font-medium">{CATEGORY_PLURALS[category]}</span>
          <span className="text-muted-foreground ml-2 text-sm">(0)</span>
        </div>
        <div className="text-muted-foreground border-border border-t p-6 text-center text-sm">
          No data to compare
        </div>
      </div>
    )
  }

  // Sort by primary value descending
  const sorted = merged.toSorted((a, b) => b.primaryValue - a.primaryValue)

  return (
    <div className={`card-lodge overflow-hidden ${className}`}>
      {/* Collapsible Header */}
      <button
        onClick={() => {
          onToggle?.()
          if (isOpen === undefined) setInternalExpanded(!internalExpanded)
        }}
        className="bg-muted/40 hover:bg-muted/60 flex w-full items-center justify-between px-4 py-3 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="text-muted-foreground h-4 w-4" />
          ) : (
            <ChevronRight className="text-muted-foreground h-4 w-4" />
          )}
          <span className="text-foreground font-semibold">{CATEGORY_PLURALS[category]}</span>
          <span className="text-muted-foreground text-sm">({sorted.length})</span>
        </div>
      </button>

      {/* Table */}
      {isExpanded && (
        <div className="border-border border-t">
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted sticky top-0 z-10">
                <tr className="border-border border-b">
                  <th className="text-muted-foreground px-4 py-2 text-left font-medium">
                    {CATEGORY_PLURALS[category].slice(0, -1)}
                  </th>
                  <th className="text-muted-foreground w-20 px-4 py-2 text-right font-medium">
                    {primaryYear}
                  </th>
                  <th className="text-muted-foreground w-20 px-4 py-2 text-right font-medium">
                    {compareYear}
                  </th>
                  <th className="text-muted-foreground w-28 px-4 py-2 text-right font-medium">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
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
                      <td className="text-foreground px-4 py-2">{row.name}</td>
                      <td className="text-foreground px-4 py-2 text-right font-medium">
                        {row.primaryValue || '\u2014'}
                      </td>
                      <td className="text-foreground px-4 py-2 text-right font-medium">
                        {row.compareValue || '\u2014'}
                      </td>
                      <td className={`px-4 py-2 text-right ${changeClass}`}>
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
                              <Icon className="h-3.5 w-3.5" />
                              {row.change > 0 ? '+' : ''}
                              {row.change}
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
      )}
    </div>
  )
}
