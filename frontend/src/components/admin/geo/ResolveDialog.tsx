/**
 * ResolveDialog — Dialog for resolving geo gaps.
 *
 * Two modes based on gapType:
 *
 * Mode A (gapType !== 'canonical_no_coords'):
 *   Typeahead search over prefetched canonicals (client-side filtering).
 *   Select an existing canonical to map the gap, or create a new canonical entry.
 *
 * Mode B (gapType === 'canonical_no_coords'):
 *   Lat/lng input fields for adding coordinates to an existing canonical.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Search, Plus, MapPin } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { useAllCanonicals, useCreateOverride } from '../../../hooks/useGeoData'
import { sourceLabel, sourceBadgeClasses, formatLocation, type GeoCategory } from '../geoConstants'
import type { OverrideCreateData, CanonicalEntry } from '../../../services/geoService'

interface ResolveDialogProps {
  open: boolean
  onClose: () => void
  gapName: string
  gapType: string
  category: GeoCategory
  year: number
}

export function ResolveDialog({
  open,
  onClose,
  gapName,
  gapType,
  category,
  year,
}: ResolveDialogProps) {
  const isCoordMode = gapType === 'canonical_no_coords'

  // Shared state
  const [showCreateForm, setShowCreateForm] = useState(false)
  // Mid-dialog focus, owned HERE and not by ui/Modal: a branch switch mounts
  // its inputs while `isOpen` never changes, so Modal's beforeEnter focus
  // cannot re-fire. The inputs' `autoFocus` used to cover this and was
  // deleted (it broke focus RESTORATION when it fired at open — see
  // ui/Modal's `initialFocusRef` doc). Skipping the first run keeps open-time
  // focus with Modal, where the opener capture ordering is load-bearing.
  const searchInputRef = useRef<HTMLInputElement>(null)
  const createNameRef = useRef<HTMLInputElement>(null)
  const skipBranchFocusRef = useRef(true)
  useEffect(() => {
    if (skipBranchFocusRef.current) {
      skipBranchFocusRef.current = false
      return
    }
    ;(showCreateForm ? createNameRef : searchInputRef).current?.focus()
  }, [showCreateForm])

  // Mode A state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchAll, setSearchAll] = useState(false)
  const [selectedEntry, setSelectedEntry] = useState<CanonicalEntry | null>(null)
  const [newCanonicalName, setNewCanonicalName] = useState('')
  const [newCity, setNewCity] = useState('')
  const [newState, setNewState] = useState('')

  // Mode B state
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')

  const { data: allCanonicals } = useAllCanonicals(category, year, !searchAll)
  const createOverride = useCreateOverride(category, year)

  // Client-side filtering of prefetched canonicals
  const filteredResults = useMemo(() => {
    const results = allCanonicals?.results ?? []
    const q = searchQuery.trim().toLowerCase()

    // In search-all mode, require 3+ characters before showing results
    if (searchAll && q.length < 3) return []

    if (!q) return results
    return results.filter(
      (entry) =>
        entry.canonical_name.toLowerCase().includes(q) ||
        entry.city.toLowerCase().includes(q) ||
        entry.state.toLowerCase().includes(q)
    )
  }, [allCanonicals, searchQuery, searchAll])

  const resetForm = useCallback(() => {
    setSearchQuery('')
    setSearchAll(false)
    setSelectedEntry(null)
    setShowCreateForm(false)
    setNewCanonicalName('')
    setNewCity('')
    setNewState('')
    setLat('')
    setLng('')
  }, [])

  const handleClose = useCallback(() => {
    resetForm()
    onClose()
  }, [resetForm, onClose])

  const handleSelectCanonical = useCallback((entry: CanonicalEntry) => {
    setSelectedEntry(entry)
  }, [])

  const handleSaveMapping = useCallback(async () => {
    if (!selectedEntry) return
    const data: OverrideCreateData = {
      category,
      override_type: 'alias',
      raw_value: gapName,
      canonical_name: selectedEntry.canonical_name,
      year,
    }
    await createOverride.mutateAsync(data)
    handleClose()
  }, [category, gapName, year, selectedEntry, createOverride, handleClose])

  const handleCreateNew = useCallback(async () => {
    if (!newCanonicalName.trim()) return
    const data: OverrideCreateData = {
      category,
      override_type: 'canonical',
      raw_value: gapName,
      canonical_name: newCanonicalName.trim(),
      ...(newCity.trim() ? { city: newCity.trim() } : {}),
      ...(newState.trim() ? { state: newState.trim() } : {}),
      year,
    }
    await createOverride.mutateAsync(data)
    handleClose()
  }, [category, gapName, year, newCanonicalName, newCity, newState, createOverride, handleClose])

  const handleSaveCoords = useCallback(async () => {
    const latNum = parseFloat(lat)
    const lngNum = parseFloat(lng)
    if (isNaN(latNum) || isNaN(lngNum)) return
    const data: OverrideCreateData = {
      category,
      override_type: 'canonical',
      canonical_name: gapName,
      lat: latNum,
      lng: lngNum,
      year,
    }
    await createOverride.mutateAsync(data)
    handleClose()
  }, [category, gapName, year, lat, lng, createOverride, handleClose])

  const title = isCoordMode ? `Add Coordinates: ${gapName}` : `Resolve: ${gapName}`

  const coordsSaveDisabled =
    !lat.trim() ||
    !lng.trim() ||
    isNaN(parseFloat(lat)) ||
    isNaN(parseFloat(lng)) ||
    createOverride.isPending

  return (
    <Modal isOpen={open} onClose={handleClose} title={title} size="md">
      {isCoordMode ? (
        /* Mode B: lat/lng input */
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="latitude" className="text-foreground mb-1 block text-sm font-medium">
                Latitude
              </label>
              <input
                id="latitude"
                type="text"
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="e.g. 37.7749"
                className="bg-muted/50 border-border focus:ring-forest-500 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="longitude" className="text-foreground mb-1 block text-sm font-medium">
                Longitude
              </label>
              <input
                id="longitude"
                type="text"
                inputMode="decimal"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="e.g. -122.4194"
                className="bg-muted/50 border-border focus:ring-forest-500 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              className="btn-primary px-4 py-2 text-sm"
              onClick={() => void handleSaveCoords()}
              disabled={coordsSaveDisabled}
            >
              {createOverride.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      ) : !showCreateForm ? (
        /* Mode A: Search + select */
        <div className="space-y-4">
          {/* Search input */}
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setSelectedEntry(null)
              }}
              placeholder="Search existing entries..."
              className="bg-muted/50 border-border focus:ring-forest-500 w-full rounded-lg border py-2 pr-4 pl-10 text-sm focus:ring-2 focus:outline-none"
              // Open-time focus lands here via ui/Modal (first focusable in the
              // body); the "Back" return path lands here via the branch-switch
              // effect above.
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
                    disabled={createOverride.isPending}
                  >
                    <MapPin className="text-forest-600 dark:text-forest-400 h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-foreground font-medium">{entry.canonical_name}</div>
                      {(entry.city || entry.state || entry.country) && (
                        <div className="text-muted-foreground text-xs">
                          {formatLocation(entry.city, entry.state, entry.country)}
                        </div>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${sourceBadgeClasses(entry.source)}`}
                    >
                      {sourceLabel(entry.source)}
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

          {/* Save selected + Create new */}
          <div className="border-border flex items-center justify-between border-t pt-3">
            <button
              className="text-forest-700 hover:text-forest-900 dark:text-forest-400 dark:hover:text-forest-200 flex items-center gap-2 text-sm font-medium transition-colors"
              onClick={() => {
                setShowCreateForm(true)
                setNewCanonicalName(gapName)
              }}
            >
              <Plus className="h-4 w-4" />
              Create new
            </button>

            <button
              className="btn-primary px-4 py-2 text-sm"
              onClick={() => void handleSaveMapping()}
              disabled={!selectedEntry || createOverride.isPending}
            >
              {createOverride.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        /* Mode A: Create new canonical form */
        <div className="space-y-4">
          <div>
            <label
              htmlFor="canonical-name"
              className="text-foreground mb-1 block text-sm font-medium"
            >
              Name
            </label>
            <input
              ref={createNameRef}
              id="canonical-name"
              type="text"
              value={newCanonicalName}
              onChange={(e) => setNewCanonicalName(e.target.value)}
              className="bg-muted/50 border-border focus:ring-forest-500 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              // This form only appears once the user has chosen "Create new";
              // the branch-switch effect above puts the caret here so they can
              // start typing immediately instead of re-clicking into it.
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
              {createOverride.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default ResolveDialog
