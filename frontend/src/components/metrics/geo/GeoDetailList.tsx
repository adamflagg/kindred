/**
 * GeoDetailList - Scrollable list of locations with counts.
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { GeoDataItem } from './GeoMap'
import type { GeoCategory } from './GeoCategoryTabs'
import type { DrilldownFilter } from '../../../types/metrics'

interface GeoDetailListProps {
  data: GeoDataItem[]
  category: GeoCategory
  selectedItem?: string | null
  onItemClick?: (name: string) => void
  /** Callback for drilldown when row is clicked */
  onDrilldown?: (filter: DrilldownFilter) => void
  /** Max items to show before "show more" */
  initialLimit?: number
}

const CATEGORY_LABELS: Record<GeoCategory, string> = {
  city: 'City',
  school: 'School',
  synagogue: 'Synagogue',
}

const CATEGORY_PLURALS: Record<GeoCategory, string> = {
  city: 'Cities',
  school: 'Schools',
  synagogue: 'Synagogues',
}

export function GeoDetailList({
  data,
  category,
  selectedItem,
  onItemClick,
  onDrilldown,
  initialLimit = 15,
}: GeoDetailListProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const displayData = showAll ? data : data.slice(0, initialLimit)
  const hasMore = data.length > initialLimit

  return (
    <div className="card-lodge overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="hover:bg-muted/50 flex w-full items-center justify-between px-4 py-3 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="text-muted-foreground h-4 w-4" />
          ) : (
            <ChevronRight className="text-muted-foreground h-4 w-4" />
          )}
          <span className="text-foreground font-medium">{CATEGORY_PLURALS[category]}</span>
          <span className="text-muted-foreground text-sm">({data.length})</span>
        </div>
      </button>

      {/* Table */}
      {isExpanded && (
        <div className="border-border border-t">
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-muted-foreground px-4 py-2 text-left font-medium">
                    {CATEGORY_LABELS[category]}
                  </th>
                  <th className="text-muted-foreground w-20 px-4 py-2 text-right font-medium">
                    Count
                  </th>
                  <th className="text-muted-foreground w-16 px-4 py-2 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {displayData.map((item) => {
                  const isSelected = selectedItem === item.name
                  return (
                    <tr
                      key={item.name}
                      onClick={() => {
                        onItemClick?.(item.name)
                        onDrilldown?.({
                          type: category,
                          value: item.name,
                          label: item.name,
                        })
                      }}
                      className={`border-border cursor-pointer border-t transition-colors ${isSelected ? 'bg-primary/10' : 'hover:bg-muted/30'} `}
                    >
                      <td className="text-foreground px-4 py-2">{item.name}</td>
                      <td className="text-foreground px-4 py-2 text-right font-medium">
                        {item.count}
                      </td>
                      <td className="text-muted-foreground px-4 py-2 text-right">
                        {item.percentage.toFixed(1)}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Show More/Less */}
          {hasMore && (
            <div className="border-border bg-muted/30 border-t px-4 py-2">
              <button
                onClick={() => setShowAll(!showAll)}
                className="text-primary hover:text-primary/80 text-sm transition-colors"
              >
                {showAll
                  ? 'Show less'
                  : `Show all ${data.length} ${CATEGORY_PLURALS[category].toLowerCase()}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default GeoDetailList
