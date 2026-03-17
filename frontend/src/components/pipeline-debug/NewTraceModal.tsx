/**
 * NewTraceModal - Modal for selecting campers and running targeted pipeline traces.
 *
 * Three input tabs:
 * 1. Search by Name — type-ahead person search, loads their original requests
 * 2. Paste CM ID — enter comma-separated CampMinder IDs
 * 3. Browse Requests — placeholder for future batch browsing
 *
 * Bottom controls: stop-after phase dropdown and Run Trace / Cancel buttons.
 */

import { useState, useEffect, useMemo } from 'react'
import { X, Search, Loader2 } from 'lucide-react'
import { useSearchPersons } from '../../hooks/useSearchPersons'
import { useOriginalRequestsByCamper } from '../../hooks/useOriginalRequestsByCamper'
import { PHASE_ORDER } from './types'
import type { PipelinePhase, PersonSearchItem, OriginalRequestItem } from './types'

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
}

const PHASE_LABELS: Record<PipelinePhase, string> = {
  pre_phase1: 'Pre-Phase 1',
  phase1: 'Phase 1 Parse',
  validation: 'Validation',
  phase2: 'Phase 2 Resolution',
  expansion: 'Expansion',
  historical: 'Phase 2.5 Historical',
  phase3: 'Phase 3 Disambiguation',
  post_pipeline: 'Post-Pipeline',
}

export function NewTraceModal({
  isOpen,
  onClose,
  onRunTrace,
  isRunning,
  year,
}: NewTraceModalProps) {
  const [activeTab, setActiveTab] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedPerson, setSelectedPerson] = useState<PersonSearchItem | null>(null)
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<string>>(new Set())
  const [stopAtPhase, setStopAtPhase] = useState<string | null>(null)
  const [pastedCmIds, setPastedCmIds] = useState('')
  const [pastedCmId, setPastedCmId] = useState<number | null>(null)

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Person search hook
  const { data: searchResults, isLoading: isSearching } = useSearchPersons(debouncedQuery, year)

  // Load requests for selected person
  const selectedCmId = activeTab === 0 ? (selectedPerson?.cm_id ?? null) : pastedCmId
  const { data: requestsData, isLoading: isLoadingRequests } = useOriginalRequestsByCamper(
    selectedCmId,
    year
  )

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

  // Extract unique session CM IDs from selected requests
  const sessionCmIds = useMemo(() => {
    if (!requestsData?.items) return []
    const sessions = new Set<number>()
    for (const req of requestsData.items) {
      if (selectedRequestIds.has(req.id)) {
        // Session CM IDs are not directly on OriginalRequestItem,
        // so we pass an empty array and let the API resolve sessions
        // from the original_request_ids
      }
    }
    return Array.from(sessions)
  }, [requestsData, selectedRequestIds])

  function handleSelectPerson(person: PersonSearchItem) {
    setSelectedPerson(person)
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
    const ids = pastedCmIds
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
      .map(Number)
    const firstId = ids[0]
    if (firstId !== undefined) {
      setPastedCmId(firstId)
      setSelectedRequestIds(new Set())
    }
  }

  function handleRunTrace() {
    if (selectedRequestIds.size === 0) return
    onRunTrace(Array.from(selectedRequestIds), sessionCmIds, stopAtPhase)
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
                  placeholder="Enter comma-separated CM IDs (e.g. 12345, 67890)"
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
            <p className="text-bark-500 dark:text-bark-400 py-8 text-center text-sm">
              Use the batch view to browse and select requests
            </p>
          )}
        </div>

        {/* Run Controls */}
        <div className="border-bark-200 dark:border-bark-700 flex items-center justify-between border-t px-6 py-4">
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

          <div className="flex items-center gap-2">
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
