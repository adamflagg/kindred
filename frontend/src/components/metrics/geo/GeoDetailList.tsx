/**
 * GeoDetailList - Scrollable list of locations with counts.
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { GeoDataItem } from './GeoMap'
import type { GeoCategoryExtended } from './GeoCategoryTabs'
import type { DrilldownFilter } from '../../../types/metrics'

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
}: GeoDetailListProps) {
  const [internalExpanded, setInternalExpanded] = useState(false)
  const isExpanded = isOpen ?? internalExpanded
  const [showAll, setShowAll] = useState(false)

  const displayData = showAll ? data : data.slice(0, initialLimit)
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
          <span className="text-muted-foreground text-sm">({data.length})</span>
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

                  const rowClass = [
                    'border-border border-t transition-colors',
                    isClickable && 'cursor-pointer',
                    highlightClass,
                  ]
                    .filter(Boolean)
                    .join(' ')

                  return (
                    <tr
                      key={item.name}
                      onClick={handleActivate}
                      onKeyDown={
                        isClickable
                          ? (e: React.KeyboardEvent) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                handleActivate?.()
                              }
                            }
                          : undefined
                      }
                      tabIndex={isClickable ? 0 : undefined}
                      role={isClickable ? 'button' : undefined}
                      className={rowClass}
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
