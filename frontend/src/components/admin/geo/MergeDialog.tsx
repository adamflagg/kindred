/**
 * MergeDialog -- Dialog for merging one canonical into another.
 *
 * Lets the user search for a target canonical and merge the source into it.
 * All source variants will be reassigned to the target canonical.
 */

import { useState, useCallback, useMemo } from 'react'
import { Search, MapPin } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { useAllCanonicals, useMergeCanonical } from '../../../hooks/useGeoData'
import { sourceLabel, sourceBadgeClasses, formatLocation, type GeoCategory } from '../geoConstants'
import type { CanonicalEntry } from '../../../services/geoService'

interface MergeDialogProps {
  open: boolean
  onClose: () => void
  sourceCanonical: string
  category: GeoCategory
  year: number
}

export function MergeDialog({ open, onClose, sourceCanonical, category, year }: MergeDialogProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEntry, setSelectedEntry] = useState<CanonicalEntry | null>(null)
  const [searchAll, setSearchAll] = useState(false)

  const { data: allCanonicals } = useAllCanonicals(category, year, !searchAll)
  const mergeMutation = useMergeCanonical(category, year)

  // Client-side filtering: exclude the source canonical and filter by query
  const filteredResults = useMemo(() => {
    const results = allCanonicals?.results ?? []
    const withoutSource = results.filter((entry) => entry.canonical_name !== sourceCanonical)
    const q = searchQuery.trim().toLowerCase()

    // In search-all mode, require 3+ characters before showing results
    if (searchAll && q.length < 3) return []

    if (!q) return withoutSource
    return withoutSource.filter(
      (entry) =>
        entry.canonical_name.toLowerCase().includes(q) ||
        entry.city.toLowerCase().includes(q) ||
        entry.state.toLowerCase().includes(q)
    )
  }, [allCanonicals, searchQuery, sourceCanonical, searchAll])

  const resetForm = useCallback(() => {
    setSearchQuery('')
    setSelectedEntry(null)
    setSearchAll(false)
  }, [])

  const handleClose = useCallback(() => {
    resetForm()
    onClose()
  }, [resetForm, onClose])

  const handleSelectCanonical = useCallback((entry: CanonicalEntry) => {
    setSelectedEntry(entry)
  }, [])

  const handleMerge = useCallback(async () => {
    if (!selectedEntry) return
    await mergeMutation.mutateAsync({
      canonicalName: sourceCanonical,
      target: selectedEntry.canonical_name,
    })
    handleClose()
  }, [sourceCanonical, selectedEntry, mergeMutation, handleClose])

  return (
    <Modal isOpen={open} onClose={handleClose} title={`Merge: ${sourceCanonical}`} size="md">
      <div className="space-y-4">
        {/* Description */}
        <p className="text-muted-foreground text-sm">
          All source variants will be reassigned to the target canonical.
        </p>

        {/* Search input */}
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setSelectedEntry(null)
            }}
            placeholder="Search canonicals..."
            className="bg-muted/50 border-border focus:ring-forest-500 w-full rounded-lg border py-2 pr-4 pl-10 text-sm focus:ring-2 focus:outline-none"
            // Deliberate: this dialog's entire purpose is searching for a merge target, so
            // taking focus on open lets the user start typing immediately.
            autoFocus
          />
        </div>

        {/* Search all toggle */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={searchAll}
            onChange={(e) => {
              setSearchAll(e.target.checked)
              setSelectedEntry(null)
            }}
            className="checkbox-lodge"
            aria-label="Search all"
          />
          <span className="text-muted-foreground">Search all</span>
        </label>

        {/* Results list */}
        {filteredResults.length > 0 && (
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {filteredResults.map((entry) => {
              const isSelected = selectedEntry
                ? selectedEntry.canonical_name === entry.canonical_name &&
                  selectedEntry.city === entry.city &&
                  selectedEntry.state === entry.state
                : false
              return (
                <button
                  key={`${entry.canonical_name}-${entry.city}-${entry.state}`}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    isSelected
                      ? 'bg-forest-100 dark:bg-forest-800/40 ring-forest-500 ring-2'
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => handleSelectCanonical(entry)}
                  disabled={mergeMutation.isPending}
                >
                  <MapPin className="text-forest-600 dark:text-forest-400 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground font-medium">{entry.canonical_name}</div>
                    {(entry.city || entry.state || entry.country) && (
                      <div className="text-muted-foreground text-xs">
                        {formatLocation(
                          entry.city,
                          entry.state,
                          entry.country,
                          entry.canonical_name
                        )}
                      </div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${sourceBadgeClasses(entry.source)}`}
                  >
                    {sourceLabel(entry.source)}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {entry.camper_count}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {filteredResults.length === 0 &&
          searchAll &&
          searchQuery.trim().length > 0 &&
          searchQuery.trim().length < 3 && (
            <p className="text-muted-foreground px-2 text-sm">
              Type 3+ characters to search all entries.
            </p>
          )}

        {filteredResults.length === 0 &&
          (!searchAll || searchQuery.trim().length >= 3) &&
          searchQuery.trim() && (
            <p className="text-muted-foreground px-2 text-sm">No matching entries found.</p>
          )}

        {/* Cancel + Merge */}
        <div className="border-border flex items-center justify-end gap-3 border-t pt-3">
          <button className="btn-ghost px-4 py-2 text-sm" onClick={handleClose}>
            Cancel
          </button>
          <button
            className="btn-primary px-4 py-2 text-sm"
            onClick={() => void handleMerge()}
            disabled={!selectedEntry || mergeMutation.isPending}
          >
            {mergeMutation.isPending ? 'Merging...' : 'Merge'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default MergeDialog
