/**
 * PipelineBatchList - Summary table for pipeline debug batch overview.
 *
 * Displays a table of summary rows with columns for camper name, target name,
 * source field, status, confidence, resolution method, Phase 3 triggered, and
 * AI reasoning excerpt. Includes filters for status, source field, resolution
 * method, confidence range, session, and Phase 3. Color coding for status
 * (green/amber/red) and confidence (gradient by value). Click row navigates
 * to drill-down.
 */

import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Loader2, Search } from 'lucide-react'
import type { PipelineSummaryItem, PipelineSummaryFilters } from './types'
import { formatSourceField } from '../../utils/formatSourceField'

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
  { label: 'Confidence', field: 'final_confidence' },
  { label: 'Method', field: 'resolution_method' },
  { label: 'P3', field: 'phase3_triggered' },
  { label: 'Reasoning', field: 'ai_reasoning_summary', hiddenClass: 'hidden lg:table-cell' },
]

/** Parse PocketBase sort string (e.g. "-final_confidence") into field + direction. */
function parseSort(sort?: string): { field: string; desc: boolean } | null {
  if (!sort) return null
  if (sort.startsWith('-')) return { field: sort.slice(1), desc: true }
  if (sort.startsWith('+')) return { field: sort.slice(1), desc: false }
  return { field: sort, desc: false }
}

interface PipelineBatchListProps {
  items: PipelineSummaryItem[]
  total: number
  filters: PipelineSummaryFilters
  onFiltersChange: (filters: PipelineSummaryFilters) => void
  onRowClick: (traceId: string) => void
  isLoading: boolean
  error?: Error | null
}

/** Get Tailwind classes for status badge color coding. */
function getStatusClasses(status: string): string {
  switch (status.toUpperCase()) {
    case 'RESOLVED':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
    case 'PENDING':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
    case 'DECLINED':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'
    default:
      return 'bg-bark-100 text-bark-600 dark:bg-bark-700 dark:text-bark-300'
  }
}

/** Get Tailwind classes for confidence value color coding. */
function getConfidenceClasses(confidence: number): string {
  if (confidence >= 0.85) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
  }
  if (confidence >= 0.7) {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
  }
  return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'
}

/** Get Tailwind classes for source field badge. */
function getSourceFieldClasses(field: string): string {
  switch (field) {
    case 'bunk_with':
      return 'bg-forest-100 text-forest-700 dark:bg-forest-900/40 dark:text-forest-400'
    case 'not_bunk_with':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'
    case 'bunking_notes':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
    case 'internal_notes':
      return 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400'
    case 'socialize_with':
      return 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400'
    default:
      return 'bg-bark-100 text-bark-600 dark:bg-bark-800 dark:text-bark-400'
  }
}

export function PipelineBatchList({
  items,
  total,
  filters,
  onFiltersChange,
  onRowClick,
  isLoading,
  error,
}: PipelineBatchListProps) {
  /** Update a single filter value and notify parent. */
  function updateFilter<K extends keyof PipelineSummaryFilters>(
    key: K,
    value: PipelineSummaryFilters[K]
  ) {
    onFiltersChange({ ...filters, [key]: value })
  }

  /** Toggle sort on a column: none → asc → desc → none. */
  function toggleSort(field: string) {
    const current = parseSort(filters.sort)
    let next: string | undefined
    if (current?.field !== field) {
      next = field // ascending (no prefix)
    } else if (!current.desc) {
      next = `-${field}` // descending
    } else {
      next = undefined // clear sort
    }
    updateFilter('sort', next)
  }

  const currentSort = parseSort(filters.sort)

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
            {total} {total === 1 ? 'result' : 'results'}
          </div>
        </div>
      </div>

      {/* Table */}
      {items.length === 0 ? (
        <div className="card-lodge bg-parchment-100/30 dark:bg-bark-900/20 flex h-48 flex-col items-center justify-center gap-3">
          <Search className="text-bark-400 h-8 w-8" />
          <p className="text-muted-foreground text-sm">No results found. Try adjusting filters.</p>
        </div>
      ) : (
        <div className="card-lodge overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-bark-200 dark:border-bark-700 bg-bark-50 dark:bg-bark-800/50 border-b">
                  {SORTABLE_COLUMNS.map((col) => {
                    const isActive = currentSort?.field === col.field
                    const isDesc = isActive && currentSort.desc
                    return (
                      <th
                        key={col.field}
                        onClick={() => toggleSort(col.field)}
                        className={`text-muted-foreground hover:text-foreground group cursor-pointer px-3 py-2 text-left text-xs font-medium select-none ${col.hiddenClass ?? ''}`}
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
              <tbody className="divide-bark-100 dark:divide-bark-700/50 divide-y">
                {items.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => onRowClick(item.trace_id)}
                    className="hover:bg-parchment-100/50 dark:hover:bg-bark-800/30 cursor-pointer transition-colors"
                  >
                    <td className="text-foreground px-3 py-2 font-medium">{item.requester_name}</td>
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
                        <span className="font-medium text-amber-600 dark:text-amber-400">Yes</span>
                      ) : (
                        <span className="text-muted-foreground">No</span>
                      )}
                    </td>
                    <td className="text-muted-foreground hidden max-w-[200px] truncate px-3 py-2 text-xs lg:table-cell">
                      {item.ai_reasoning_summary || '\u2014'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
