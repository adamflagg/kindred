/**
 * ParseAnalysisGroupedList - Simple camper list with field badges
 *
 * Shows campers as clickable rows. Clicking selects a camper to show
 * all their fields in the right panel. No accordion - just selection.
 * Sierra Lodge aesthetic with warm, nature-inspired styling.
 */

import { useMemo } from 'react'
import { Loader2, RefreshCw, Trash2, User } from 'lucide-react'
import { formatSourceField } from './types'
import type { CamperGroupedRequests, FieldParseResult } from './types'

interface ParseAnalysisGroupedListProps {
  items: CamperGroupedRequests[]
  isLoading: boolean
  reparsingCmIds: Set<number>
  clearingCmIds: Set<number>
  onReparseCamper: (cmId: number) => void
  onClearCamper: (cmId: number) => void
  searchQuery: string
  selectedCamperCmId: number | null
  onCamperSelect: (cmId: number) => void
}

// Small badge component showing field type + status dot
function FieldBadge({ field }: { field: FieldParseResult }) {
  const label = formatSourceField(field.source_field)

  const colorClass = (() => {
    switch (field.source_field) {
      case 'bunk_request_form':
        return 'bg-forest-100 text-forest-700 dark:bg-forest-900/40 dark:text-forest-400'
      case 'staff_not_bunk_with':
        return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'
      case 'bunking_notes':
        return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
      case 'internal_notes':
        return 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400'
      default:
        return 'bg-bark-100 text-bark-600 dark:bg-bark-800 dark:text-bark-400'
    }
  })()

  // Status dot: amber=debug, green=production, gray=none
  const statusDot = field.has_debug_result
    ? 'bg-amber-500'
    : field.has_production_result
      ? 'bg-forest-500'
      : 'bg-bark-300'

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-semibold ${colorClass} `}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
      {label}
    </span>
  )
}

export function ParseAnalysisGroupedList({
  items,
  isLoading,
  reparsingCmIds,
  clearingCmIds,
  onReparseCamper,
  onClearCamper,
  searchQuery,
  selectedCamperCmId,
  onCamperSelect,
}: ParseAnalysisGroupedListProps) {
  // Filter by search query (camper name) - memoized for performance
  const filteredItems = useMemo(() => {
    if (!searchQuery) return items
    const query = searchQuery.toLowerCase()
    return items.filter((item) => item.requester_name.toLowerCase().includes(query))
  }, [items, searchQuery])

  if (isLoading) {
    return (
      <div className="card-lodge bg-parchment-100/30 dark:bg-bark-900/20 flex h-64 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="text-forest-600 h-6 w-6 animate-spin" />
          <span className="text-muted-foreground text-sm">Loading requests...</span>
        </div>
      </div>
    )
  }

  if (filteredItems.length === 0) {
    return (
      <div className="card-lodge bg-parchment-100/30 dark:bg-bark-900/20 flex h-64 items-center justify-center">
        <div className="text-muted-foreground flex flex-col items-center gap-4">
          <div className="bg-bark-100 dark:bg-bark-800 flex h-14 w-14 items-center justify-center rounded-2xl">
            <User className="text-bark-400 h-7 w-7" />
          </div>
          <div className="text-center">
            <span className="text-foreground text-sm font-semibold">No results found</span>
            <p className="mt-1 text-xs">Try adjusting your filters</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card-lodge bg-parchment-100/30 dark:bg-bark-900/20 p-2">
      <div className="custom-scrollbar max-h-[700px] space-y-2 overflow-y-auto pr-1">
        {filteredItems.map((camper) => {
          const isSelected = selectedCamperCmId === camper.requester_cm_id
          const isReparsing = reparsingCmIds.has(camper.requester_cm_id)
          const isClearing = clearingCmIds.has(camper.requester_cm_id)
          const hasDebugResults = camper.fields.some((f) => f.has_debug_result)

          return (
            <div
              key={camper.requester_cm_id}
              onClick={() => onCamperSelect(camper.requester_cm_id)}
              className={`cursor-pointer rounded-xl border-2 transition-all duration-200 ${
                isSelected
                  ? 'dark:bg-bark-800 border-forest-300 dark:border-forest-600 ring-forest-500/20 bg-white shadow-sm ring-2'
                  : 'dark:bg-bark-800 hover:border-bark-200 dark:hover:border-bark-600 border-transparent bg-white'
              } `}
            >
              {/* Camper row: name + refresh button on top, badges below */}
              <div className="p-3">
                {/* Top row: name and action buttons */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-foreground font-semibold">{camper.requester_name}</span>
                  <div className="flex items-center gap-1">
                    {/* Clear debug results button - only show if has debug results */}
                    {hasDebugResults && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onClearCamper(camper.requester_cm_id)
                        }}
                        disabled={isClearing || isReparsing}
                        className="text-bark-400 rounded-lg p-1.5 transition-all duration-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-900/20"
                        title="Clear debug results"
                      >
                        {isClearing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    )}
                    {/* Reparse button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onReparseCamper(camper.requester_cm_id)
                      }}
                      disabled={isReparsing || isClearing}
                      className="text-bark-400 hover:text-forest-600 hover:bg-forest-50 dark:hover:bg-forest-900/20 rounded-lg p-1.5 transition-all duration-200 disabled:opacity-50"
                      title="Reparse visible fields"
                    >
                      {isReparsing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Bottom row: field badges */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {camper.fields.map((field) => (
                    <FieldBadge key={field.original_request_id} field={field} />
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
