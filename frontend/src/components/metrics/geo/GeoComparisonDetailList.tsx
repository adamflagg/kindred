/**
 * GeoComparisonDetailList - Geographic comparison table for two years.
 *
 * Merges two years' geo data by name and renders a comparison table
 * with Name | Year A Count | Year B Count | Change columns.
 * Shows NEW/GONE indicators for items in only one year.
 * Supports collapsible header with optional controlled mode.
 */

import { formatCount, formatSignedCount } from '../../../utils/numberFormat'
import { useState } from 'react'
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight } from 'lucide-react'
import { mergeDataForComparison } from '../../../utils/comparisonUtils'
import type { GeoCategoryExtended } from './GeoCategoryTabs'
import { deltaInk } from '../../../utils/deltaTokens'
import { useTableSort } from '../../../hooks/useTableSort'
import { MetricSortHeader } from '../MetricSortHeader'
import { TableExportButtons } from '../TableExportButtons'
import { csvFilename } from '../exportFilename'
import { PRIORITY_DAY_PENDING, PRIORITY_DAY_PENDING_CLASS } from '../../../utils/priorityDay'

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
  /**
   * On the priority date itself the change waits a day (ruling 9): it reads "updates tomorrow", is
   * blank in the CSV and sorts with the blanks. NEW and GONE still show; they are not changes.
   */
  pending?: boolean | undefined
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
  pending = false,
}: GeoComparisonDetailListProps) {
  const [internalExpanded, setInternalExpanded] = useState(false)
  const isExpanded = isOpen ?? internalExpanded
  const sort = useTableSort<'name' | 'primary' | 'compare' | 'change'>(
    'primary',
    ['name'],
    'descending'
  )

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

  // Natural order: by this year's count, high to low; a header click re-sorts from there.
  const natural = merged.toSorted((a, b) => b.primaryValue - a.primaryValue)
  const sorted = sort.apply(natural, (row, field) =>
    field === 'name'
      ? row.name
      : field === 'primary'
        ? row.primaryValue
        : field === 'compare'
          ? row.compareValue
          : pending
            ? null
            : row.change
  )
  const singular = CATEGORY_PLURALS[category].slice(0, -1)

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
          <div className="flex justify-end px-4 py-2">
            <TableExportButtons
              filename={csvFilename(primaryYear, CATEGORY_PLURALS[category])}
              headers={[singular, String(primaryYear), String(compareYear), 'Change']}
              rows={sorted.map((row) => [
                row.name,
                row.primaryValue,
                row.compareValue,
                pending ? null : row.change,
              ])}
            />
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted sticky top-0 z-10">
                <tr className="border-border border-b">
                  <MetricSortHeader
                    bare
                    label={singular}
                    align="left"
                    direction={sort.direction('name')}
                    onSort={() => sort.toggle('name')}
                    className="text-muted-foreground px-4 py-2 text-left font-medium"
                  />
                  <MetricSortHeader
                    bare
                    label={String(primaryYear)}
                    direction={sort.direction('primary')}
                    onSort={() => sort.toggle('primary')}
                    className="text-muted-foreground w-20 px-4 py-2 text-right font-medium"
                  />
                  <MetricSortHeader
                    bare
                    label={String(compareYear)}
                    direction={sort.direction('compare')}
                    onSort={() => sort.toggle('compare')}
                    className="text-muted-foreground w-20 px-4 py-2 text-right font-medium"
                  />
                  <MetricSortHeader
                    bare
                    label="Change"
                    direction={sort.direction('change')}
                    onSort={() => sort.toggle('change')}
                    className="text-muted-foreground w-28 px-4 py-2 text-right font-medium"
                  />
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const isNew = row.compareValue === 0 && row.primaryValue > 0
                  const isGone = row.primaryValue === 0 && row.compareValue > 0

                  const changeClass =
                    pending && !isNew && !isGone ? '' : deltaInk(row.change, 'up-good')
                  const Icon = row.change > 0 ? TrendingUp : row.change < 0 ? TrendingDown : Minus

                  return (
                    <tr
                      key={row.name}
                      className="border-border hover:bg-muted/20 border-b transition-colors last:border-0"
                    >
                      <td className="text-foreground px-4 py-2">{row.name}</td>
                      <td className="text-foreground px-4 py-2 text-right font-medium">
                        {formatCount(row.primaryValue || null)}
                      </td>
                      <td className="text-foreground px-4 py-2 text-right font-medium">
                        {formatCount(row.compareValue || null)}
                      </td>
                      <td className={`px-4 py-2 text-right ${changeClass}`}>
                        <span className="flex items-center justify-end gap-1">
                          {isNew ? (
                            <span className="bg-forest-100 text-forest-700 dark:bg-forest-900/30 dark:text-forest-300 rounded px-1.5 py-0.5 text-xs font-medium">
                              NEW
                            </span>
                          ) : isGone ? (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                              GONE
                            </span>
                          ) : pending ? (
                            <span className={PRIORITY_DAY_PENDING_CLASS}>
                              {PRIORITY_DAY_PENDING}
                            </span>
                          ) : (
                            <>
                              <Icon className="h-3.5 w-3.5" />
                              {formatSignedCount(row.change)}
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
