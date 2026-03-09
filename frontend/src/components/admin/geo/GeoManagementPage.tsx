import { useState, useCallback, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { AlertCircle, MapPin } from 'lucide-react'
import { SUB_TABS, SUB_TAB_TO_CATEGORY, getActiveSubTab } from '../geoConstants'
import type { GeoCategory } from '../geoConstants'
import { useGeoGaps, useBatchResolveCoords, useGeoPagePrefetch } from '../../../hooks/useGeoData'
import { NonCanonicalsPanel } from './NonCanonicalsPanel'
import { AddCoordsPanel } from './AddCoordsPanel'
import { CanonicalReferenceList } from './CanonicalReferenceList'
import { ResolveDialog } from './ResolveDialog'
import { useYear } from '../../../hooks/useCurrentYear'

interface ResolveDialogState {
  open: boolean
  gapName: string
  gapType: string
}

export function GeoManagementPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const year = useYear()
  const activeSubTab = getActiveSubTab(location.pathname)
  const category = (SUB_TAB_TO_CATEGORY[activeSubTab] ?? 'city') as GeoCategory
  const [activeOnly, setActiveOnly] = useState(true)
  const [nonCanonicalsOpen, setNonCanonicalsOpen] = useState(false)
  const [coordsOpen, setCoordsOpen] = useState(false)
  const [prevCategory, setPrevCategory] = useState(category)
  if (prevCategory !== category) {
    setPrevCategory(category)
    setNonCanonicalsOpen(false)
    setCoordsOpen(false)
  }
  const [resolveDialog, setResolveDialog] = useState<ResolveDialogState>({
    open: false,
    gapName: '',
    gapType: '',
  })

  const { data: gaps, isLoading, isError } = useGeoGaps(category, year, activeOnly)
  useGeoPagePrefetch(category, year, activeOnly)
  const totalGaps = gaps?.total_gaps ?? 0
  const batchResolve = useBatchResolveCoords(category, year)

  const nonCanonicalsCount =
    (gaps?.non_canonical_grouped.length ?? 0) + (gaps?.non_canonical_ungrouped.length ?? 0)
  const coordsCount = gaps?.canonical_no_coords.length ?? 0

  const handleOpenResolve = useCallback((gapName: string, gapType: string) => {
    setResolveDialog({ open: true, gapName, gapType })
  }, [])

  const handleCloseResolve = useCallback(() => {
    setResolveDialog({ open: false, gapName: '', gapType: '' })
  }, [])

  const handleBatchResolve = useCallback(() => {
    void batchResolve.mutateAsync()
  }, [batchResolve])

  // Default redirect
  useEffect(() => {
    if (location.pathname === '/admin/geo' || location.pathname === '/admin/geo/') {
      void navigate('/admin/geo/cities', { replace: true })
    }
  }, [location.pathname, navigate])

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="bg-forest-100 dark:bg-forest-800 rounded-lg p-2">
          <MapPin className="text-forest-700 dark:text-forest-300 h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-foreground text-lg font-bold">Geographic Data</h2>
          <p className="text-muted-foreground text-xs">
            Manage canonical names, coordinates, and normalization overrides
          </p>
        </div>
      </div>

      {/* Horizontal tab bar */}
      <div
        data-testid="category-tabs"
        className="border-border flex items-center gap-1 border-b px-4"
      >
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeSubTab === tab.id
          return (
            <Link
              key={tab.id}
              to={tab.path}
              data-active={isActive}
              className={`flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-forest-100 text-forest-800 dark:bg-forest-800 dark:text-forest-200 border-forest-500 border-b-2'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground border-b-2 border-transparent'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </Link>
          )
        })}
      </div>

      {/* Split panels */}
      <div className="grid min-h-0 flex-1 grid-cols-2">
        <div
          data-testid="left-panel"
          className="border-border space-y-4 overflow-y-auto border-r p-3"
        >
          {/* Stat summary cards */}
          <div className="grid grid-cols-2 gap-3">
            <button
              data-testid="stat-unresolved"
              onClick={() => setNonCanonicalsOpen((prev) => !prev)}
              className={`flex cursor-pointer items-center gap-3 rounded-xl p-3 text-left transition-all ${
                nonCanonicalsCount > 0
                  ? 'bg-red-50 ring-1 ring-red-200 dark:bg-red-950/30 dark:ring-red-800'
                  : 'bg-muted/50'
              }`}
            >
              <div
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
                  nonCanonicalsCount > 0 ? 'bg-red-100 dark:bg-red-900/50' : 'bg-background'
                }`}
              >
                <AlertCircle
                  className={`h-5 w-5 ${
                    nonCanonicalsCount > 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-muted-foreground'
                  }`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">Unresolved</p>
                <p
                  className={`text-lg font-semibold ${
                    nonCanonicalsCount > 0 ? 'text-red-700 dark:text-red-300' : ''
                  }`}
                >
                  {nonCanonicalsCount}
                </p>
              </div>
            </button>

            <button
              data-testid="stat-missing-coords"
              onClick={() => setCoordsOpen((prev) => !prev)}
              className={`flex cursor-pointer items-center gap-3 rounded-xl p-3 text-left transition-all ${
                coordsCount > 0
                  ? 'bg-amber-50 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-800'
                  : 'bg-muted/50'
              }`}
            >
              <div
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
                  coordsCount > 0 ? 'bg-amber-100 dark:bg-amber-900/50' : 'bg-background'
                }`}
              >
                <MapPin
                  className={`h-5 w-5 ${
                    coordsCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                  }`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">
                  Missing Coords
                </p>
                <p
                  className={`text-lg font-semibold ${
                    coordsCount > 0 ? 'text-amber-700 dark:text-amber-300' : ''
                  }`}
                >
                  {coordsCount}
                </p>
              </div>
            </button>
          </div>

          {/* Collapsible sections */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-muted-foreground text-sm">Loading gaps...</span>
            </div>
          ) : isError ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-sm text-red-500">Failed to load gap data</span>
            </div>
          ) : gaps ? (
            <>
              <NonCanonicalsPanel
                grouped={gaps.non_canonical_grouped}
                ungrouped={gaps.non_canonical_ungrouped}
                onResolve={handleOpenResolve}
                isOpen={nonCanonicalsOpen}
                onToggle={() => setNonCanonicalsOpen((prev) => !prev)}
              />
              <AddCoordsPanel
                gaps={gaps.canonical_no_coords}
                onAdd={(name) => handleOpenResolve(name, 'canonical_no_coords')}
                onBatchResolve={handleBatchResolve}
                isBatchResolving={batchResolve.isPending}
                isOpen={coordsOpen}
                onToggle={() => setCoordsOpen((prev) => !prev)}
              />
            </>
          ) : null}
        </div>
        <div data-testid="right-panel" className="overflow-y-auto p-3">
          <CanonicalReferenceList
            category={category}
            year={year}
            onReassignSource={(originalValue) =>
              handleOpenResolve(originalValue, 'non_canonical_grouped')
            }
          />
        </div>
      </div>

      {/* Global bottom bar */}
      <div className="border-border bg-muted/30 flex items-center justify-between border-t px-4 py-2">
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="checkbox-lodge"
            aria-label="Active enrollees only"
          />
          Active enrollees only
        </label>
        <span className="text-muted-foreground text-sm">
          {totalGaps} {totalGaps === 1 ? 'gap' : 'gaps'} remaining
        </span>
      </div>

      {/* Resolve dialog */}
      <ResolveDialog
        open={resolveDialog.open}
        onClose={handleCloseResolve}
        gapName={resolveDialog.gapName}
        gapType={resolveDialog.gapType}
        category={category}
        year={year}
      />
    </div>
  )
}
