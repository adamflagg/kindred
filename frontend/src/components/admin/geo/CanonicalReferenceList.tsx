/**
 * CanonicalReferenceList -- Searchable, sortable list of canonical entries.
 *
 * Replaces the old CanonicalBrowser with a compact row layout, sort toggle,
 * lazy-loaded source variants, and [Fix] buttons for fuzzy matches.
 */
import { useState, useMemo } from 'react'
import {
  Search,
  Compass,
  ArrowDownWideNarrow,
  ArrowDownAZ,
  Wrench,
  Check,
  X,
  GitMerge,
} from 'lucide-react'
import { useAllCanonicals, useCanonicalSources } from '../../../hooks/useGeoData'
import type { CanonicalEntry, SourcesResponse } from '../../../services/geoService'
import { sourceLabel, sourceBadgeClasses, formatLocation, type GeoCategory } from '../geoConstants'

export interface CanonicalReferenceListProps {
  category: GeoCategory
  year: number
  onReassignSource: (originalValue: string) => void
  onApprove?: (entry: CanonicalEntry) => void
  onReject?: (entry: CanonicalEntry) => void
  onMerge?: (entry: CanonicalEntry) => void
  approvePending?: boolean | undefined
  rejectPending?: boolean | undefined
}

type SortMode = 'popular' | 'alpha'

export function CanonicalReferenceList({
  category,
  year,
  onReassignSource,
  onApprove,
  onReject,
  onMerge,
  approvePending,
  rejectPending,
}: CanonicalReferenceListProps) {
  const [searchInput, setSearchInput] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('popular')
  const [expandedName, setExpandedName] = useState<string | null>(null)

  const { data, isLoading, isError } = useAllCanonicals(category, year)

  // Client-side filter + sort
  const results = useMemo(() => {
    const all = data?.results ?? []
    const q = searchInput.trim().toLowerCase()

    const filtered = q
      ? all.filter(
          (entry) =>
            entry.canonical_name.toLowerCase().includes(q) ||
            entry.city.toLowerCase().includes(q) ||
            entry.state.toLowerCase().includes(q)
        )
      : all

    const sorted = [...filtered]
    if (sortMode === 'popular') {
      sorted.sort((a, b) => b.camper_count - a.camper_count)
    } else {
      sorted.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name))
    }

    return sorted
  }, [data, searchInput, sortMode])

  function handleToggleExpand(name: string) {
    setExpandedName((prev) => (prev === name ? null : name))
  }

  const hasData = (data?.results ?? []).length > 0

  return (
    <div className="space-y-3">
      {/* Header -- shown when there is data or loading */}
      {(hasData || isLoading) && (
        <div className="bg-forest-500/8 border-forest-500/20 flex items-center gap-2 rounded-xl border px-3 py-2.5">
          <Compass className="text-forest-500 h-4 w-4" />
          <span className="text-foreground text-sm font-medium">Canonical Entries</span>
          {data?.results && (
            <span className="bg-forest-500/15 text-forest-600 rounded-full px-1.5 py-0.5 text-xs">
              {data.results.length}
            </span>
          )}
          <div className="flex-1" />
          {/* Sort toggle */}
          <div className="flex items-center gap-0.5 rounded-md border border-stone-200 dark:border-stone-700">
            <button
              type="button"
              onClick={() => setSortMode('popular')}
              className={`flex items-center gap-1 rounded-l-md px-2 py-1 text-xs transition-colors ${
                sortMode === 'popular'
                  ? 'bg-forest-100 text-forest-700 dark:bg-forest-800 dark:text-forest-300'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ArrowDownWideNarrow className="h-3.5 w-3.5" />
              Popular
            </button>
            <button
              type="button"
              onClick={() => setSortMode('alpha')}
              className={`flex items-center gap-1 rounded-r-md px-2 py-1 text-xs transition-colors ${
                sortMode === 'alpha'
                  ? 'bg-forest-100 text-forest-700 dark:bg-forest-800 dark:text-forest-300'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ArrowDownAZ className="h-3.5 w-3.5" />
              A-Z
            </button>
          </div>
        </div>
      )}

      {/* Search input -- shown when there is data */}
      {hasData && (
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            {searchInput ? (
              <Search className="text-forest-500 dark:text-forest-400 h-4 w-4" />
            ) : (
              <Compass className="h-4 w-4 text-stone-400 dark:text-stone-500" />
            )}
          </div>
          <input
            type="search"
            placeholder="Search entries..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="border-border focus:border-forest-400 focus:ring-forest-400 dark:focus:border-forest-500 dark:focus:ring-forest-500 w-full rounded-lg border bg-white py-2 pr-4 pl-10 text-sm placeholder:text-stone-400 focus:ring-1 focus:outline-none dark:bg-stone-900/30 dark:placeholder:text-stone-500"
          />
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center px-4 py-8">
          <span className="text-muted-foreground text-sm">Loading entries...</span>
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-red-300 bg-red-50/50 px-4 py-8 dark:border-red-800 dark:bg-red-950/20">
          <span className="text-sm text-red-500 dark:text-red-400">Failed to load entries</span>
        </div>
      ) : results.length > 0 ? (
        <div className="space-y-1">
          {results.map((entry) => (
            <CanonicalRow
              key={entry.canonical_name}
              entry={entry}
              category={category}
              year={year}
              isExpanded={expandedName === entry.canonical_name}
              onToggle={() => handleToggleExpand(entry.canonical_name)}
              onReassignSource={onReassignSource}
              onApprove={onApprove}
              onReject={onReject}
              onMerge={onMerge}
              approvePending={approvePending}
              rejectPending={rejectPending}
            />
          ))}
        </div>
      ) : !hasData ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50/50 px-4 py-8 dark:border-stone-600 dark:bg-stone-900/20">
          <span className="text-sm text-stone-500 dark:text-stone-400">
            No entries for this category
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50/50 px-4 py-8 dark:border-stone-600 dark:bg-stone-900/20">
          <span className="text-sm text-stone-500 dark:text-stone-400">No results found</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CanonicalRow -- single collapsed/expanded row
// ---------------------------------------------------------------------------

interface CanonicalRowProps {
  entry: CanonicalEntry
  category: GeoCategory
  year: number
  isExpanded: boolean
  onToggle: () => void
  onReassignSource: (originalValue: string) => void
  onApprove?: ((entry: CanonicalEntry) => void) | undefined
  onReject?: ((entry: CanonicalEntry) => void) | undefined
  onMerge?: ((entry: CanonicalEntry) => void) | undefined
  approvePending?: boolean | undefined
  rejectPending?: boolean | undefined
}

function CanonicalRow({
  entry,
  category,
  year,
  isExpanded,
  onToggle,
  onReassignSource,
  onApprove,
  onReject,
  onMerge,
  approvePending,
  rejectPending,
}: CanonicalRowProps) {
  const { data: sourcesData } = useCanonicalSources(
    category,
    entry.canonical_name,
    year,
    isExpanded
  )

  const dimmed = entry.camper_count === 0

  return (
    <div
      data-testid="canonical-row"
      className={`border-border rounded-md border ${dimmed ? 'opacity-50' : ''}`}
    >
      {/* Collapsed row — the toggle affordance is a real <button> wrapping the
          name/badges (kindred#2063 pattern), not a click handler on this
          `<div>`. The Merge button is a sibling rather than nested inside it,
          since a <button> can't contain another button. */}
      <div className="hover:bg-muted/50 flex w-full items-center gap-2 transition-colors">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2 text-left"
        >
          <span
            data-testid="canonical-name"
            className="text-foreground min-w-0 flex-1 truncate text-sm"
          >
            {entry.canonical_name}
          </span>

          {/* Location badge */}
          {(entry.city || entry.state || entry.country) && (
            <span
              className={`shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-400 ${
                entry.source === 'suggested' ? 'italic' : ''
              }`}
            >
              {formatLocation(entry.city, entry.state, entry.country, entry.canonical_name) ||
                entry.state}
            </span>
          )}

          {/* Source badge */}
          <span
            data-testid="source-badge"
            className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${sourceBadgeClasses(entry.source)}`}
          >
            {sourceLabel(entry.source)}
          </span>
        </button>

        {/* Merge button */}
        {onMerge && (
          <button
            type="button"
            className="text-muted-foreground hover:text-forest-700 hover:bg-forest-100 dark:hover:text-forest-400 dark:hover:bg-forest-800 shrink-0 rounded p-1 transition-colors"
            onClick={() => {
              onMerge(entry)
            }}
            aria-label="Merge canonical"
          >
            <GitMerge className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Camper count */}
        <span className="text-muted-foreground shrink-0 pr-3 text-xs tabular-nums">
          {entry.camper_count}
        </span>
      </div>

      {/* Expanded: source variants */}
      {isExpanded && sourcesData?.sources && (
        <ExpandedSources
          entry={entry}
          sourcesData={sourcesData}
          onReassignSource={onReassignSource}
          onApprove={onApprove}
          onReject={onReject}
          approvePending={approvePending}
          rejectPending={rejectPending}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ExpandedSources -- source variant list inside an expanded row
// ---------------------------------------------------------------------------

interface ExpandedSourcesProps {
  entry: CanonicalEntry
  sourcesData: SourcesResponse
  onReassignSource: (originalValue: string) => void
  onApprove?: ((entry: CanonicalEntry) => void) | undefined
  onReject?: ((entry: CanonicalEntry) => void) | undefined
  approvePending?: boolean | undefined
  rejectPending?: boolean | undefined
}

function ExpandedSources({
  entry,
  sourcesData,
  onReassignSource,
  onApprove,
  onReject,
  approvePending,
  rejectPending,
}: ExpandedSourcesProps) {
  if (!sourcesData.sources.length) return null

  return (
    <div className="border-border border-t px-3 py-2">
      <div className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase">
        Source Variants
      </div>
      <div className="space-y-1">
        {sourcesData.sources.map((src) => {
          const isFuzzy = src.confidence < 1.0
          return (
            <div
              key={src.original_value}
              className="bg-muted/30 flex items-center gap-2 rounded px-3 py-1.5 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">{src.original_value}</span>
              <span className="shrink-0 font-medium">{src.count}</span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {Math.round(src.confidence * 100)}%
              </span>
              {/* State distribution tags */}
              {Object.keys(src.state_distribution).length > 0 && (
                <span className="ml-1.5 text-xs text-stone-400">
                  {Object.entries(src.state_distribution)
                    .sort(([, a], [, b]) => b - a)
                    .map(([st, ct]) => `${st}\u00a0(${ct})`)
                    .join(' \u00b7 ')}
                </span>
              )}
              {isFuzzy && (
                <button
                  type="button"
                  className="text-forest-700 hover:bg-forest-100 dark:text-forest-400 dark:hover:bg-forest-800 ml-1 flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors"
                  onClick={(e) => {
                    e.stopPropagation()
                    onReassignSource(src.original_value)
                  }}
                >
                  <Wrench className="h-3 w-3" />
                  Fix
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Approve/Reject for suggested canonicals */}
      {entry.source === 'suggested' && (
        <div className="mt-2 flex items-center gap-2 border-t border-stone-100 pt-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onApprove?.(entry)
            }}
            disabled={approvePending}
            className="bg-forest-600 hover:bg-forest-700 flex items-center gap-1 rounded px-2.5 py-1 text-xs text-white disabled:opacity-50"
            aria-label="Approve suggested canonical"
          >
            <Check className="h-3 w-3" />
            {approvePending ? 'Approving...' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onReject?.(entry)
            }}
            disabled={rejectPending}
            className="flex items-center gap-1 rounded bg-red-50 px-2.5 py-1 text-xs text-red-600 hover:bg-red-100 disabled:opacity-50"
            aria-label="Reject suggested canonical"
          >
            <X className="h-3 w-3" />
            {rejectPending ? 'Rejecting...' : 'Reject'}
          </button>
          {(entry.city || entry.state || entry.country) && (
            <span className="text-xs text-stone-400 italic">
              Inferred: {formatLocation(entry.city, entry.state, entry.country)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
