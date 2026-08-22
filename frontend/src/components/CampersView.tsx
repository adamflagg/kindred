import { useState, useMemo, useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { Search, Home, X, Users, ChevronDown, Download } from 'lucide-react'
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react'
import { CampMinderIcon } from './icons'
import {
  getGenderIdentityDisplay,
  getGenderCategory,
  getGenderBadgeClasses,
  getVisibleBunks,
} from '../utils/genderUtils'
import { useVirtualTable } from '../hooks/useVirtualTable'
import { useYear } from '../hooks/useCurrentYear'
import { getDisplayAgeForYear } from '../utils/displayAge'
import type { Camper, Bunk, Session } from '../types/app-types'
import { buildCsvContent, downloadCsv, slugify, todayIso } from '../utils/csvExport'
import { buildCamperRows, CAMPER_CSV_HEADERS } from '../utils/csvExportHelpers'
import { filterSexLabel, filterSexCsvSegment } from '../utils/filterSexFormat'

// Bunk area color based on bunk prefix with dark mode support
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

interface CampersViewProps {
  sessionId: string // Currently unused but kept for API compatibility
  session?: Session // Currently unused but kept for API compatibility
  campers: Camper[]
  bunks: Bunk[]
}

interface CamperWithDetails extends Camper {
  bunkName?: string
}

// Helper function to properly case a name
function properCase(str: string | undefined): string {
  if (!str) return ''
  // Split by spaces or hyphens, keeping the delimiters
  return str
    .split(/(\s+|-)/)
    .map((part) => {
      // Keep spaces and hyphens as-is
      if (part === ' ' || part === '-' || part === '') return part
      // Capitalize first letter, lowercase the rest
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    })
    .join('')
}

// Helper function to strip quotes from a string
function stripQuotes(str: string | undefined): string {
  if (!str) return ''
  return str.replace(/^["']|["']$/g, '')
}

// Helper function to format camper name like in CamperDetail
function formatCamperName(camper: Camper): string {
  // Handle missing fields gracefully
  if (!camper.first_name || !camper.last_name) {
    // Fall back to the name field if individual name parts are missing
    return properCase(camper.name || '')
  }

  const firstName = properCase(camper.first_name)
  const preferredName = properCase(stripQuotes(camper.preferred_name))
  const lastName = properCase(camper.last_name)

  // Match CamperDetail format exactly
  if (preferredName && preferredName !== firstName) {
    return `${firstName} "${preferredName}" ${lastName}`
  }

  return `${firstName} ${lastName}`
}

export default function CampersView({
  sessionId: _sessionId,
  session: _session,
  campers,
  bunks,
}: CampersViewProps) {
  const currentYear = useYear()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterSex, setFilterSex] = useState<'all' | 'M' | 'F'>('all')
  const [filterBunk, setFilterBunk] = useState<string>('all')
  const [isTableVisible, setIsTableVisible] = useState(false)

  // Check if any filters are active
  const hasActiveFilters = filterSex !== 'all' || filterBunk !== 'all'

  // Clear all filters
  const clearAllFilters = () => {
    setFilterSex('all')
    setFilterBunk('all')
    setSearchTerm('')
    searchInputRef.current?.focus()
  }

  // Delay table rendering for better initial performance
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsTableVisible(true)
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  // Create bunk lookup map
  const bunkMap = useMemo(() => {
    const map = new Map<string, string>()
    bunks.forEach((bunk) => map.set(bunk.id, bunk.name))
    return map
  }, [bunks])

  // Process campers with additional details
  const processedCampers = useMemo<CamperWithDetails[]>(() => {
    return campers.map((camper) => {
      const result: CamperWithDetails = {
        ...camper,
        name: formatCamperName(camper), // Use formatted name
        ...(camper.expand?.assigned_bunk?.name ||
        (camper.assigned_bunk && bunkMap.get(camper.assigned_bunk))
          ? {
              bunkName:
                camper.expand?.assigned_bunk?.name ??
                (camper.assigned_bunk && bunkMap.get(camper.assigned_bunk)) ??
                '',
            }
          : {}),
      }
      return result
    })
  }, [campers, bunkMap])

  // Filter and sort campers
  const filteredCampers = useMemo(() => {
    let filtered = processedCampers

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(
        (camper) =>
          camper.name.toLowerCase().includes(term) ||
          (camper.first_name?.toLowerCase().includes(term) ?? false) ||
          (camper.last_name?.toLowerCase().includes(term) ?? false) ||
          (camper.preferred_name?.toLowerCase().includes(term) ?? false)
      )
    }

    // Sex filter
    if (filterSex !== 'all') {
      filtered = filtered.filter((camper) => camper.gender === filterSex)
    }

    // Bunk filter
    if (filterBunk !== 'all') {
      if (filterBunk === 'unassigned') {
        filtered = filtered.filter((camper) => !camper.assigned_bunk)
      } else {
        filtered = filtered.filter((camper) => camper.assigned_bunk === filterBunk)
      }
    }

    // Sort by name
    filtered.sort((a, b) => a.name.localeCompare(b.name))

    return filtered
  }, [processedCampers, searchTerm, filterSex, filterBunk])

  // Calculate visible bunks based on sex filter
  const visibleBunks = useMemo(() => {
    return getVisibleBunks(bunks, filterSex)
  }, [bunks, filterSex])

  // Use the centralized virtual table hook
  const { parentRef, rowVirtualizer } = useVirtualTable({
    data: filteredCampers,
    height: 600,
    rowHeightPreset: 'normal',
    overscan: 15,
  })

  return (
    <div className="space-y-4">
      {/* Forest Gradient Search Header */}
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
                className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-0.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-300"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Filter Controls */}
          <div className="flex items-center gap-2">
            <Listbox value={filterSex} onChange={(v) => setFilterSex(v)}>
              <div className="relative">
                <ListboxButton className="listbox-button-compact">
                  <span>{filterSexLabel(filterSex)}</span>
                  <ChevronDown className="text-muted-foreground h-4 w-4" />
                </ListboxButton>
                <ListboxOptions transition className="listbox-options w-auto min-w-[100px]">
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
                        : (visibleBunks.find((b) => b.id === filterBunk)?.name ?? 'Select...')}
                  </span>
                  <ChevronDown className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                </ListboxButton>
                <ListboxOptions transition className="listbox-options w-auto min-w-[140px]">
                  <ListboxOption value="all" className="listbox-option py-1.5">
                    All Bunks
                  </ListboxOption>
                  <ListboxOption value="unassigned" className="listbox-option py-1.5">
                    Unassigned
                  </ListboxOption>
                  {visibleBunks.map((bunk) => (
                    <ListboxOption key={bunk.id} value={bunk.id} className="listbox-option py-1.5">
                      {bunk.name}
                    </ListboxOption>
                  ))}
                </ListboxOptions>
              </div>
            </Listbox>

            {(hasActiveFilters || searchTerm) && (
              <button
                onClick={clearAllFilters}
                className="rounded-lg bg-red-500 p-2 text-white shadow-sm transition-colors hover:bg-red-600"
                title="Clear filters"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results Section */}
      <div className="dark:bg-card dark:border-border overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        {/* Results Header */}
        <div className="dark:border-border dark:bg-muted/30 flex items-center justify-between border-b border-stone-100 bg-stone-50/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="font-display text-forest-800 dark:text-forest-300 text-2xl font-bold">
              {filteredCampers.length}
            </span>
            <span className="dark:text-muted-foreground text-stone-500">
              {filteredCampers.length === 1 ? 'camper' : 'campers'}
              {filteredCampers.length !== campers.length && (
                <span className="dark:text-muted-foreground/70 text-stone-400">
                  {' '}
                  of {campers.length}
                </span>
              )}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Quick stats */}
            {!hasActiveFilters && !searchTerm && (
              <div className="dark:text-muted-foreground hidden items-center gap-4 text-sm text-stone-500 sm:flex">
                <span>{campers.filter((c) => c.assigned_bunk).length} assigned</span>
                <span className="dark:text-muted-foreground/50 text-stone-300">|</span>
                <span>{campers.filter((c) => !c.assigned_bunk).length} unassigned</span>
              </div>
            )}
            {/* CSV export */}
            {filteredCampers.length > 0 && (
              <button
                onClick={() => {
                  const sessions = _session ? [_session] : []
                  const rows = buildCamperRows(filteredCampers, sessions)
                  const csv = buildCsvContent([...CAMPER_CSV_HEADERS], rows)
                  const sessionSlug = _session ? slugify(_session.name) : 'session'
                  const genderPart = filterSexCsvSegment(filterSex)
                  let bunkPart = ''
                  if (filterBunk === 'unassigned') {
                    bunkPart = '-unassigned'
                  } else if (filterBunk !== 'all') {
                    const bunkName = bunks.find((b) => b.id === filterBunk)?.name
                    if (bunkName) bunkPart = `-${slugify(bunkName)}`
                  }
                  downloadCsv(
                    csv,
                    `session-${sessionSlug}${genderPart}${bunkPart}-${todayIso()}.csv`
                  )
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
        {!isTableVisible ? (
          <div className="flex h-64 items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="border-t-forest-600 dark:border-t-forest-400 h-8 w-8 animate-spin rounded-full border-4 border-stone-200 dark:border-stone-700" />
              <p className="dark:text-muted-foreground text-sm text-stone-500">
                Loading campers...
              </p>
            </div>
          </div>
        ) : filteredCampers.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="dark:bg-muted mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-stone-100">
              <Users className="dark:text-muted-foreground h-8 w-8 text-stone-400" />
            </div>
            <h3 className="dark:text-foreground mb-1 text-lg font-semibold text-stone-700">
              No campers found
            </h3>
            <p className="dark:text-muted-foreground mb-4 text-stone-500">
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

                const genderIdentity = getGenderIdentityDisplay(camper)

                return (
                  <div
                    key={camper.id}
                    className="group absolute top-0 left-0 w-full"
                    style={{
                      height: `${virtualItem.size}px`,
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <div className="dark:border-border hover:bg-forest-50/50 dark:hover:bg-forest-950/20 flex h-full items-center gap-4 border-b border-stone-100 px-4 py-3 transition-colors duration-150 sm:px-6">
                      {/* Name & Details */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/camper/${camper.person_cm_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="dark:text-foreground hover:text-forest-700 dark:hover:text-forest-400 truncate text-base font-semibold text-stone-800 transition-colors"
                          >
                            {camper.name}
                          </Link>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="dark:text-muted-foreground text-sm text-stone-500">
                            Grade {camper.grade} ·{' '}
                            {(getDisplayAgeForYear(camper, currentYear) ?? 0).toFixed(2)} yrs ·{' '}
                            {camper.gender === 'M'
                              ? 'Boy'
                              : camper.gender === 'F'
                                ? 'Girl'
                                : camper.gender}
                          </span>
                          {genderIdentity && genderIdentity !== 'Unknown' && (
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-xs ${getGenderBadgeClasses(getGenderCategory(genderIdentity), genderIdentity)}`}
                            >
                              {genderIdentity}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Bunk Badge / Unassigned */}
                      <div className="w-28 flex-shrink-0 text-center">
                        {camper.bunkName ? (
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold ${getBunkAreaColor(camper.bunkName)}`}
                          >
                            <Home className="h-3.5 w-3.5" />
                            {camper.bunkName}
                          </span>
                        ) : (
                          <span className="dark:text-muted-foreground text-sm text-stone-400 italic">
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
