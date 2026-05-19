/**
 * PipelineBatchList - Summary table for pipeline debug batch overview.
 *
 * Receives the full row set for a run in `items` and performs all filtering,
 * sorting and searching in-memory. The search input is local-only and never
 * triggers a network round-trip. Scrolling is virtualized with
 * `useVirtualTable` so thousands of rows stay smooth.
 *
 * Columns: camper name, target name, source field, status, disposition/
 * reason, confidence, resolution method, Phase 3 triggered, AI reasoning.
 * Status / disposition / confidence are color-coded.
 */

import { useMemo, useState } from 'react'
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Loader2, Search } from 'lucide-react'
import type { PipelineSummaryItem, PipelineSummaryFilters } from './types'
import { formatSourceField } from '../../utils/formatSourceField'
import { getSourceFieldClasses } from '../../utils/sourceFieldColors'
import {
  getDispositionClasses,
  getStatusClasses,
  getConfidenceClasses,
} from '../../utils/dispositionColors'
import { useVirtualTable } from '../../hooks/useVirtualTable'

/** Fixed height for the virtualized scroll viewport. */
const VIRTUAL_VIEWPORT_HEIGHT = 696

/** Column definitions for sortable headers. */
const SORTABLE_COLUMNS: Array<{
  label: string
  field: keyof PipelineSummaryItem
  hiddenClass?: string
}> = [
  { label: 'Camper', field: 'requester_name' },
  { label: 'Target', field: 'target_name' },
  { label: 'Source', field: 'source_field' },
  { label: 'Status', field: 'final_status' },
  { label: 'Reason', field: 'disposition_reason' },
  { label: 'Confidence', field: 'final_confidence' },
  { label: 'Method', field: 'resolution_method' },
  { label: 'P3', field: 'phase3_triggered' },
  { label: 'Reasoning', field: 'ai_reasoning_summary', hiddenClass: 'hidden lg:block' },
]

/** Shared CSS grid template for header + rows so columns stay aligned.
 *  Small screens: 8 columns (Reasoning cell uses `hidden`, removed from flow).
 *  lg+: 9 columns including Reasoning. */
const PIPELINE_GRID_COLS =
  'grid-cols-[minmax(120px,1.5fr)_minmax(120px,1.5fr)_130px_90px_140px_80px_minmax(110px,1fr)_56px] ' +
  'lg:grid-cols-[minmax(120px,1.5fr)_minmax(120px,1.5fr)_130px_90px_140px_80px_minmax(110px,1fr)_56px_minmax(140px,2fr)]'

/** Local sort state: field + direction. */
type SortState = { field: keyof PipelineSummaryItem; desc: boolean } | null

interface PipelineBatchListProps {
  /** ALL rows for the selected run. Filtering/sorting/search happen client-side. */
  items: PipelineSummaryItem[]
  /**
   * Server-roundtrip filters (status, source_field, session, etc.) — still
   * applied client-side but owned by the parent so state survives nav. The
   * `search` / `page` / `sort` / `per_page` fields are no longer used and are
   * tolerated for backward compatibility.
   */
  filters: PipelineSummaryFilters
  onFiltersChange: (filters: PipelineSummaryFilters) => void
  onRowClick: (traceId: string) => void
  isLoading: boolean
  error?: Error | null
}

export function PipelineBatchList({
  items,
  filters,
  onFiltersChange,
  onRowClick,
  isLoading,
  error,
}: PipelineBatchListProps) {
  // Local, never-leaves-the-component search text — no debounce, no min char.
  const [searchText, setSearchText] = useState('')

  // Local sort state — initialized from filters.sort for back-compat, but
  // all toggles stay client-side (never calls onFiltersChange).
  const [sort, setSort] = useState<SortState>(() => parseSortFilter(filters.sort))

  /** Update a single filter value and notify parent. */
  function updateFilter<K extends keyof PipelineSummaryFilters>(
    key: K,
    value: PipelineSummaryFilters[K]
  ) {
    onFiltersChange({ ...filters, [key]: value })
  }

  /** Toggle sort on a column: none → asc → desc → none. */
  function toggleSort(field: keyof PipelineSummaryItem) {
    setSort((current) => {
      if (current?.field !== field) return { field, desc: false }
      if (!current.desc) return { field, desc: true }
      return null
    })
  }

  // Apply all filters + search + sort client-side over the full in-memory list.
  const visibleItems = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    const filtered = items.filter((item) => {
      if (
        q &&
        !item.requester_name.toLowerCase().includes(q) &&
        !item.target_name.toLowerCase().includes(q)
      ) {
        return false
      }
      if (filters.final_status && item.final_status !== filters.final_status) return false
      if (filters.source_field && item.source_field !== filters.source_field) return false
      if (filters.resolution_method && item.resolution_method !== filters.resolution_method) {
        return false
      }
      if (filters.session_cm_id !== undefined && item.session_cm_id !== filters.session_cm_id) {
        return false
      }
      if (
        filters.phase3_triggered !== undefined &&
        item.phase3_triggered !== filters.phase3_triggered
      ) {
        return false
      }
      if (filters.pre_p1_action && item.pre_p1_action !== filters.pre_p1_action) return false
      if (filters.min_confidence !== undefined && item.final_confidence < filters.min_confidence) {
        return false
      }
      if (filters.max_confidence !== undefined && item.final_confidence > filters.max_confidence) {
        return false
      }
      return true
    })

    if (!sort) return filtered
    const { field, desc } = sort
    return [...filtered].sort((a, b) => {
      const cmp = compareValues(a[field], b[field])
      return desc ? -cmp : cmp
    })
  }, [items, filters, searchText, sort])

  // Always instantiate the virtualizer (hooks order must be stable). It's
  // fine if the result isn't rendered because of loading/empty/error states.
  const { parentRef, rowVirtualizer } = useVirtualTable({
    data: visibleItems,
    height: VIRTUAL_VIEWPORT_HEIGHT,
    rowHeightPreset: 'compact',
    overscan: 15,
  })

  if (isLoading) {
    return (
      <div className="card-lodge bg-parchment-100/30 dark:bg-bark-900/20 flex h-64 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="text-forest-600 h-6 w-6 animate-spin" />
          <span className="text-muted-foreground text-sm">Loading summary data...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card-lodge bg-parchment-100/30 dark:bg-bark-900/20 flex h-48 flex-col items-center justify-center gap-3">
        <AlertCircle className="h-8 w-8 text-red-500" />
        <p className="text-sm text-red-700 dark:text-red-300">Failed to load pipeline data</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="card-lodge bg-parchment-100/30 dark:bg-bark-900/20 p-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Name search */}
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search names..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="border-bark-300 bg-parchment-50 text-foreground dark:border-bark-600 dark:bg-bark-800 w-52 rounded-md border py-1 pr-2 pl-7 text-xs focus:ring-1 focus:ring-amber-500/50 focus:outline-none"
            />
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="filter-status" className="text-muted-foreground text-xs font-medium">
              Status
            </label>
            <select
              id="filter-status"
              value={filters.final_status ?? ''}
              onChange={(e) => updateFilter('final_status', e.target.value || undefined)}
              className="border-bark-300 bg-parchment-50 text-foreground dark:border-bark-600 dark:bg-bark-800 rounded-md border px-2 py-1 text-xs focus:ring-1 focus:ring-amber-500/50 focus:outline-none"
            >
              <option value="">All</option>
              <option value="RESOLVED">Resolved</option>
              <option value="PENDING">Pending</option>
              <option value="DECLINED">Declined</option>
            </select>
          </div>

          {/* Source field filter */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="filter-source" className="text-muted-foreground text-xs font-medium">
              Source
            </label>
            <select
              id="filter-source"
              value={filters.source_field ?? ''}
              onChange={(e) => updateFilter('source_field', e.target.value || undefined)}
              className="border-bark-300 bg-parchment-50 text-foreground dark:border-bark-600 dark:bg-bark-800 rounded-md border px-2 py-1 text-xs focus:ring-1 focus:ring-amber-500/50 focus:outline-none"
            >
              <option value="">All</option>
              <option value="bunk_request_form">{formatSourceField('bunk_request_form')}</option>
              <option value="staff_not_bunk_with">
                {formatSourceField('staff_not_bunk_with')}
              </option>
              <option value="bunking_notes">{formatSourceField('bunking_notes')}</option>
              <option value="internal_notes">{formatSourceField('internal_notes')}</option>
              <option value="socialize_with">{formatSourceField('socialize_with')}</option>
            </select>
          </div>

          {/* Resolution method filter */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="filter-method" className="text-muted-foreground text-xs font-medium">
              Method
            </label>
            <select
              id="filter-method"
              value={filters.resolution_method ?? ''}
              onChange={(e) => updateFilter('resolution_method', e.target.value || undefined)}
              className="border-bark-300 bg-parchment-50 text-foreground dark:border-bark-600 dark:bg-bark-800 rounded-md border px-2 py-1 text-xs focus:ring-1 focus:ring-amber-500/50 focus:outline-none"
            >
              <option value="">All</option>
              <option value="exact_match">Exact Match</option>
              <option value="fuzzy_match">Fuzzy Match</option>
              <option value="phonetic_match">Phonetic Match</option>
              <option value="school_disambiguation">School</option>
              <option value="prior_bunkmate_exact">Prior Bunkmate (exact)</option>
              <option value="prior_bunkmate_first_name">Prior Bunkmate (first)</option>
              <option value="ai_id_validated">AI ID Validated</option>
              <option value="ai_candidate_disambiguated">AI Candidate</option>
              <option value="ai_disambiguation">AI Disambiguation</option>
              <option value="social_graph_auto">Social Graph</option>
              <option value="age_preference">Age Preference</option>
              <option value="staff_filtered">Staff Filtered</option>
              <option value="placeholder">Placeholder</option>
              <option value="unresolved">Unresolved</option>
            </select>
          </div>

          {/* Phase 3 triggered filter */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="filter-phase3" className="text-muted-foreground text-xs font-medium">
              Phase 3
            </label>
            <select
              id="filter-phase3"
              value={filters.phase3_triggered === undefined ? '' : String(filters.phase3_triggered)}
              onChange={(e) => {
                const val = e.target.value
                updateFilter('phase3_triggered', val === '' ? undefined : val === 'true')
              }}
              className="border-bark-300 bg-parchment-50 text-foreground dark:border-bark-600 dark:bg-bark-800 rounded-md border px-2 py-1 text-xs focus:ring-1 focus:ring-amber-500/50 focus:outline-none"
            >
              <option value="">All</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>

          {/* Confidence range filters */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="filter-min-conf" className="text-muted-foreground text-xs font-medium">
              Confidence
            </label>
            <input
              id="filter-min-conf"
              type="number"
              min="0"
              max="1"
              step="0.05"
              placeholder="Min"
              value={filters.min_confidence ?? ''}
              onChange={(e) =>
                updateFilter(
                  'min_confidence',
                  e.target.value === '' ? undefined : Number(e.target.value)
                )
              }
              className="border-bark-300 bg-parchment-50 text-foreground dark:border-bark-600 dark:bg-bark-800 w-16 rounded-md border px-2 py-1 text-xs focus:ring-1 focus:ring-amber-500/50 focus:outline-none"
            />
            <span className="text-muted-foreground text-xs">-</span>
            <input
              id="filter-max-conf"
              type="number"
              min="0"
              max="1"
              step="0.05"
              placeholder="Max"
              value={filters.max_confidence ?? ''}
              onChange={(e) =>
                updateFilter(
                  'max_confidence',
                  e.target.value === '' ? undefined : Number(e.target.value)
                )
              }
              className="border-bark-300 bg-parchment-50 text-foreground dark:border-bark-600 dark:bg-bark-800 w-16 rounded-md border px-2 py-1 text-xs focus:ring-1 focus:ring-amber-500/50 focus:outline-none"
            />
          </div>

          {/* Result count */}
          <div className="text-muted-foreground ml-auto text-xs">
            {visibleItems.length} {visibleItems.length === 1 ? 'result' : 'results'}
            {visibleItems.length !== items.length && (
              <span className="text-muted-foreground/70"> of {items.length}</span>
            )}
          </div>
        </div>
      </div>

      {/* Grid-based virtualized list (not HTML table — avoids table/tbody
          display-mode foot-guns when combined with absolute-positioned rows). */}
      {visibleItems.length === 0 ? (
        <div className="card-lodge bg-parchment-100/30 dark:bg-bark-900/20 flex h-48 flex-col items-center justify-center gap-3">
          <Search className="text-bark-400 h-8 w-8" />
          <p className="text-muted-foreground text-sm">No results found. Try adjusting filters.</p>
        </div>
      ) : (
        <div className="card-lodge overflow-hidden">
          <div
            ref={parentRef}
            className="overflow-auto"
            style={{ height: `${VIRTUAL_VIEWPORT_HEIGHT}px` }}
          >
            {/* Sticky header row */}
            <div
              role="row"
              className={`bg-bark-50 dark:bg-bark-800/50 border-bark-200 dark:border-bark-700 sticky top-0 z-10 grid border-b ${PIPELINE_GRID_COLS}`}
            >
              {SORTABLE_COLUMNS.map((col) => {
                const isActive = sort?.field === col.field
                const isDesc = isActive && sort.desc
                return (
                  <div
                    key={col.field}
                    role="columnheader"
                    tabIndex={0}
                    aria-sort={isActive ? (sort?.desc ? 'descending' : 'ascending') : undefined}
                    onClick={() => toggleSort(col.field)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleSort(col.field)
                      }
                    }}
                    className={`text-muted-foreground hover:text-foreground group focus-visible:ring-forest-500 cursor-pointer px-3 py-2 text-left text-xs font-medium select-none focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset ${col.hiddenClass ?? ''}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {isActive ? (
                        isDesc ? (
                          <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUp className="h-3 w-3" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                      )}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Virtualized body — a relatively-positioned spacer whose height
                represents all rows; each row is absolutely positioned. */}
            <div
              role="rowgroup"
              className="divide-bark-100 dark:divide-bark-700/50 relative"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const item = visibleItems[virtualRow.index]
                if (!item) return null
                return (
                  <div
                    key={item.id}
                    role="row"
                    tabIndex={0}
                    data-index={virtualRow.index}
                    onClick={() => onRowClick(item.trace_id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onRowClick(item.trace_id)
                      }
                    }}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className={`hover:bg-parchment-100/50 dark:hover:bg-bark-800/30 focus-visible:ring-forest-500 border-bark-100 dark:border-bark-700/50 grid cursor-pointer items-center border-b transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset ${PIPELINE_GRID_COLS}`}
                  >
                    <div className="text-foreground truncate px-3 py-2 text-sm font-medium">
                      {item.requester_name}
                    </div>
                    <div className="text-foreground truncate px-3 py-2 text-sm">
                      {item.target_name}
                    </div>
                    <div className="px-3 py-2">
                      <span
                        className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${getSourceFieldClasses(item.source_field)}`}
                      >
                        {formatSourceField(item.source_field)}
                      </span>
                    </div>
                    <div className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${getStatusClasses(item.final_status)}`}
                      >
                        {item.final_status}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 px-3 py-2">
                      {item.disposition_reason ? (
                        <span
                          className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${getDispositionClasses(item.disposition_reason)}`}
                        >
                          {item.disposition_reason}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">{'\u2014'}</span>
                      )}
                      {item.is_reciprocal && (
                        <span className="rounded bg-sky-100 px-1 py-0.5 text-[9px] font-bold text-sky-700 dark:bg-sky-900/40 dark:text-sky-400">
                          Recip
                        </span>
                      )}
                    </div>
                    <div className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${getConfidenceClasses(item.final_confidence)}`}
                      >
                        {item.final_confidence.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-muted-foreground truncate px-3 py-2 text-xs">
                      {item.resolution_method || '\u2014'}
                    </div>
                    <div className="px-3 py-2 text-xs">
                      {item.phase3_triggered ? (
                        <span className="font-medium text-amber-600 dark:text-amber-400">Yes</span>
                      ) : (
                        <span className="text-muted-foreground">No</span>
                      )}
                    </div>
                    <div className="text-muted-foreground hidden truncate px-3 py-2 text-xs lg:block">
                      {item.ai_reasoning_summary || '\u2014'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Parse a PB-style sort string (e.g. "-final_confidence") into local SortState. */
function parseSortFilter(sort?: string): SortState {
  if (!sort) return null
  const desc = sort.startsWith('-')
  const field = sort.startsWith('-') || sort.startsWith('+') ? sort.slice(1) : sort
  // Best-effort narrow to a known PipelineSummaryItem key
  return { field: field as keyof PipelineSummaryItem, desc }
}

/** Compare two values of possibly heterogeneous types for sort. */
function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    if (a === b) return 0
    return a ? -1 : 1
  }
  return String(a).localeCompare(String(b))
}
