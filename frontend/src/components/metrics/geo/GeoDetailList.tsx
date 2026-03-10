/**
 * GeoDetailList - Scrollable list of locations with counts.
 *
 * When showSources is enabled, displays expandable rows showing
 * the original source strings that normalized to each canonical value.
 */

import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import type { GeoDataItem } from './GeoMap'
import type { GeoCategoryExtended } from './GeoCategoryTabs'
import type { DrilldownFilter } from '../../../types/metrics'
import type { SourceMapping } from '../../../hooks/useSourceMappings'
import { US_CITY_STATES } from '../../../data/cityGeo'
import { getLocationCoordsWithOverrides } from '../../../data/geoCoords'
import type { LatLng } from '../../../data/californiaGeo'

interface GeoDetailListProps {
  data: GeoDataItem[]
  category: GeoCategoryExtended
  selectedItem?: string | null
  onItemClick?: (name: string) => void
  /** Callback for drilldown when row is clicked */
  onDrilldown?: (filter: DrilldownFilter) => void
  /** Max items to show before "show more" */
  initialLimit?: number
  /** Whether to show source strings for each normalized value */
  showSources?: boolean
  /** Source mappings from normalized_mappings table (grouped by normalized_value) */
  sourceMappings?: Map<string, SourceMapping[]> | undefined
  /** Whether to show gap indicators for items without coordinates */
  showGaps?: boolean
  /** Externally controlled expand state */
  isOpen?: boolean | undefined
  /** Callback when header is clicked (for controlled mode) */
  onToggle?: (() => void) | undefined
  /** Override coordinates from geo_overrides, keyed by "category:name" */
  overrideCoords?: Map<string, LatLng> | undefined
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
  showSources = false,
  sourceMappings,
  showGaps = false,
  isOpen,
  onToggle,
  overrideCoords,
}: GeoDetailListProps) {
  const [internalExpanded, setInternalExpanded] = useState(false)
  const isExpanded = isOpen ?? internalExpanded
  const [showAll, setShowAll] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  const displayData = showAll ? data : data.slice(0, initialLimit)
  const hasMore = data.length > initialLimit

  const toggleRowExpansion = (name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

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
                  const isRowExpanded = expandedRows.has(item.name)
                  const sources = showSources ? sourceMappings?.get(item.name) : undefined
                  const hasSources = sources && sources.length > 0

                  return (
                    <Fragment key={item.name}>
                      <tr
                        onClick={
                          category !== 'region'
                            ? () => {
                                onItemClick?.(item.name)
                                onDrilldown?.({
                                  type: category,
                                  value: item.name,
                                  label: item.name,
                                })
                              }
                            : undefined
                        }
                        className={`border-border border-t transition-colors ${category !== 'region' ? 'cursor-pointer' : ''} ${isSelected ? 'bg-primary/10' : category !== 'region' ? 'hover:bg-muted/30' : ''} `}
                      >
                        <td className="text-foreground px-4 py-2">
                          <div className="flex items-center gap-2">
                            {showSources && hasSources && (
                              <button
                                onClick={(e) => toggleRowExpansion(item.name, e)}
                                className="hover:bg-muted rounded p-0.5"
                              >
                                {isRowExpanded ? (
                                  <ChevronDown className="h-3 w-3" />
                                ) : (
                                  <ChevronRight className="h-3 w-3" />
                                )}
                              </button>
                            )}
                            {showSources && !hasSources && <span className="w-4" />}
                            <span>
                              {item.name}
                              {category === 'city' && US_CITY_STATES[item.name] && (
                                <span className="text-muted-foreground">
                                  , {US_CITY_STATES[item.name]}
                                </span>
                              )}
                            </span>
                            {showGaps &&
                              !getLocationCoordsWithOverrides(
                                category,
                                item.name,
                                overrideCoords
                              ) && (
                                <span
                                  data-unmatched
                                  className="h-2 w-2 rounded-full bg-amber-400"
                                  title="Not in canonical US cities list"
                                />
                              )}
                          </div>
                        </td>
                        <td className="text-foreground px-4 py-2 text-right font-medium">
                          {item.count}
                        </td>
                        <td className="text-muted-foreground px-4 py-2 text-right">
                          {item.percentage.toFixed(1)}%
                        </td>
                      </tr>
                      {/* Source rows */}
                      {showSources &&
                        isRowExpanded &&
                        hasSources &&
                        sources.map((source, idx) => (
                          <tr
                            key={`${item.name}-source-${idx}`}
                            className="bg-muted/20 border-border border-t"
                          >
                            <td className="text-muted-foreground py-1.5 pr-4 pl-12 text-xs">
                              <div className="flex items-center gap-1.5">
                                <span className="text-muted-foreground/60">&#8627;</span>
                                <span>{source.original}</span>
                                {source.confidence < 1.0 && (
                                  <span
                                    className="text-amber-500"
                                    title={`Fuzzy match (${Math.round(source.confidence * 100)}% confidence)`}
                                  >
                                    <AlertTriangle className="h-3 w-3" />
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="text-muted-foreground py-1.5 pr-4 text-right text-xs">
                              {source.count}
                            </td>
                            <td />
                          </tr>
                        ))}
                    </Fragment>
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
