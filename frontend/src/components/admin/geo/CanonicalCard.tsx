/**
 * CanonicalCard — Expandable card for a canonical entry.
 *
 * Displays canonical name, city/state, source badge, and in-use indicator.
 * When expanded, shows source list with reassign buttons and merge/edit actions.
 * Earthy source badges: forest green for NCES/PSS, amber for SimpleMaps,
 * warm brown/stone for Manual.
 */
import { ChevronDown, ChevronRight, Users, Pencil, GitMerge, ArrowRightLeft } from 'lucide-react'
import { useCanonicalSources } from '../../../hooks/useGeoData'
import type { CanonicalEntry } from '../../../services/geoService'
import type { GeoCategory } from '../geoConstants'

export interface CanonicalCardProps {
  entry: CanonicalEntry
  category: GeoCategory
  year: number
  isExpanded: boolean
  onToggleExpand: () => void
  onReassignSource?: (originalValue: string) => void
  onMerge?: (canonicalName: string) => void
}

/** Map source to display label. */
function sourceLabel(source: string): string {
  switch (source) {
    case 'nces':
      return 'NCES'
    case 'pss':
      return 'PSS'
    case 'simplemaps':
      return 'SimpleMaps'
    case 'curated':
      return 'Curated'
    case 'manual':
      return 'Manual'
    default:
      return source
  }
}

/** Map source to Tailwind badge classes (earthy palette). */
function sourceBadgeClasses(source: string): string {
  switch (source) {
    case 'nces':
    case 'pss':
      // Forest green for government datasets
      return 'bg-forest-100 text-forest-700 dark:bg-forest-800 dark:text-forest-300'
    case 'simplemaps':
      // Amber for geographic datasets
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
    case 'manual':
    case 'curated':
      // Warm brown/stone for manual entries
      return 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300'
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  }
}

export function CanonicalCard({
  entry,
  category,
  year,
  isExpanded,
  onToggleExpand,
  ...optionalProps
}: CanonicalCardProps): React.ReactNode {
  const { onReassignSource, onMerge } = optionalProps
  const { data: sourcesData } = useCanonicalSources(
    category,
    entry.canonical_name,
    year,
    isExpanded
  )

  const isManual = entry.source === 'manual'

  return (
    <div className="card-lodge border-forest-200 dark:border-forest-700 overflow-hidden">
      {/* Header — always visible */}
      <button
        type="button"
        className="hover:bg-forest-50 dark:hover:bg-forest-900/20 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
        onClick={onToggleExpand}
      >
        {isExpanded ? (
          <ChevronDown className="text-forest-600 dark:text-forest-400 h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="text-forest-600 dark:text-forest-400 h-4 w-4 shrink-0" />
        )}

        <span className="font-display min-w-0 flex-1 truncate text-sm font-medium">
          {entry.canonical_name}
        </span>

        {/* City/State badge */}
        {entry.city && entry.state && (
          <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-400">
            {entry.city}, {entry.state}
          </span>
        )}

        {/* Source badge */}
        <span
          data-testid="source-badge"
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${sourceBadgeClasses(entry.source)}`}
        >
          {sourceLabel(entry.source)}
        </span>

        {/* In-use indicator */}
        {entry.camper_count > 0 && (
          <span
            data-testid="in-use-indicator"
            className="flex shrink-0 items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
          >
            <Users className="h-3 w-3" />
            {entry.camper_count}
          </span>
        )}
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div className="border-forest-200 bg-forest-50/30 dark:border-forest-700 dark:bg-forest-900/10 border-t px-4 py-3">
          {/* Source list */}
          {sourcesData?.sources && sourcesData.sources.length > 0 && (
            <div className="mb-3 space-y-1.5">
              <div className="text-xs font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400">
                Source Variants
              </div>
              {sourcesData.sources.map((src) => (
                <div
                  key={src.original_value}
                  className="dark:bg-forest-900/20 flex items-center gap-2 rounded bg-white/60 px-3 py-1.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">{src.original_value}</span>
                  <span className="shrink-0 font-medium">{src.count}</span>
                  <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">
                    {Math.round(src.confidence * 100)}%
                  </span>
                  {onReassignSource && (
                    <button
                      type="button"
                      className="text-forest-700 hover:bg-forest-100 dark:text-forest-400 dark:hover:bg-forest-800 ml-1 flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors"
                      onClick={() => onReassignSource(src.original_value)}
                    >
                      <ArrowRightLeft className="h-3 w-3" />
                      Reassign
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {onMerge && (
              <button
                type="button"
                className="text-forest-700 hover:bg-forest-100 dark:text-forest-400 dark:hover:bg-forest-800 flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium transition-colors"
                onClick={() => onMerge(entry.canonical_name)}
              >
                <GitMerge className="h-3.5 w-3.5" />
                Merge into another
              </button>
            )}
            {isManual && (
              <button
                type="button"
                className="flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default CanonicalCard
