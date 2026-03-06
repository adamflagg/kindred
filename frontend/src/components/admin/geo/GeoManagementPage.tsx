import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { MapPin } from 'lucide-react'
import { CATEGORY_SIDEBAR, SUB_TAB_TO_CATEGORY, getActiveSubTab } from '../geoConstants'
import type { GeoCategory } from '../geoConstants'
import { useGeoGaps } from '../../../hooks/useGeoData'
import { useYear } from '../../../hooks/useCurrentYear'

export function GeoManagementPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const year = useYear()
  const activeSubTab = getActiveSubTab(location.pathname)
  const category = (SUB_TAB_TO_CATEGORY[activeSubTab] ?? 'city') as GeoCategory
  const [activeOnly, setActiveOnly] = useState(true)

  const { data: gaps } = useGeoGaps(category, year, activeOnly)
  const totalGaps = gaps?.total_gaps ?? 0

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
          <div data-testid="left-panel" className="border-border overflow-y-auto border-r p-3">
            <p className="text-muted-foreground text-sm">Left panel: gaps</p>
          </div>
          <div data-testid="right-panel" className="overflow-y-auto p-3">
            <p className="text-muted-foreground text-sm">Right panel: canonicals</p>
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
    </div>
  )
}
