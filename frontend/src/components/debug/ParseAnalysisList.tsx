/**
 * ParseAnalysisList - Left panel with requester list and selection
 *
 * Shows a scrollable list of original requests with their parse status.
 * Each row has a per-row reprocess button and badges showing data source.
 * Sierra Lodge aesthetic with warm, nature-inspired styling.
 */

import { Database, FlaskConical, Loader2, RefreshCw, User } from 'lucide-react'
import { formatSourceField } from './types'
import type { OriginalRequestWithStatus } from './types'
import { SourceField } from '../../types/sourceField'

interface ParseAnalysisListProps {
  items: OriginalRequestWithStatus[]
  selectedId: string | null
  onSelect: (item: OriginalRequestWithStatus) => void
  onReparse: (item: OriginalRequestWithStatus) => void
  reparsingIds: Set<string>
  isLoading?: boolean
}

export function ParseAnalysisList({
  items,
  selectedId,
  onSelect,
  onReparse,
  reparsingIds,
  isLoading,
}: ParseAnalysisListProps) {
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

  if (items.length === 0) {
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
      <div className="custom-scrollbar max-h-[600px] space-y-1.5 overflow-y-auto pr-1">
        {items.map((item) => {
          const isSelected = item.id === selectedId
          const isReparsing = reparsingIds.has(item.id)
          const sourceLabel = item.source_field ? formatSourceField(item.source_field) : 'Unknown'

          // Determine parse status for badge
          const hasAnyResult = item.has_debug_result || item.has_production_result

          return (
            <div
              key={item.id}
              className={`group relative flex items-center gap-3 rounded-xl border-2 p-3 transition-all duration-200 ${
                isSelected
                  ? 'bg-forest-50 dark:bg-forest-900/30 border-forest-300 dark:border-forest-700 shadow-sm'
                  : 'dark:bg-bark-800 hover:bg-parchment-200/70 dark:hover:bg-bark-700/50 hover:border-bark-200 dark:hover:border-bark-600 border-transparent bg-white'
              } `}
            >
              {/* Selection lives on a real <button> around the indicator +
                  content (kindred#2063 pattern) rather than a click handler on
                  the row `<div>` — the Reparse button is a sibling, not
                  nested inside it, since a <button> can't contain another
                  button. */}
              <button
                type="button"
                onClick={() => onSelect(item)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
              >
                {/* Selection indicator */}
                <div
                  className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200 ${isSelected ? 'border-forest-500 bg-forest-500' : 'border-bark-300 dark:border-bark-600'} `}
                >
                  {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground truncate font-medium">
                      {item.requester_name ?? 'Unknown'}
                    </span>
                    {/* Parse status badge */}
                    {item.has_debug_result ? (
                      <span
                        className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                        title="Debug result available"
                      >
                        <FlaskConical className="h-2.5 w-2.5" />
                      </span>
                    ) : item.has_production_result ? (
                      <span
                        className="bg-forest-100 text-forest-700 dark:bg-forest-900/40 dark:text-forest-400 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        title="Production result available"
                      >
                        <Database className="h-2.5 w-2.5" />
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ${item.source_field === SourceField.BUNK_REQUEST_FORM ? 'bg-forest-100 text-forest-700 dark:bg-forest-900/40 dark:text-forest-400' : ''} ${item.source_field === SourceField.STAFF_NOT_BUNK_WITH ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400' : ''} ${item.source_field === SourceField.BUNKING_NOTES ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' : ''} ${item.source_field === SourceField.INTERNAL_NOTES ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400' : ''} `}
                    >
                      {sourceLabel}
                    </span>
                    {!hasAnyResult && (
                      <span className="text-muted-foreground text-xs italic">Not parsed</span>
                    )}
                  </div>
                </div>
              </button>

              {/* Reparse button */}
              <button
                onClick={() => onReparse(item)}
                disabled={isReparsing}
                className={`flex-shrink-0 rounded-lg p-2 transition-all duration-200 ${
                  isReparsing
                    ? 'bg-forest-100 dark:bg-forest-900/30'
                    : 'bg-bark-100 dark:bg-bark-700 hover:bg-forest-100 dark:hover:bg-forest-900/30 opacity-0 group-hover:opacity-100'
                } `}
                title="Reparse this request"
              >
                {isReparsing ? (
                  <Loader2 className="text-forest-600 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="text-forest-600 h-4 w-4" />
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
