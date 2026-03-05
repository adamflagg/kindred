import { useState, useCallback } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { MapPin, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { SUB_TABS, SUB_TAB_TO_CATEGORY, getActiveSubTab } from './geoConstants'
import type { GeoCategory } from './geoConstants'
import { GapsPanel } from './geo/GapsPanel'
import { CanonicalBrowser } from './geo/CanonicalBrowser'
import { ResolveGapDialog } from './geo/ResolveGapDialog'
import { useGeoGaps, useGeoOverrides, useDeleteOverride } from '../../hooks/useGeoData'
import { useYear } from '../../hooks/useCurrentYear'

export function GeoDataTab() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeSubTab = getActiveSubTab(location.pathname)
  const year = useYear()
  const category = (SUB_TAB_TO_CATEGORY[activeSubTab] ?? 'city') as GeoCategory

  // Resolve dialog state
  const [resolveDialog, setResolveDialog] = useState<{
    isOpen: boolean
    gapName: string
    gapType: string
  }>({ isOpen: false, gapName: '', gapType: '' })

  const handleResolve = useCallback((gapName: string, gapType: string) => {
    setResolveDialog({ isOpen: true, gapName, gapType })
  }, [])

  const handleCloseResolve = useCallback(() => {
    setResolveDialog({ isOpen: false, gapName: '', gapType: '' })
  }, [])

  // Default redirect: /admin/geo -> /admin/geo/cities
  useEffect(() => {
    if (location.pathname === '/admin/geo' || location.pathname === '/admin/geo/') {
      void navigate('/admin/geo/cities', { replace: true })
    }
  }, [location.pathname, navigate])

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="card-lodge border-forest-200 dark:border-forest-700 border p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="bg-forest-100 dark:bg-forest-800 rounded-lg p-2">
            <MapPin className="text-forest-700 dark:text-forest-300 h-5 w-5 sm:h-6 sm:w-6" />
          </div>
          <div>
            <h2 className="font-display text-foreground text-lg font-bold sm:text-xl">
              Geographic Data
            </h2>
            <p className="text-muted-foreground text-xs sm:text-sm">
              Manage canonical names, coordinates, and normalization overrides
            </p>
          </div>
        </div>
      </div>

      {/* Sub-tab Navigation */}
      <div className="bg-muted/50 dark:bg-muted flex w-full gap-1 rounded-lg p-1 sm:w-fit sm:gap-1.5 sm:p-1.5">
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeSubTab === tab.id
          return (
            <Link
              key={tab.id}
              to={tab.path}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold transition-colors sm:flex-none sm:gap-2 sm:px-4 sm:py-2.5 sm:text-base ${
                isActive
                  ? 'bg-card text-forest-800 dark:text-forest-200 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </Link>
          )
        })}
      </div>

      {/* Sub-tab Content */}
      <GeoSubTabContent category={category} year={year} onResolve={handleResolve} />

      {/* Resolve Gap Dialog */}
      <ResolveGapDialog
        isOpen={resolveDialog.isOpen}
        onClose={handleCloseResolve}
        gapName={resolveDialog.gapName}
        gapType={resolveDialog.gapType}
        category={category}
        year={year}
      />
    </div>
  )
}

/** Content for a single sub-tab — gaps, overrides, and canonical browser. */
function GeoSubTabContent({
  category,
  year,
  onResolve,
}: {
  category: GeoCategory
  year: number
  onResolve: (gapName: string, gapType: string) => void
}) {
  const { data: gaps, isLoading: gapsLoading } = useGeoGaps(category, year)
  const { data: overrides, isLoading: overridesLoading } = useGeoOverrides(category, year)
  const deleteOverride = useDeleteOverride(category, year)

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Gaps Panel */}
      <section>
        <h3 className="text-foreground mb-2 text-sm font-semibold">Gaps</h3>
        {gapsLoading ? (
          <div className="card-lodge border-forest-200 dark:border-forest-700 border p-4">
            <p className="text-muted-foreground text-sm">Loading gaps...</p>
          </div>
        ) : gaps ? (
          <GapsPanel gaps={gaps} category={category} year={year} onResolve={onResolve} />
        ) : null}
      </section>

      {/* Active Overrides */}
      {!overridesLoading && overrides && overrides.length > 0 && (
        <section>
          <h3 className="text-foreground mb-2 text-sm font-semibold">
            Active Overrides ({overrides.length})
          </h3>
          <div className="card-lodge border-forest-200 dark:border-forest-700 overflow-hidden border">
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-border border-b text-left">
                    <th className="px-3 py-1.5 font-medium">Type</th>
                    <th className="px-3 py-1.5 font-medium">From</th>
                    <th className="px-3 py-1.5 font-medium">To</th>
                    <th className="w-10 px-3 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {overrides.map((o) => (
                    <tr key={o.id} className="border-border border-t">
                      <td className="px-3 py-1.5">
                        <span className="bg-muted rounded px-1.5 py-0.5 text-xs font-medium">
                          {o.override_type}
                        </span>
                      </td>
                      <td className="text-muted-foreground px-3 py-1.5">{o.raw_value || '—'}</td>
                      <td className="text-foreground px-3 py-1.5 font-medium">
                        {o.merged_into || o.canonical_name}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          className="text-red-500 transition-colors hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                          onClick={() => deleteOverride.mutate(o.id)}
                          disabled={deleteOverride.isPending}
                          title="Delete override"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Canonical Browser */}
      <section>
        <h3 className="text-foreground mb-2 text-sm font-semibold">Canonical Browser</h3>
        <CanonicalBrowser category={category} year={year} />
      </section>
    </div>
  )
}
