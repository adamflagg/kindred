/**
 * CanonicalBrowser — Searchable list of canonical entries.
 *
 * Parchment-themed browsable list with debounced free-text search.
 * Results displayed as expandable CanonicalCard components.
 */
import { useState, useMemo, useEffect, useRef } from 'react'
import { Search, Compass } from 'lucide-react'
import { useCanonicalSearch } from '../../../hooks/useGeoData'
import { CanonicalCard } from './CanonicalCard'
import type { GeoCategory } from '../geoConstants'

export interface CanonicalBrowserProps {
  category: GeoCategory
  year: number
}

/** Debounce delay for search input (ms). */
const DEBOUNCE_MS = 300

export function CanonicalBrowser({ category, year }: CanonicalBrowserProps): React.ReactNode {
  const [searchInput, setSearchInput] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [expandedName, setExpandedName] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const { data } = useCanonicalSearch(category, debouncedQuery, year, debouncedQuery.length > 0)

  const results = useMemo(() => data?.results ?? [], [data])

  function handleSearchChange(value: string) {
    setSearchInput(value)

    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    timerRef.current = setTimeout(() => {
      setDebouncedQuery(value.trim())
    }, DEBOUNCE_MS)
  }

  function handleToggleExpand(canonicalName: string) {
    setExpandedName((prev) => (prev === canonicalName ? null : canonicalName))
  }

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          {debouncedQuery ? (
            <Search className="h-4 w-4 text-forest-500 dark:text-forest-400" />
          ) : (
            <Compass className="h-4 w-4 text-stone-400 dark:text-stone-500" />
          )}
        </div>
        <input
          type="search"
          placeholder="Search canonical entries..."
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full rounded-lg border border-forest-200 bg-white py-2 pl-10 pr-4 text-sm placeholder:text-stone-400 focus:border-forest-400 focus:outline-none focus:ring-1 focus:ring-forest-400 dark:border-forest-700 dark:bg-forest-900/30 dark:placeholder:text-stone-500 dark:focus:border-forest-500 dark:focus:ring-forest-500"
        />
      </div>

      {/* Results */}
      {results.length > 0 ? (
        <div className="space-y-2">
          {results.map((entry) => (
            <CanonicalCard
              key={entry.canonical_name}
              entry={entry}
              category={category}
              year={year}
              isExpanded={expandedName === entry.canonical_name}
              onToggleExpand={() => handleToggleExpand(entry.canonical_name)}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50/50 px-4 py-8 dark:border-stone-600 dark:bg-stone-900/20">
          <span className="text-sm text-stone-500 dark:text-stone-400">
            {data
              ? 'No results found'
              : 'Enter a search term to browse canonical entries'}
          </span>
        </div>
      )}
    </div>
  )
}

export default CanonicalBrowser
