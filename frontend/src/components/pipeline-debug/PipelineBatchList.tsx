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
const VIRTUAL_VIEWPORT_HEIGHT = 600

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
  { label: 'Reasoning', field: 'ai_reasoning_summary', hiddenClass: 'hidden lg:table-cell' },
]

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
    let out = items

    // Search (case-insensitive, requester_name OR target_name)
    const q = searchText.trim().toLowerCase()
    if (q) {
      out = out.filter(
        (item) =>
          item.requester_name.toLowerCase().includes(q) ||
          item.target_name.toLowerCase().includes(q)
      )
    }

    // Structural filters (previously server-side)
    if (filters.final_status) {
      out = out.filter((item) => item.final_status === filters.final_status)
    }
    if (filters.source_field) {
      out = out.filter((item) => item.source_field === filters.source_field)
    }
    if (filters.resolution_method) {
      out = out.filter((item) => item.resolution_method === filters.resolution_method)
    }
    if (filters.session_cm_id !== undefined) {
      out = out.filter((item) => item.session_cm_id === filters.session_cm_id)
    }
    if (filters.phase3_triggered !== undefined) {
      out = out.filter((item) => item.phase3_triggered === filters.phase3_triggered)
    }
    if (filters.pre_p1_action) {
      out = out.filter((item) => item.pre_p1_action === filters.pre_p1_action)
    }
    if (filters.min_confidence !== undefined) {
      const min = filters.min_confidence
      out = out.filter((item) => item.final_confidence >= min)
    }
    if (filters.max_confidence !== undefined) {
      const max = filters.max_confidence
      out = out.filter((item) => item.final_confidence <= max)
    }

    // Sort
    if (sort) {
      const { field, desc } = sort
      out = [...out].sort((a, b) => {
        const av = a[field]
        const bv = b[field]
        const cmp = compareValues(av, bv)
        return desc ? -cmp : cmp
      })
    }

    return out
  }, [items, filters, searchText, sort])

  // Always instantiate the virtualizer (hooks order must be stable). It's
  // fine if the result isn't rendered because of loading/empty/error states.
  const { parentRef, rowVirtualizer } = useVirtualTable({
    data: visibleItems,
    height: VIRTUAL_VIEWPORT_HEIGHT,
    rowHeightPreset: 'normal',
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
              <option value="bunk_with">Bunk With</option>
              <option value="not_bunk_with">Not Bunk With</option>
              <option value="bunking_notes">Bunking Notes</option>
              <option value="internal_notes">Internal Notes</option>
              <option value="socialize_with">Socialize With</option>
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
              <option value="prior_year_bunkmate">Prior Year Bunkmate</option>
              <option value="sibling_household_lookup">Sibling Lookup</option>
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

      {/* Table */}
      {visibleItems.length === 0 ? (
        <div className="card-lodge bg-parchment-100/30 dark:bg-bark-900/20 flex h-48 flex-col items-center justify-center gap-3">
          <Search className="text-bark-400 h-8 w-8" />
          <p className="text-muted-foreground text-sm">No results found. Try adjusting filters.</p>
        </div>
      ) : (
        <div className="card-lodge overflow-hidden">
          {/* Single table with sticky header; the scroll parent is the div. */}
          <div
            ref={parentRef}
            className="overflow-auto"
            style={{ height: `${VIRTUAL_VIEWPORT_HEIGHT}px` }}
          >
            <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
              <thead className="bg-bark-50 dark:bg-bark-800/50 sticky top-0 z-10">
                <tr className="border-bark-200 dark:border-bark-700 border-b">
                  {SORTABLE_COLUMNS.map((col) => {
                    const isActive = sort?.field === col.field
                    const isDesc = isActive && sort.desc
                    return (
                      <th
                        key={col.field}
                        tabIndex={0}
                        aria-sort={
                          sort?.field === col.field
                            ? sort.desc
                              ? 'descending'
                              : 'ascending'
                            : undefined
                        }
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
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody
                className="divide-bark-100 dark:divide-bark-700/50 relative divide-y"
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  display: 'block',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const item = visibleItems[virtualRow.index]
                  if (!item) return null
                  return (
                    <tr
                      key={item.id}
                      tabIndex={0}
                      role="button"
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
                        display: 'table',
                        tableLayout: 'fixed',
                      }}
                      className="hover:bg-parchment-100/50 dark:hover:bg-bark-800/30 focus-visible:ring-forest-500 cursor-pointer transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
                    >
                      <td className="text-foreground px-3 py-2 font-medium">
                        {item.requester_name}
                      </td>
                      <td className="text-foreground px-3 py-2">{item.target_name}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${getSourceFieldClasses(item.source_field)}`}
                        >
                          {formatSourceField(item.source_field)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${getStatusClasses(item.final_status)}`}
                        >
                          {item.final_status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1">
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
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${getConfidenceClasses(item.final_confidence)}`}
                        >
                          {item.final_confidence.toFixed(2)}
                        </span>
                      </td>
                      <td className="text-muted-foreground px-3 py-2 text-xs">
                        {item.resolution_method || '\u2014'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {item.phase3_triggered ? (
                          <span className="font-medium text-amber-600 dark:text-amber-400">
                            Yes
                          </span>
                        ) : (
                          <span className="text-muted-foreground">No</span>
                        )}
                      </td>
                      <td className="text-muted-foreground hidden max-w-[200px] truncate px-3 py-2 text-xs lg:table-cell">
                        {item.ai_reasoning_summary || '\u2014'}
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
    return a === b ? 0 : a ? -1 : 1
  }
  return String(a).localeCompare(String(b))
}
