import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Search, Home, X, ChevronDown, Settings, Download } from 'lucide-react'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react'
import { CampMinderIcon } from './icons'
import { StatusBadge } from './StatusBadge'
import { pb } from '../lib/pocketbase'
import { useYear } from '../hooks/useCurrentYear'
import { getDisplayAgeForYear } from '../utils/displayAge'
import { getSessionDisplayName, getParentSessionId } from '../utils/sessionDisplay'
import {
  getGenderIdentityDisplay,
  getGenderCategory,
  getGenderBadgeClasses,
} from '../utils/genderUtils'
import { sessionNameToUrl } from '../utils/sessionUtils'
import { useVirtualTable } from '../hooks/useVirtualTable'
import { createInclusionFilter, formatFilter } from '../utils/pocketbaseFilters'
import {
  fetchAttendeesWithPersons,
  fetchAssignmentsWithBunks,
  fetchBunksWithPlansForYear,
} from '../utils/pocketbaseDataFetchers'
import { buildCampersFromData, createLookupMaps } from '../utils/transforms'
import {
  filterSummerCampBunks,
  getDropdownSessions,
  getSessionRelationshipsForCamperView,
  getCampersHeadlineNoun,
  splitDropdownSessionsByType,
  resolveScopedSessions,
  FILTER_ALL,
  FILTER_AT_CAMP,
  FILTER_QUESTS,
} from '../utils/allCampersUtils'
import { mergeMultiSessionCampers } from '../utils/mergeMultiSessionCampers'
import type { MergedCamper } from '../utils/mergeMultiSessionCampers'
import type { Camper, Session } from '../types/app-types'
import type { BunksResponse } from '../types/pocketbase-types'
import { SUMMER_CAMP_TYPES } from '../utils/sessionTypePredicates'
import { buildCsvContent, downloadCsv, todayIso } from '../utils/csvExport'
import { buildCamperRows, CAMPER_CSV_HEADERS } from '../utils/csvExportHelpers'

// Helper function to properly case a name
function properCase(str: string | undefined): string {
  if (!str) return ''
  return str
    .split(/(\s+|-)/)
    .map((part) => {
      if (part === ' ' || part === '-' || part === '') return part
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    })
    .join('')
}

// Format camper name
function formatCamperName(camper: Camper): string {
  if (!camper.first_name || !camper.last_name) {
    return properCase(camper.name || '')
  }
  return `${properCase(camper.first_name)} ${properCase(camper.last_name)}`
}

// Get preferred name if different from first name
function getPreferredName(camper: Camper): string | null {
  if (!camper.preferred_name || !camper.first_name) return null
  if (camper.preferred_name.toLowerCase() === camper.first_name.toLowerCase()) return null
  return properCase(camper.preferred_name)
}

// Session colors - hash-based for stability across renames/additions
// 8 visually distinct colors (no red/pink overlap) with dark mode support
const SESSION_COLOR_PALETTE = [
  'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700', // Green
  'bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-700', // Blue
  'bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-300 border-violet-200 dark:border-violet-700', // Purple
  'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-700', // Orange
  'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-700', // Pink
  'bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-300 border-teal-200 dark:border-teal-700', // Teal
  'bg-slate-100 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600', // Gray
  'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700', // Deep blue
]

function getSessionColor(sessionName: string): string {
  // Simple hash function - consistent color for any session name
  let hash = 0
  for (let i = 0; i < sessionName.length; i++) {
    hash = (hash << 5) - hash + sessionName.charCodeAt(i)
    hash = hash & hash // Convert to 32-bit integer
  }
  const index = Math.abs(hash) % SESSION_COLOR_PALETTE.length
  return SESSION_COLOR_PALETTE[index] ?? 'bg-stone-100 text-stone-700 border-stone-200'
}

// Bunk area color with dark mode support
function getBunkAreaColor(bunkName: string | undefined): string {
  if (!bunkName) return ''
  if (bunkName.startsWith('B-'))
    return 'bg-sky-50 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-700'
  if (bunkName.startsWith('G-'))
    return 'bg-pink-50 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-700'
  if (bunkName.startsWith('AG-'))
    return 'bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700'
  return 'bg-stone-50 dark:bg-stone-800/60 text-stone-600 dark:text-stone-300 border-stone-200 dark:border-stone-600'
}

export default function AllCampersView() {
  const currentYear = useYear()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterSession, setFilterSession] = useState<string>(FILTER_ALL)
  const [filterSex, setFilterSex] = useState<'all' | 'M' | 'F'>('all')
  const [filterBunk, setFilterBunk] = useState<string>('all')
  const [isTableVisible, setIsTableVisible] = useState(false)

  // Auto-focus search on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      searchInputRef.current?.focus()
    }, 150)
    return () => clearTimeout(timer)
  }, [])

  // Keyboard shortcut: "/" to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      if (e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Fetch all valid sessions
  const { data: allSessions = [] } = useQuery({
    queryKey: ['all-sessions', currentYear],
    queryFn: async () => {
      const sessionTypeFilter = createInclusionFilter('session_type', [...SUMMER_CAMP_TYPES])
      const yearFilter = `year = ${currentYear}`
      const filter = formatFilter(`${sessionTypeFilter} && ${yearFilter}`)

      return pb.collection<Session>('camp_sessions').getFullList({
        filter,
        sort: 'start_date,name',
      })
    },
  })

  // Fetch all campers
  const { data: allCampers = [], isLoading } = useQuery({
    queryKey: ['all-campers', currentYear],
    queryFn: async () => {
      const sessionTypeFilter = createInclusionFilter('session_type', [...SUMMER_CAMP_TYPES])
      const yearFilter = `year = ${currentYear}`
      const filter = formatFilter(`${sessionTypeFilter} && ${yearFilter}`)

      const validSessions = await pb.collection<Session>('camp_sessions').getFullList({
        filter,
        sort: 'start_date,name',
      })

      const sessionIds = validSessions.map((s) => s.id)

      if (sessionIds.length === 0) return []

      const [attendees, assignments] = await Promise.all([
        fetchAttendeesWithPersons(sessionIds, currentYear),
        fetchAssignmentsWithBunks(sessionIds, currentYear),
      ])

      if (attendees.length === 0) return []

      const bunksFromAssignments = assignments
        .map((a) => a.expand.bunk)
        .filter((b): b is BunksResponse => b !== undefined)

      const maps = createLookupMaps({
        assignments,
        bunks: bunksFromAssignments,
      })

      return buildCampersFromData(attendees, maps.assignments, maps.bunks)
    },
  })

  // Fetch bunks for filtering
  const { data: bunksData } = useQuery({
    queryKey: ['all-bunks-with-plans', currentYear],
    queryFn: () => fetchBunksWithPlansForYear(currentYear),
    enabled: allSessions.length > 0,
  })

  const allBunks = useMemo(() => {
    if (!bunksData) return []
    return filterSummerCampBunks(bunksData.bunks, bunksData.bunkPlans, allSessions)
  }, [bunksData, allSessions])

  // Merge multi-session campers into single entries
  const mergedCampers: MergedCamper[] = useMemo(
    () => mergeMultiSessionCampers(allCampers, allSessions),
    [allCampers, allSessions]
  )

  const dropdownSessions = useMemo(() => getDropdownSessions(allSessions), [allSessions])
  const sessionRelationships = useMemo(
    () => getSessionRelationshipsForCamperView(allSessions),
    [allSessions]
  )

  const { campSessions, questSessions } = useMemo(
    () => splitDropdownSessionsByType(dropdownSessions),
    [dropdownSessions]
  )

  const scopedSessions = useMemo(
    () => resolveScopedSessions(filterSession, dropdownSessions),
    [filterSession, dropdownSessions]
  )

  // Filter and sort campers
  const filteredCampers = useMemo(() => {
    let filtered: MergedCamper[] = mergedCampers

    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter((camper) => {
        const formattedName = formatCamperName(camper)
        if (formattedName.toLowerCase().includes(term)) return true
        if (camper.first_name?.toLowerCase().includes(term)) return true
        if (camper.last_name?.toLowerCase().includes(term)) return true
        if (camper.preferred_name?.toLowerCase().includes(term)) return true
        return camper.name.toLowerCase().includes(term)
      })
    }

    if (filterSession !== FILTER_ALL) {
      const relatedSessionIds = new Set<string>()
      if (filterSession === FILTER_AT_CAMP) {
        for (const session of campSessions) {
          const ids = sessionRelationships.get(session.id) ?? [session.id]
          ids.forEach((id) => relatedSessionIds.add(id))
        }
      } else if (filterSession === FILTER_QUESTS) {
        for (const session of questSessions) {
          const ids = sessionRelationships.get(session.id) ?? [session.id]
          ids.forEach((id) => relatedSessionIds.add(id))
        }
      } else {
        const ids = sessionRelationships.get(filterSession) ?? [filterSession]
        ids.forEach((id) => relatedSessionIds.add(id))
      }
      filtered = filtered.filter((camper) => {
        const primary = allSessions.find((s) => s.cm_id === camper.session_cm_id)
        if (primary && relatedSessionIds.has(primary.id)) return true
        return (
          camper.additionalSessions?.some((as) => {
            const session = allSessions.find((s) => s.cm_id === as.session_cm_id)
            return session ? relatedSessionIds.has(session.id) : false
          }) ?? false
        )
      })
    }

    if (filterSex !== 'all') {
      filtered = filtered.filter((camper) => camper.gender === filterSex)
    }

    if (filterBunk !== 'all') {
      if (filterBunk === 'unassigned') {
        filtered = filtered.filter((camper) => !camper.assigned_bunk)
      } else {
        filtered = filtered.filter((camper) => camper.assigned_bunk === filterBunk)
      }
    }

    // Sort by name
    filtered.sort((a, b) => formatCamperName(a).localeCompare(formatCamperName(b)))

    return filtered
  }, [
    mergedCampers,
    searchTerm,
    filterSession,
    filterSex,
    filterBunk,
    sessionRelationships,
    allSessions,
    campSessions,
    questSessions,
  ])

  // Check if any filters are active
  const hasActiveFilters =
    filterSession !== FILTER_ALL || filterSex !== 'all' || filterBunk !== 'all'

  // Virtual scrolling
  const { parentRef, rowVirtualizer } = useVirtualTable({
    data: filteredCampers,
    height: 600,
    rowHeightPreset: 'normal',
    overscan: 15,
  })

  useEffect(() => {
    const timer = setTimeout(() => setIsTableVisible(true), 100)
    return () => clearTimeout(timer)
  }, [])

  const clearAllFilters = () => {
    setFilterSession(FILTER_ALL)
    setFilterSex('all')
    setFilterBunk('all')
    setSearchTerm('')
    searchInputRef.current?.focus()
  }

  return (
    <div className="space-y-4">
      {/* Compact Search Header */}
      <div className="from-forest-700 to-forest-800 rounded-xl bg-gradient-to-r px-6 py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="text-forest-300 pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search campers..."
              className="w-full rounded-lg border-2 border-transparent bg-white py-2.5 pr-10 pl-10 text-base shadow-sm transition-all placeholder:text-stone-400 focus:border-amber-400 focus:outline-none dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-amber-500"
            />
            {searchTerm && (
              <button
                onClick={() => {
                  setSearchTerm('')
                  searchInputRef.current?.focus()
                }}
                className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-0.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Filter Controls */}
          <div className="flex items-center gap-2">
            <Listbox value={filterSession} onChange={setFilterSession}>
              <div className="relative">
                <ListboxButton className="listbox-button-compact">
                  <span className="truncate">
                    {filterSession === FILTER_ALL
                      ? 'All Summer'
                      : filterSession === FILTER_AT_CAMP
                        ? 'At Camp'
                        : filterSession === FILTER_QUESTS
                          ? 'Quests'
                          : (() => {
                              const session = dropdownSessions.find((s) => s.id === filterSession)
                              return session
                                ? getSessionDisplayName(session, allSessions)
                                : 'Unknown Session'
                            })()}
                  </span>
                  <ChevronDown className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                </ListboxButton>
                <ListboxOptions className="listbox-options w-auto min-w-[180px]">
                  {/* Type groupings */}
                  <ListboxOption value={FILTER_ALL} className="listbox-option py-1.5">
                    All Summer
                  </ListboxOption>
                  <ListboxOption value={FILTER_AT_CAMP} className="listbox-option py-1.5">
                    At Camp
                  </ListboxOption>
                  <ListboxOption value={FILTER_QUESTS} className="listbox-option py-1.5">
                    Quests
                  </ListboxOption>

                  {/* Camp sessions */}
                  {campSessions.length > 0 && (
                    <div role="group" aria-labelledby="campers-camp-sessions-group-label">
                      <div className="border-border my-1 border-t" />
                      <div
                        id="campers-camp-sessions-group-label"
                        className="text-muted-foreground px-3 py-1 text-[10px] font-semibold tracking-wider uppercase"
                      >
                        Camp Sessions
                      </div>
                      {campSessions.map((session) => (
                        <ListboxOption
                          key={session.id}
                          value={session.id}
                          className="listbox-option py-1.5"
                        >
                          {getSessionDisplayName(session, allSessions)}
                        </ListboxOption>
                      ))}
                    </div>
                  )}

                  {/* Quests */}
                  {questSessions.length > 0 && (
                    <div role="group" aria-labelledby="campers-quests-group-label">
                      <div className="border-border my-1 border-t" />
                      <div
                        id="campers-quests-group-label"
                        className="text-muted-foreground px-3 py-1 text-[10px] font-semibold tracking-wider uppercase"
                      >
                        Quests
                      </div>
                      {questSessions.map((session) => (
                        <ListboxOption
                          key={session.id}
                          value={session.id}
                          className="listbox-option py-1.5"
                        >
                          {getSessionDisplayName(session, allSessions)}
                        </ListboxOption>
                      ))}
                    </div>
                  )}
                </ListboxOptions>
              </div>
            </Listbox>

            <Listbox value={filterSex} onChange={(v) => setFilterSex(v)}>
              <div className="relative">
                <ListboxButton className="listbox-button-compact">
                  <span>{filterSex === 'all' ? 'All' : filterSex === 'M' ? 'Boys' : 'Girls'}</span>
                  <ChevronDown className="text-muted-foreground h-4 w-4" />
                </ListboxButton>
                <ListboxOptions className="listbox-options w-auto min-w-[100px]">
                  <ListboxOption value="all" className="listbox-option py-1.5">
                    All
                  </ListboxOption>
                  <ListboxOption value="M" className="listbox-option py-1.5">
                    Boys
                  </ListboxOption>
                  <ListboxOption value="F" className="listbox-option py-1.5">
                    Girls
                  </ListboxOption>
                </ListboxOptions>
              </div>
            </Listbox>

            <Listbox value={filterBunk} onChange={setFilterBunk}>
              <div className="relative">
                <ListboxButton className="listbox-button-compact max-w-40">
                  <span className="truncate">
                    {filterBunk === 'all'
                      ? 'All Bunks'
                      : filterBunk === 'unassigned'
                        ? 'Unassigned'
                        : (allBunks.find((b) => b.id === filterBunk)?.name ?? 'Select...')}
                  </span>
                  <ChevronDown className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                </ListboxButton>
                <ListboxOptions className="listbox-options w-auto min-w-[140px]">
                  <ListboxOption value="all" className="listbox-option py-1.5">
                    All Bunks
                  </ListboxOption>
                  <ListboxOption value="unassigned" className="listbox-option py-1.5">
                    Unassigned
                  </ListboxOption>
                  {allBunks.map((bunk) => (
                    <ListboxOption key={bunk.id} value={bunk.id} className="listbox-option py-1.5">
                      {bunk.name}
                    </ListboxOption>
                  ))}
                </ListboxOptions>
              </div>
            </Listbox>

            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="rounded-lg bg-red-500 p-2 text-white shadow-sm transition-colors hover:bg-red-600"
                title="Clear filters"
              >
                <X className="h-4 w-4" />
              </button>
            )}

            <Link
              to="/admin"
              className="text-forest-200 rounded-lg p-2 transition-colors hover:bg-white/10 hover:text-white"
              title="Admin Settings"
            >
              <Settings className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>

      {/* Results Section */}
      <div className="dark:bg-card dark:border-border overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        {/* Results Header */}
        <div className="dark:border-border dark:bg-muted/30 flex items-center justify-between border-b border-stone-100 bg-stone-50/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="font-display text-forest-800 dark:text-forest-200 text-2xl font-bold">
              {filteredCampers.length}
            </span>
            <span className="text-stone-500 dark:text-stone-400">
              {getCampersHeadlineNoun(scopedSessions, filteredCampers.length)}
              {filteredCampers.length !== mergedCampers.length && (
                <span className="text-stone-400 dark:text-stone-500">
                  {' '}
                  of {mergedCampers.length}
                </span>
              )}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Quick stats */}
            {!hasActiveFilters && !searchTerm && (
              <div className="hidden items-center gap-4 text-sm text-stone-500 sm:flex dark:text-stone-400">
                <span>{mergedCampers.filter((c) => c.assigned_bunk).length} assigned</span>
                <span className="text-stone-300 dark:text-stone-600">|</span>
                <span>{mergedCampers.filter((c) => !c.assigned_bunk).length} unassigned</span>
              </div>
            )}
            {/* CSV export — respects active filters */}
            {filteredCampers.length > 0 && (
              <button
                onClick={() => {
                  const rows = buildCamperRows(filteredCampers as Camper[], allSessions)
                  const csv = buildCsvContent([...CAMPER_CSV_HEADERS], rows)
                  const genderPart = filterSex === 'M' ? '-boys' : filterSex === 'F' ? '-girls' : ''
                  downloadCsv(csv, `all-campers${genderPart}-${todayIso()}.csv`)
                }}
                className="btn-ghost flex items-center gap-1.5 px-2 py-1.5 text-sm"
                title="Export to CSV"
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Export</span>
              </button>
            )}
          </div>
        </div>

        {/* Results List */}
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="border-t-forest-600 dark:border-t-forest-400 h-8 w-8 animate-spin rounded-full border-4 border-stone-200 dark:border-stone-700" />
              <p className="text-sm text-stone-500 dark:text-stone-400">Loading campers...</p>
            </div>
          </div>
        ) : !isTableVisible ? (
          <div className="flex h-64 items-center justify-center">
            <div className="border-t-forest-600 dark:border-t-forest-400 h-6 w-6 animate-spin rounded-full border-3 border-stone-200 dark:border-stone-700" />
          </div>
        ) : filteredCampers.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-stone-100 dark:bg-stone-800">
              <Search className="h-8 w-8 text-stone-400 dark:text-stone-500" />
            </div>
            <h3 className="mb-1 text-lg font-semibold text-stone-700 dark:text-stone-200">
              No campers found
            </h3>
            <p className="mb-4 text-stone-500 dark:text-stone-400">
              Try adjusting your search or filters
            </p>
            {(hasActiveFilters || searchTerm) && (
              <button
                onClick={clearAllFilters}
                className="text-forest-600 hover:text-forest-700 dark:text-forest-400 dark:hover:text-forest-300 font-medium"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <div ref={parentRef} className="overflow-auto" style={{ height: '600px' }}>
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                position: 'relative',
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                const camper = filteredCampers[virtualItem.index]
                if (!camper) return null

                const session = allSessions.find((s) => s.cm_id === camper.session_cm_id)
                const sessionDisplayName = getSessionDisplayName(session, allSessions)
                const bunk = camper.expand?.assigned_bunk
                const bunkName = bunk && 'name' in bunk ? bunk.name : null
                const preferredName = getPreferredName(camper)
                const genderIdentity = getGenderIdentityDisplay(camper)

                // Get session URL for bunk link
                const parentSessionId = session ? getParentSessionId(session, allSessions) : null
                const parentSession = parentSessionId
                  ? allSessions.find(
                      (s) =>
                        s.cm_id ===
                        (typeof parentSessionId === 'string'
                          ? parseInt(parentSessionId)
                          : parentSessionId)
                    )
                  : session
                const sessionUrl = parentSession ? sessionNameToUrl(parentSession.name) : ''

                return (
                  <div
                    key={camper.id}
                    className="group absolute top-0 left-0 w-full"
                    style={{
                      height: `${virtualItem.size}px`,
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <div className="hover:bg-forest-50/50 dark:hover:bg-forest-950/30 flex h-full items-center gap-4 border-b border-stone-100 px-4 py-3 transition-colors duration-150 sm:px-6 dark:border-stone-800">
                      {/* Name & Details */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/camper/${camper.person_cm_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-forest-700 dark:hover:text-forest-400 truncate text-base font-semibold text-stone-800 transition-colors dark:text-stone-100"
                          >
                            {formatCamperName(camper)}
                          </Link>
                          {preferredName && (
                            <span className="truncate text-sm text-stone-400 dark:text-stone-500">
                              "{preferredName}"
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-sm text-stone-500 dark:text-stone-400">
                            Grade {camper.grade} ·{' '}
                            {(getDisplayAgeForYear(camper, currentYear) ?? 0).toFixed(2)} yrs
                          </span>
                          {genderIdentity && genderIdentity !== 'Unknown' && (
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-xs ${getGenderBadgeClasses(getGenderCategory(genderIdentity), genderIdentity)}`}
                            >
                              {genderIdentity}
                            </span>
                          )}
                          <StatusBadge status={camper.attendee_status} />
                        </div>
                      </div>

                      {/* Session Badge(s) */}
                      <div className="hidden flex-shrink-0 items-center gap-1 sm:flex">
                        <div
                          className={`items-center rounded-lg border px-3 py-1.5 text-sm font-medium ${getSessionColor(sessionDisplayName)}`}
                        >
                          {sessionDisplayName}
                        </div>
                        {camper.additionalSessions?.map((as) => {
                          const addSessionName =
                            allSessions.find((s) => s.cm_id === as.session_cm_id)?.name ??
                            as.session_name
                          return (
                            <div
                              key={as.session_cm_id}
                              className={`items-center rounded-lg border px-3 py-1.5 text-sm font-medium ${getSessionColor(addSessionName)}`}
                            >
                              {addSessionName}
                            </div>
                          )
                        })}
                      </div>

                      {/* Bunk Badge / Unassigned */}
                      <div className="w-28 flex-shrink-0 text-center">
                        {bunkName ? (
                          <Link
                            to={`/summer/session/${sessionUrl}/board`}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-all duration-150 hover:shadow-md ${getBunkAreaColor(bunkName)}`}
                            title="View on bunk board"
                          >
                            <Home className="h-3.5 w-3.5" />
                            {bunkName}
                          </Link>
                        ) : (
                          <span className="text-sm text-stone-400 italic dark:text-stone-500">
                            Unassigned
                          </span>
                        )}
                      </div>

                      {/* CampMinder Link */}
                      <a
                        href={`https://system.campminder.com/ui/person/Record#${camper.person_cm_id}:${currentYear}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-forest-600 dark:hover:text-forest-400 hover:bg-forest-100 dark:hover:bg-forest-900/40 flex-shrink-0 rounded-lg p-2 text-stone-400 transition-all duration-150 dark:text-stone-500"
                        title="Open in CampMinder"
                      >
                        <CampMinderIcon className="h-6 w-6" />
                      </a>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
