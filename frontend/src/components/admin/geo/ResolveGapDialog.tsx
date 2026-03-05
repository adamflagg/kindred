/**
 * ResolveGapDialog — Dialog for resolving geo gaps.
 *
 * Provides a combobox/autocomplete to search existing canonical entries,
 * with an option to create a new canonical entry if no match is found.
 *
 * Used by GapsPanel when the user clicks "Resolve" or "Add Location"
 * on a gap item.
 */

import { useState, useCallback } from 'react'
import { Search, Plus, MapPin } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { useCanonicalSearch, useCreateOverride } from '../../../hooks/useGeoData'
import type { GeoCategory } from '../geoConstants'
import type { OverrideCreateData, CanonicalEntry } from '../../../services/geoService'

interface ResolveGapDialogProps {
  isOpen: boolean
  onClose: () => void
  gapName: string
  gapType: string
  category: GeoCategory
  year: number
}

/** Map gap type to the override_type used by the API. */
function getOverrideType(gapType: string): string {
  if (gapType === 'canonical_no_coords') return 'add_coords'
  return 'map_to_canonical'
}

export function ResolveGapDialog({
  isOpen,
  onClose,
  gapName,
  gapType,
  category,
  year,
}: ResolveGapDialogProps) {
  const [query, setQuery] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newCanonicalName, setNewCanonicalName] = useState('')
  const [newCity, setNewCity] = useState('')
  const [newState, setNewState] = useState('')

  const searchEnabled = query.length >= 2 && !showCreateForm
  const { data: searchResults, isLoading: isSearching } = useCanonicalSearch(
    category,
    query,
    year,
    searchEnabled
  )

  const createOverride = useCreateOverride(category, year)

  const resetForm = useCallback(() => {
    setQuery('')
    setShowCreateForm(false)
    setNewCanonicalName('')
    setNewCity('')
    setNewState('')
  }, [])

  const handleClose = useCallback(() => {
    resetForm()
    onClose()
  }, [resetForm, onClose])

  const handleSelectCanonical = useCallback(
    async (entry: CanonicalEntry) => {
      const data: OverrideCreateData = {
        category,
        override_type: getOverrideType(gapType),
        raw_value: gapName,
        canonical_name: entry.canonical_name,
        city: entry.city,
        state: entry.state,
        year,
      }
      await createOverride.mutateAsync(data)
      handleClose()
    },
    [category, gapType, gapName, year, createOverride, handleClose]
  )

  const handleCreateNew = useCallback(async () => {
    if (!newCanonicalName.trim()) return
    const data: OverrideCreateData = {
      category,
      override_type: gapType === 'canonical_no_coords' ? 'add_coords' : 'create_canonical',
      ...(gapType !== 'canonical_no_coords' ? { raw_value: gapName } : {}),
      canonical_name: newCanonicalName.trim(),
      ...(newCity.trim() ? { city: newCity.trim() } : {}),
      ...(newState.trim() ? { state: newState.trim() } : {}),
      year,
    }
    await createOverride.mutateAsync(data)
    handleClose()
  }, [
    category,
    gapType,
    gapName,
    year,
    newCanonicalName,
    newCity,
    newState,
    createOverride,
    handleClose,
  ])

  const results = searchResults?.results ?? []

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`Resolve: ${gapName}`} size="md">
      {!showCreateForm ? (
        <div className="space-y-4">
          {/* Search input */}
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search existing entries..."
              className="bg-muted/50 border-border focus:ring-forest-500 w-full rounded-lg border py-2 pr-4 pl-10 text-sm focus:ring-2 focus:outline-none"
              autoFocus
            />
          </div>

          {/* Search results */}
          {isSearching && <p className="text-muted-foreground px-2 text-sm">Searching...</p>}

          {searchEnabled && !isSearching && results.length === 0 && (
            <p className="text-muted-foreground px-2 text-sm">No matching entries found.</p>
          )}

          {results.length > 0 && (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {results.map((entry) => (
                <button
                  key={`${entry.canonical_name}-${entry.city}-${entry.state}`}
                  className="hover:bg-muted/50 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors"
                  onClick={() => void handleSelectCanonical(entry)}
                  disabled={createOverride.isPending}
                >
                  <MapPin className="text-forest-600 dark:text-forest-400 h-4 w-4 shrink-0" />
                  <div>
                    <div className="text-foreground font-medium">{entry.canonical_name}</div>
                    {(entry.city || entry.state) && (
                      <div className="text-muted-foreground text-xs">
                        {[entry.city, entry.state].filter(Boolean).join(', ')}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Create new entry option */}
          <div className="border-border border-t pt-3">
            <button
              className="text-forest-700 hover:text-forest-900 dark:text-forest-400 dark:hover:text-forest-200 flex items-center gap-2 text-sm font-medium transition-colors"
              onClick={() => {
                setShowCreateForm(true)
                setNewCanonicalName(gapName)
              }}
            >
              <Plus className="h-4 w-4" />
              Create new entry
            </button>
          </div>
        </div>
      ) : (
        /* Create new entry form */
        <div className="space-y-4">
          <div>
            <label
              htmlFor="canonical-name"
              className="text-foreground mb-1 block text-sm font-medium"
            >
              Canonical Name
            </label>
            <input
              id="canonical-name"
              type="text"
              value={newCanonicalName}
              onChange={(e) => setNewCanonicalName(e.target.value)}
              className="bg-muted/50 border-border focus:ring-forest-500 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="city" className="text-foreground mb-1 block text-sm font-medium">
                City
              </label>
              <input
                id="city"
                type="text"
                value={newCity}
                onChange={(e) => setNewCity(e.target.value)}
                className="bg-muted/50 border-border focus:ring-forest-500 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="state" className="text-foreground mb-1 block text-sm font-medium">
                State
              </label>
              <input
                id="state"
                type="text"
                value={newState}
                onChange={(e) => setNewState(e.target.value)}
                className="bg-muted/50 border-border focus:ring-forest-500 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              className="btn-ghost px-4 py-2 text-sm"
              onClick={() => setShowCreateForm(false)}
            >
              Back
            </button>
            <button
              className="btn-primary px-4 py-2 text-sm"
              onClick={() => void handleCreateNew()}
              disabled={!newCanonicalName.trim() || createOverride.isPending}
            >
              {createOverride.isPending ? 'Creating...' : 'Create Entry'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default ResolveGapDialog
