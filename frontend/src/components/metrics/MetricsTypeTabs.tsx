/**
 * MetricsTypeTabs - Primary navigation for metrics module
 * Pattern: SessionTabs.tsx - rounded pills with icons, route-based
 *
 * Includes a unified session selector on the right side that applies
 * across all metrics tabs (Registration, Retention, Trends).
 */
import { Link, useLocation } from 'react-router'
import { BarChart3, Users, TrendingUp, type LucideIcon } from 'lucide-react'
import { MetricsSessionSelector } from './MetricsSessionSelector'
import { useMetricsSession } from '../../hooks/useMetricsSession'

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
    path: '/metrics/registration',
  },
  {
    id: 'retention',
    label: 'Retention',
    icon: Users,
    path: '/metrics/retention',
  },
  { id: 'trends', label: 'Trends', icon: TrendingUp, path: '/metrics/trends' },
]

export default function MetricsTypeTabs() {
  const location = useLocation()
  const { expandedRetention, setExpandedRetention } = useMetricsSession()

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
        <div className="flex flex-wrap gap-1.5">
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

        {/* Right side controls — hidden on bunk retention tab (unfiltered data) */}
        {!location.pathname.endsWith('/retention/bunks') && (
          <div className="flex items-center gap-3">
            {activeTab === 'trends' && (
              <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={expandedRetention}
                  onChange={(e) => setExpandedRetention(e.target.checked)}
                  className="accent-primary h-3.5 w-3.5 rounded"
                />
                <span className="text-muted-foreground whitespace-nowrap">Expanded analysis</span>
              </label>
            )}
            <MetricsSessionSelector />
          </div>
        )}
      </div>
    </nav>
  )
}
