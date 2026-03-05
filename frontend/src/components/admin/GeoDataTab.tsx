import { Link, useLocation, useNavigate } from 'react-router'
import { MapPin } from 'lucide-react'
import { useEffect } from 'react'
import { SUB_TABS, getActiveSubTab } from './geoConstants'

export function GeoDataTab() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeSubTab = getActiveSubTab(location.pathname)

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
      <div className="card-lodge border-forest-200 dark:border-forest-700 border p-4 sm:p-6">
        <p className="text-muted-foreground text-sm">
          {activeSubTab === 'cities' && 'City gap analysis and canonical management coming soon.'}
          {activeSubTab === 'schools' &&
            'School gap analysis and canonical management coming soon.'}
          {activeSubTab === 'congregations' &&
            'Congregation gap analysis and canonical management coming soon.'}
        </p>
      </div>
    </div>
  )
}
