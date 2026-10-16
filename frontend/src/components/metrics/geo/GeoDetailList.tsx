/**
 * GeoDetailList - Scrollable list of locations with counts.
 */

import { formatCount, formatPercent } from '../../../utils/numberFormat'
import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { GeoDataItem } from './GeoMap'
import type { GeoCategoryExtended } from './GeoCategoryTabs'
import type { DrilldownFilter } from '../../../types/metrics'
import { useTableSort } from '../../../hooks/useTableSort'
import { MetricSortHeader } from '../MetricSortHeader'
import { TableExportButtons } from '../TableExportButtons'
import { csvFilename } from '../exportFilename'

interface GeoDetailListProps {
  data: GeoDataItem[]
  category: GeoCategoryExtended
  selectedItem?: string | null
  onItemClick?: (name: string) => void
  /** Callback for drilldown when row is clicked */
  onDrilldown?: (filter: DrilldownFilter) => void
  /** Max items to show before "show more" */
  initialLimit?: number
  /** Externally controlled expand state */
  isOpen?: boolean | undefined
  /** Callback when header is clicked (for controlled mode) */
  onToggle?: (() => void) | undefined
  /** The season shown; names the CSV file. Without it the list has no Copy or Download CSV. */
  year?: number | undefined
}

const CATEGORY_LABELS: Record<GeoCategoryExtended, string> = {
  city: 'City',
  school: 'School',
  synagogue: 'Synagogue',
  region: 'Region',
}

const CATEGORY_PLURALS: Record<GeoCategoryExtended, string> = {
  city: 'Cities',
  school: 'Schools',
  synagogue: 'Synagogues',
  region: 'Regions',
}

export function GeoDetailList({
  data,
  category,
  selectedItem,
  onItemClick,
  onDrilldown,
  initialLimit = 15,
  isOpen,
  onToggle,
  year,
}: GeoDetailListProps) {
  const [internalExpanded, setInternalExpanded] = useState(false)
  const isExpanded = isOpen ?? internalExpanded
  const [showAll, setShowAll] = useState(false)
  // Natural order: the data as given (largest first); a header click re-sorts from there.
  const sort = useTableSort<'name' | 'count' | 'percentage'>('count', ['name'], 'descending')
  const sorted = sort.apply(data, (item, field) =>
    field === 'name' ? item.name : field === 'count' ? item.count : item.percentage
  )

  const displayData = showAll ? sorted : sorted.slice(0, initialLimit)
  const hasMore = data.length > initialLimit

  return (
    <div className="card-lodge overflow-hidden">
      {/* Header */}
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
          <span className="text-muted-foreground text-sm">({formatCount(data.length)})</span>
        </div>
      </button>

      {/* Table */}
      {isExpanded && (
        <div className="border-border border-t">
          {year !== undefined && (
            <div className="flex justify-end px-4 py-2">
              <TableExportButtons
                filename={csvFilename(year, CATEGORY_PLURALS[category])}
                headers={[CATEGORY_LABELS[category], 'Count', '%']}
                rows={sorted.map((item) => [
                  item.name,
                  item.count,
                  Math.round(item.percentage * 10) / 10,
                ])}
              />
            </div>
          )}
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted sticky top-0 z-10">
                <tr className="border-border border-b">
                  <MetricSortHeader
                    bare
                    label={CATEGORY_LABELS[category]}
                    align="left"
                    direction={sort.direction('name')}
                    onSort={() => sort.toggle('name')}
                    className="text-muted-foreground px-4 py-2 text-left font-medium"
                  />
                  <MetricSortHeader
                    bare
                    label="Count"
                    direction={sort.direction('count')}
                    onSort={() => sort.toggle('count')}
                    className="text-muted-foreground w-20 px-4 py-2 text-right font-medium"
                  />
                  <MetricSortHeader
                    bare
                    label="%"
                    direction={sort.direction('percentage')}
                    onSort={() => sort.toggle('percentage')}
                    className="text-muted-foreground w-16 px-4 py-2 text-right font-medium"
                  />
                </tr>
              </thead>
              <tbody>
                {displayData.map((item) => {
                  const isSelected = selectedItem === item.name
                  const isClickable = category !== 'region'

                  const handleActivate = isClickable
                    ? () => {
                        onItemClick?.(item.name)
                        onDrilldown?.({
                          type: category,
                          value: item.name,
                          label: item.name,
                        })
                      }
                    : undefined

                  let highlightClass = ''
                  if (isSelected) highlightClass = 'bg-primary/10'
                  else if (isClickable) highlightClass = 'hover:bg-muted/30'

                  const rowClass = ['border-border border-t transition-colors', highlightClass]
                    .filter(Boolean)
                    .join(' ')

                  // `role="button"` used to live on the `<tr>` itself,
                  // overriding the native `row` role — `queryAllByRole('row')`
                  // collapsed to 1 (the header alone). The affordance is now a
                  // real `<button>` confined to the name cell instead, which
                  // keeps row/cell semantics intact and satisfies
                  // `clickoutsidePredicate`'s `isInteractive` check the same
                  // way any other `button` does (kindred#2063). A real button
                  // also gets Enter/Space activation for free — no manual
                  // `onKeyDown` needed, matching this file's own header
                  // button just above.
                  return (
                    <tr key={item.name} className={rowClass}>
                      <td className="text-foreground px-4 py-2">
                        {isClickable ? (
                          <button
                            type="button"
                            onClick={handleActivate}
                            className="block w-full cursor-pointer text-left"
                          >
                            {item.name}
                          </button>
                        ) : (
                          item.name
                        )}
                      </td>
                      <td className="text-foreground px-4 py-2 text-right font-medium">
                        {formatCount(item.count)}
                      </td>
                      <td className="text-muted-foreground px-4 py-2 text-right">
                        {formatPercent(item.percentage)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Show More/Less */}
          {hasMore && (
            <div data-app-chrome className="border-border bg-muted/30 border-t px-4 py-2">
              <button
                onClick={() => setShowAll(!showAll)}
                className="text-primary hover:text-primary/80 text-sm transition-colors"
              >
                {showAll
                  ? 'Show less'
                  : `Show all ${formatCount(data.length)} ${CATEGORY_PLURALS[category].toLowerCase()}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default GeoDetailList
