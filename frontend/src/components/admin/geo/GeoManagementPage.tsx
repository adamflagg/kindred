import { useState, useCallback, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { MapPin } from 'lucide-react'
import { CATEGORY_SIDEBAR, SUB_TAB_TO_CATEGORY, getActiveSubTab } from '../geoConstants'
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
  const [resolveDialog, setResolveDialog] = useState<ResolveDialogState>({
    open: false,
    gapName: '',
    gapType: '',
  })

  const { data: gaps, isLoading, isError } = useGeoGaps(category, year, activeOnly)
  useGeoPagePrefetch(category, year, activeOnly)
  const totalGaps = gaps?.total_gaps ?? 0
  const batchResolve = useBatchResolveCoords(category, year)

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

      {/* Main content: sidebar + split panels */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <nav className="border-border flex w-16 flex-col gap-1 border-r px-1.5 py-2">
          {CATEGORY_SIDEBAR.map((item) => {
            const Icon = item.icon
            const isActive = category === item.id
            return (
              <Link
                key={item.id}
                to={item.path}
                data-active={isActive}
                className={`flex flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-center transition-colors ${
                  isActive
                    ? 'bg-forest-100 text-forest-800 dark:bg-forest-800 dark:text-forest-200'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium leading-tight">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Split panels */}
        <div className="grid min-h-0 flex-1 grid-cols-[2fr_3fr]">
          <div data-testid="left-panel" className="border-border space-y-4 overflow-y-auto border-r p-3">
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
                />
                <AddCoordsPanel
                  gaps={gaps.canonical_no_coords}
                  onAdd={(name) => handleOpenResolve(name, 'canonical_no_coords')}
                  onBatchResolve={handleBatchResolve}
                  isBatchResolving={batchResolve.isPending}
                />
              </>
            ) : null}
          </div>
          <div data-testid="right-panel" className="overflow-y-auto p-3">
            <CanonicalReferenceList
              category={category}
              year={year}
              onReassignSource={(originalValue) => handleOpenResolve(originalValue, 'non_canonical_grouped')}
            />
          </div>
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
