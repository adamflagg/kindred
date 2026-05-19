/**
 * NewTraceModal - Modal for selecting campers and running targeted pipeline traces.
 *
 * Three input tabs:
 * 1. Search by Name — type-ahead person search, loads their original requests
 * 2. Paste CM ID — enter a single CampMinder ID
 * 3. Browse Requests — filterable table of all original_bunk_requests
 *
 * Bottom controls: session dropdown, stop-after phase dropdown, and Run Trace / Cancel buttons.
 */

import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Search, Loader2 } from 'lucide-react'
import { useSearchPersons } from '../../hooks/useSearchPersons'
import { useOriginalRequestsByCamper } from '../../hooks/useOriginalRequestsByCamper'
import { useApiWithAuth } from '../../hooks/useApiWithAuth'
import { pipelineDebugService } from '../../services/pipelineDebug'
import { queryKeys, userDataOptions } from '../../utils/queryKeys'
import { PHASE_ORDER } from './types'
import { PHASE_LABELS } from './phaseDescriptions'
import type { PersonSearchItem, OriginalRequestItem } from './types'

interface NewTraceModalProps {
  isOpen: boolean
  onClose: () => void
  onRunTrace: (
    originalRequestIds: string[],
    sessionCmIds: number[],
    stopAtPhase: string | null
  ) => void
  isRunning: boolean
  year: number
  error?: string | null
}

export function NewTraceModal({
  isOpen,
  onClose,
  onRunTrace,
  isRunning,
  year,
  error,
}: NewTraceModalProps) {
  const [activeTab, setActiveTab] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedPerson, setSelectedPerson] = useState<PersonSearchItem | null>(null)
  const [selectedPersonSessions, setSelectedPersonSessions] = useState<number[]>([])
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<string>>(new Set())
  const [stopAtPhase, setStopAtPhase] = useState<string | null>(null)
  const [pastedCmIds, setPastedCmIds] = useState('')
  const [pastedCmId, setPastedCmId] = useState<number | null>(null)

  // Browse tab filters
  const [browseSessionFilter, setBrowseSessionFilter] = useState<number | null>(null)
  const [browseFieldFilter, setBrowseFieldFilter] = useState<string>('')
  const [browseProcessedFilter, setBrowseProcessedFilter] = useState<string>('all')

  // Session dropdown for run controls
  const [selectedSession, setSelectedSession] = useState<number | null>(null)

  const { fetchWithAuth } = useApiWithAuth()

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Person search hook
  const {
    data: searchResults,
    isLoading: isSearching,
    isError: isSearchError,
  } = useSearchPersons(debouncedQuery, year)

  // Load requests for selected person
  const selectedCmId = activeTab === 0 ? (selectedPerson?.cm_id ?? null) : pastedCmId
  const {
    data: requestsData,
    isLoading: isLoadingRequests,
    isError: isRequestsError,
  } = useOriginalRequestsByCamper(selectedCmId, year)

  // Auto-select all requests when they load
  useEffect(() => {
    if (requestsData?.items) {
      setSelectedRequestIds(new Set(requestsData.items.map((r: OriginalRequestItem) => r.id)))
    }
  }, [requestsData])

  // Group requests by source field
  const requestsBySource = useMemo(() => {
    if (!requestsData?.items) return new Map<string, OriginalRequestItem[]>()
    const map = new Map<string, OriginalRequestItem[]>()
    for (const req of requestsData.items) {
      const group = map.get(req.source_field) ?? []
      group.push(req)
      map.set(req.source_field, group)
    }
    return map
  }, [requestsData])

  // Browse tab: fetch original requests with filters.
  // Build filter object without undefined values to satisfy exactOptionalPropertyTypes.
  const browseQueryKeyFilters = useMemo(() => {
    const f: { session_cm_id?: number; source_field?: string } = {}
    if (browseSessionFilter !== null) f.session_cm_id = browseSessionFilter
    if (browseFieldFilter) f.source_field = browseFieldFilter
    return f
  }, [browseSessionFilter, browseFieldFilter])

  const {
    data: browseData,
    isLoading: isBrowseLoading,
    isError: isBrowseError,
  } = useQuery({
    queryKey: queryKeys.browseOriginalRequests(year, browseQueryKeyFilters),
    queryFn: () =>
      pipelineDebugService.fetchOriginalRequests(
        year,
        { ...browseQueryKeyFilters, limit: 200 },
        fetchWithAuth
      ),
    enabled: activeTab === 2,
    ...userDataOptions,
  })

  // Client-side processed filter for browse results
  const filteredBrowseItems = useMemo(() => {
    if (!browseData?.items) return []
    if (browseProcessedFilter === 'all') return browseData.items
    const isProcessed = browseProcessedFilter === 'processed'
    return browseData.items.filter((item) => item.processed === isProcessed)
  }, [browseData, browseProcessedFilter])

  // Derive available sessions for the run controls session dropdown.
  // Tab 1 (Search) populates sessions from the selected person's enrollments.
  // Tab 2/3 don't carry session info, so sessions remain from the last selection.
  const availableSessions = selectedPersonSessions

  function handleSelectPerson(person: PersonSearchItem) {
    setSelectedPerson(person)
    setSelectedPersonSessions(person.sessions)
    setSelectedRequestIds(new Set())
  }

  function handleToggleRequest(id: string) {
    setSelectedRequestIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleLoadPastedIds() {
    const trimmed = pastedCmIds.trim()
    if (/^\d+$/.test(trimmed)) {
      setPastedCmId(Number(trimmed))
      setSelectedRequestIds(new Set())
    }
  }

  function handleRunTrace() {
    if (selectedRequestIds.size === 0) return
    const sessions = selectedSession ? [selectedSession] : selectedPersonSessions
    onRunTrace(Array.from(selectedRequestIds), sessions, stopAtPhase)
  }

  function handleToggleBrowseSelectAll() {
    const allIds = filteredBrowseItems.map((item) => item.id)
    const allSelected = allIds.every((id) => selectedRequestIds.has(id))
    setSelectedRequestIds((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        allIds.forEach((id) => next.delete(id))
      } else {
        allIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  if (!isOpen) return null

  const tabs = ['Search by Name', 'Paste CM ID', 'Browse']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="card-lodge mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col">
        {/* Header */}
        <div className="border-bark-200 dark:border-bark-700 flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold">New Trace</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-bark-400 hover:text-bark-600 dark:text-bark-500 dark:hover:text-bark-300 rounded p-1 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="border-bark-200 dark:border-bark-700 flex border-b px-6">
          {tabs.map((label, i) => (
            <button
              key={label}
              onClick={() => setActiveTab(i)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === i
                  ? 'border-b-2 border-amber-500 text-amber-700 dark:text-amber-400'
                  : 'text-bark-500 hover:text-bark-700 dark:text-bark-400 dark:hover:text-bark-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {/* Tab 1: Search by Name */}
          {activeTab === 0 && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="text-bark-400 absolute top-2.5 left-3 h-4 w-4" />
                <input
                  type="text"
                  placeholder="Search camper name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="border-bark-300 bg-parchment-50 dark:border-bark-600 dark:bg-bark-800 w-full rounded-lg border py-2 pr-3 pl-9 text-sm focus:ring-2 focus:ring-amber-500/50 focus:outline-none"
                />
              </div>

              {/* Search results */}
              {isSearching && (
                <div className="flex items-center gap-2 py-2 text-sm text-amber-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Searching...
                </div>
              )}

              {isSearchError && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  Search failed. Please try again.
                </p>
              )}

              {searchResults?.items && !selectedPerson && (
                <ul className="divide-bark-200 dark:divide-bark-700 divide-y rounded-lg border">
                  {searchResults.items.map((person: PersonSearchItem) => (
                    <li key={person.cm_id}>
                      <button
                        onClick={() => handleSelectPerson(person)}
                        className="hover:bg-parchment-100 dark:hover:bg-bark-800 w-full px-3 py-2 text-left text-sm transition-colors"
                      >
                        <span className="font-medium">
                          {person.first_name} {person.last_name}
                        </span>
                        <span className="text-bark-500 dark:text-bark-400 ml-2 text-xs">
                          {person.grade !== null && `grade ${person.grade}, `}
                          CM ID: {person.cm_id}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Selected person and their requests */}
              {selectedPerson && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {selectedPerson.first_name} {selectedPerson.last_name}
                    </span>
                    <button
                      onClick={() => {
                        setSelectedPerson(null)
                        setSelectedRequestIds(new Set())
                        setSearchQuery('')
                      }}
                      className="text-xs text-amber-600 hover:text-amber-700"
                    >
                      Change
                    </button>
                  </div>
                  {renderRequestsList()}
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Paste CM ID */}
          {activeTab === 1 && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <textarea
                  placeholder="Enter a CampMinder ID (e.g. 12345)"
                  value={pastedCmIds}
                  onChange={(e) => setPastedCmIds(e.target.value)}
                  rows={2}
                  className="border-bark-300 bg-parchment-50 dark:border-bark-600 dark:bg-bark-800 flex-1 rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500/50 focus:outline-none"
                />
                <button
                  onClick={handleLoadPastedIds}
                  className="self-start rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700"
                >
                  Load
                </button>
              </div>
              {pastedCmId && renderRequestsList()}
            </div>
          )}

          {/* Tab 3: Browse */}
          {activeTab === 2 && (
            <div className="space-y-3">
              {/* Filters */}
              <div className="flex flex-wrap gap-2">
                <input
                  type="number"
                  placeholder="Session CM ID"
                  value={browseSessionFilter ?? ''}
                  onChange={(e) =>
                    setBrowseSessionFilter(e.target.value ? Number(e.target.value) : null)
                  }
                  aria-label="Session filter"
                  className="border-bark-300 bg-parchment-50 dark:border-bark-600 dark:bg-bark-800 w-32 rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:ring-amber-500/50 focus:outline-none"
                />
                <select
                  value={browseFieldFilter}
                  onChange={(e) => setBrowseFieldFilter(e.target.value)}
                  aria-label="Source field filter"
                  className="border-bark-300 bg-parchment-50 dark:border-bark-600 dark:bg-bark-800 rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:ring-amber-500/50 focus:outline-none"
                >
                  <option value="">All fields</option>
                  <option value="bunk_request_form">bunk_request_form</option>
                  <option value="staff_not_bunk_with">staff_not_bunk_with</option>
                  <option value="bunking_notes">bunking_notes</option>
                  <option value="internal_notes">internal_notes</option>
                  <option value="socialize_with">socialize_with</option>
                </select>
                <select
                  value={browseProcessedFilter}
                  onChange={(e) => setBrowseProcessedFilter(e.target.value)}
                  aria-label="Processed status filter"
                  className="border-bark-300 bg-parchment-50 dark:border-bark-600 dark:bg-bark-800 rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:ring-amber-500/50 focus:outline-none"
                >
                  <option value="all">All statuses</option>
                  <option value="processed">Processed</option>
                  <option value="unprocessed">Unprocessed</option>
                </select>
              </div>

              {/* Loading / Error / Empty states */}
              {isBrowseLoading && (
                <div className="flex items-center gap-2 py-2 text-sm text-amber-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading requests...
                </div>
              )}

              {isBrowseError && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  Failed to load requests. Please try again.
                </p>
              )}

              {!isBrowseLoading && !isBrowseError && filteredBrowseItems.length === 0 && (
                <p className="text-bark-500 dark:text-bark-400 py-4 text-center text-sm">
                  No requests found matching the current filters.
                </p>
              )}

              {/* Results table */}
              {filteredBrowseItems.length > 0 && (
                <div className="max-h-[300px] overflow-y-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-parchment-50 dark:bg-bark-800 sticky top-0">
                      <tr className="text-muted-foreground border-b text-left text-xs font-medium">
                        <th className="px-2 py-2">
                          <input
                            type="checkbox"
                            checked={
                              filteredBrowseItems.length > 0 &&
                              filteredBrowseItems.every((item) => selectedRequestIds.has(item.id))
                            }
                            onChange={handleToggleBrowseSelectAll}
                            className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                            aria-label="Select all"
                          />
                        </th>
                        <th className="px-3 py-2">Requester</th>
                        <th className="px-3 py-2">Field</th>
                        <th className="px-3 py-2">Content</th>
                        <th className="px-2 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-bark-100 dark:divide-bark-700 divide-y">
                      {filteredBrowseItems.map((req) => (
                        <tr
                          key={req.id}
                          className="hover:bg-parchment-50 dark:hover:bg-bark-800 transition-colors"
                        >
                          <td className="px-2 py-1.5">
                            <input
                              type="checkbox"
                              checked={selectedRequestIds.has(req.id)}
                              onChange={() => handleToggleRequest(req.id)}
                              className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                            />
                          </td>
                          <td className="px-3 py-1.5">{req.requester_name}</td>
                          <td className="text-bark-500 dark:text-bark-400 px-3 py-1.5 text-xs">
                            {req.source_field}
                          </td>
                          <td className="max-w-[200px] truncate px-3 py-1.5">
                            {req.original_text || <em className="text-bark-400">empty</em>}
                          </td>
                          <td className="px-2 py-1.5">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                                req.processed
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                              }`}
                            >
                              {req.processed ? 'Processed' : 'Unprocessed'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {browseData && (
                <p className="text-bark-400 text-xs">
                  Showing {filteredBrowseItems.length} of {browseData.total} requests
                </p>
              )}
            </div>
          )}
        </div>

        {/* Run Controls */}
        <div className="border-bark-200 dark:border-bark-700 flex items-center justify-between border-t px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label htmlFor="session-select" className="text-sm font-medium">
                Session
              </label>
              <select
                id="session-select"
                value={selectedSession ?? ''}
                onChange={(e) => setSelectedSession(e.target.value ? Number(e.target.value) : null)}
                className="border-bark-300 bg-parchment-50 dark:border-bark-600 dark:bg-bark-800 rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:ring-amber-500/50 focus:outline-none"
              >
                <option value="">All sessions</option>
                {availableSessions.map((sid) => (
                  <option key={sid} value={sid}>
                    {sid}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="stop-after-phase" className="text-sm font-medium">
                Stop after
              </label>
              <select
                id="stop-after-phase"
                value={stopAtPhase ?? ''}
                onChange={(e) => setStopAtPhase(e.target.value || null)}
                className="border-bark-300 bg-parchment-50 dark:border-bark-600 dark:bg-bark-800 rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:ring-amber-500/50 focus:outline-none"
              >
                <option value="">Full pipeline</option>
                {PHASE_ORDER.map((phase) => (
                  <option key={phase} value={phase}>
                    {PHASE_LABELS[phase]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button
              onClick={onClose}
              className="text-bark-600 hover:text-bark-800 dark:text-bark-400 dark:hover:text-bark-200 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRunTrace}
              disabled={selectedRequestIds.size === 0 || isRunning}
              className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRunning && <Loader2 className="h-4 w-4 animate-spin" />}
              Run Trace
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  /** Shared renderer for the requests list with checkboxes, grouped by source. */
  function renderRequestsList() {
    if (isLoadingRequests) {
      return (
        <div className="flex items-center gap-2 py-2 text-sm text-amber-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading requests...
        </div>
      )
    }

    if (isRequestsError) {
      return (
        <p className="text-sm text-red-600 dark:text-red-400">
          Failed to load requests. Please try again.
        </p>
      )
    }

    if (!requestsData?.items || requestsData.items.length === 0) {
      return (
        <p className="text-bark-500 dark:text-bark-400 py-2 text-sm">
          No original requests found for this camper.
        </p>
      )
    }

    return (
      <div className="space-y-3">
        {Array.from(requestsBySource.entries()).map(([source, requests]) => (
          <div key={source}>
            <div className="text-bark-500 dark:text-bark-400 mb-1 text-xs font-medium tracking-wide uppercase">
              {source}
            </div>
            <ul className="space-y-1">
              {requests.map((req: OriginalRequestItem) => (
                <li key={req.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selectedRequestIds.has(req.id)}
                    onChange={() => handleToggleRequest(req.id)}
                    className="mt-0.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-sm">
                    {req.original_text || <em className="text-bark-400">empty</em>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    )
  }
}
