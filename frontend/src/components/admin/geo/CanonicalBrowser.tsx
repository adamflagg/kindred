/**
 * CanonicalBrowser — Searchable list of canonical entries.
 *
 * Prefetches all in-use canonicals once (cached 1hr), then filters
 * client-side for instant typeahead. No per-keystroke API calls.
 */
import { useState, useMemo } from 'react'
import { Search, Compass } from 'lucide-react'
import { useAllCanonicals } from '../../../hooks/useGeoData'
import { CanonicalCard } from './CanonicalCard'
import type { GeoCategory } from '../geoConstants'

export interface CanonicalBrowserProps {
  category: GeoCategory
  year: number
}

export function CanonicalBrowser({ category, year }: CanonicalBrowserProps): React.ReactNode {
  const [searchInput, setSearchInput] = useState('')
  const [expandedName, setExpandedName] = useState<string | null>(null)

  const { data, isLoading } = useAllCanonicals(category, year)

  // Client-side filter — instant, no debounce needed
  const results = useMemo(() => {
    const all = data?.results ?? []
    const q = searchInput.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (entry) =>
        entry.canonical_name.toLowerCase().includes(q) ||
        entry.city.toLowerCase().includes(q) ||
        entry.state.toLowerCase().includes(q)
    )
  }, [data, searchInput])

  function handleToggleExpand(canonicalName: string) {
    setExpandedName((prev) => (prev === canonicalName ? null : canonicalName))
  }

  return (
    <div className="space-y-3">
      {/* Search input */}
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
          placeholder="Search canonical entries..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="border-forest-200 focus:border-forest-400 focus:ring-forest-400 dark:border-forest-700 dark:bg-forest-900/30 dark:focus:border-forest-500 dark:focus:ring-forest-500 w-full rounded-lg border bg-white py-2 pr-4 pl-10 text-sm placeholder:text-stone-400 focus:ring-1 focus:outline-none dark:placeholder:text-stone-500"
        />
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center px-4 py-8">
          <span className="text-muted-foreground text-sm">Loading entries...</span>
        </div>
      ) : results.length > 0 ? (
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
            {searchInput ? 'No results found' : 'No in-use entries for this category'}
          </span>
        </div>
      )}
    </div>
  )
}

export default CanonicalBrowser
