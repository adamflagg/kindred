/**
 * MetricsTypeTabs - Primary navigation for metrics module
 * Pattern: SessionTabs.tsx - rounded pills with icons, route-based
 *
 * Includes a unified session selector on the right side that applies
 * across most metrics tabs (hidden on Bunk Analysis tab which uses unfiltered data).
 */
import { Link, useLocation } from 'react-router'
import { BarChart3, Users, TrendingUp, type LucideIcon } from 'lucide-react'
import { MetricsSessionSelector } from './MetricsSessionSelector'
import { CompareYearSelector } from './CompareYearSelector'
import { useMetricsSession } from '../../hooks/useMetricsSession'
import { useCurrentYear } from '../../hooks/useCurrentYear'
import { RETENTION_SUB_NAV } from '../../pages/metrics/metricsNav'

interface MetricTypeTab {
  id: string
  label: string
  icon: LucideIcon
  path: string
}

const METRIC_TYPES: MetricTypeTab[] = [
  {
    id: 'registration',
    label: 'Registration',
    icon: BarChart3,
    path: '/analytics/registration',
  },
  {
    id: 'retention',
    label: 'Retention',
    icon: Users,
    path: '/analytics/retention',
  },
  { id: 'trends', label: 'Trends', icon: TrendingUp, path: '/analytics/trends' },
]

export default function MetricsTypeTabs() {
  const location = useLocation()
  const {
    expandedRetention,
    setExpandedRetention,
    compareYear,
    setCompareYear,
    includeTeenPipeline,
    setIncludeTeenPipeline,
    activeSessionTypes,
  } = useMetricsSession()

  const scopeHasTeens = activeSessionTypes.some((t) => t === 'scit' || t === 'tli')
  const { currentYear, availableYears } = useCurrentYear()

  // Determine active tab based on current path
  const getActiveTab = () => {
    for (const tab of METRIC_TYPES) {
      if (location.pathname.startsWith(tab.path)) {
        return tab.id
      }
    }
    return 'registration'
  }

  const activeTab = getActiveTab()

  return (
    <nav className="border-border/50 border-b py-2">
      <div className="flex items-center justify-between">
        {/* Tab Pills - Left side */}
        <div className="flex flex-wrap gap-1.5" data-tour="metrics-section-tabs">
          {METRIC_TYPES.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <Link
                key={tab.id}
                to={tab.path + location.search}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-lodge-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-forest-50/50 dark:hover:bg-forest-950/30'
                } `}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </Link>
            )
          })}
        </div>

        {/* Right side controls — hidden on tabs that use unfiltered data */}
        {!RETENTION_SUB_NAV.filter((item) => item.id === 'bunks' || item.id === 'staff').some(
          (item) => item.path === location.pathname
        ) && (
          <div className="flex items-center gap-3" data-tour="metrics-session-selector">
            {activeTab === 'registration' &&
              !location.pathname.endsWith('/forecast') &&
              !location.pathname.endsWith('/availability') && (
                <div data-tour="metrics-compare-year">
                  <CompareYearSelector
                    primaryYear={currentYear}
                    compareYear={compareYear}
                    onCompareYearChange={setCompareYear}
                    onClear={() => setCompareYear(null)}
                    availableYears={availableYears}
                  />
                </div>
              )}
            {activeTab === 'trends' && !location.pathname.includes('/velocity') && (
              <label
                className="flex cursor-pointer items-center gap-1.5 text-sm"
                data-tour="metrics-expanded-analysis"
              >
                <input
                  type="checkbox"
                  checked={expandedRetention}
                  onChange={(e) => setExpandedRetention(e.target.checked)}
                  className="accent-primary h-3.5 w-3.5 rounded"
                />
                <span className="text-muted-foreground whitespace-nowrap">Expanded analysis</span>
              </label>
            )}
            {activeTab === 'retention' && scopeHasTeens && (
              <label
                className="flex cursor-pointer items-center gap-1.5 text-sm"
                data-tour="metrics-teen-pipeline"
              >
                <input
                  type="checkbox"
                  checked={includeTeenPipeline}
                  onChange={(e) => setIncludeTeenPipeline(e.target.checked)}
                  className="accent-primary h-3.5 w-3.5 rounded"
                />
                <span className="text-muted-foreground whitespace-nowrap">
                  Include camp → teen transition
                </span>
              </label>
            )}
            <MetricsSessionSelector />
          </div>
        )}
      </div>
    </nav>
  )
}
