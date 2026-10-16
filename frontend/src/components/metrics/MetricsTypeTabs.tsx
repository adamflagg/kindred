/**
 * MetricsTypeTabs - Primary navigation for metrics module
 * Pattern: SessionTabs.tsx - rounded pills with icons, route-based
 *
 * Includes a unified session selector on the right side that applies across most metrics tabs.
 *
 * PR 4 pick 4B: each section's control shows on every one of its pages; where it does nothing it
 * is disabled with the reason written inside (metricsControls.ts). On an empty season (board 9 A)
 * every working control reads "no {year} enrollments yet", and the picker stays live.
 */
import { Link, useLocation } from 'react-router'
import { BarChart3, Sunrise, Users, TrendingUp, type LucideIcon } from 'lucide-react'
import { MetricsSessionSelector } from './MetricsSessionSelector'
import { CompareYearSelector } from './CompareYearSelector'
import { useMetricsSession } from '../../hooks/useMetricsSession'
import { useCurrentYear } from '../../hooks/useCurrentYear'
import { useSeasonHasRows } from '../../hooks/useSeasonHasRows'
import { metricsControls, type ControlState } from './metricsControls'

interface MetricTypeTab {
  id: string
  label: string
  icon: LucideIcon
  path: string
}

/** A checkbox control; disabled, it writes its reason inside its own label ("Expanded analysis: not on Velocity"). */
function CheckControl({
  label,
  state,
  checked,
  onChange,
  tour,
}: {
  label: string
  state: ControlState
  checked: boolean
  onChange: (checked: boolean) => void
  tour: string
}) {
  if (!state.shown) return null
  const off = state.reason !== null
  return (
    <label
      className={`flex items-center gap-1.5 text-sm ${off ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
      data-tour={tour}
    >
      <input
        type="checkbox"
        checked={checked && !off}
        disabled={off}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-primary h-3.5 w-3.5 rounded"
      />
      <span className="text-muted-foreground whitespace-nowrap">
        {off ? `${label}: ${state.reason}` : label}
      </span>
    </label>
  )
}

const METRIC_TYPES: MetricTypeTab[] = [
  // Summer at a glance (#3207 PR 8). Its comparison is fixed (same point last year), so it shows no
  // Compare or Expanded analysis control; the session picker stays (decision 15).
  { id: 'today', label: 'Today', icon: Sunrise, path: '/analytics/today' },
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
    scopeHasTeens,
  } = useMetricsSession()
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

  const { hasRows } = useSeasonHasRows(currentYear)
  const controls = metricsControls(location.pathname, {
    scopeHasTeens,
    emptyYear: hasRows === false ? currentYear : null,
  })

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

        {/* Right side controls */}
        <div className="flex items-center gap-3" data-tour="metrics-session-selector">
          {controls.compare.shown && (
            <div data-tour="metrics-compare-year">
              <CompareYearSelector
                primaryYear={currentYear}
                compareYear={compareYear}
                onCompareYearChange={setCompareYear}
                onClear={() => setCompareYear(null)}
                availableYears={availableYears}
                disabledReason={controls.compare.reason}
              />
            </div>
          )}
          <CheckControl
            label="Expanded analysis"
            state={controls.expanded}
            checked={expandedRetention}
            onChange={setExpandedRetention}
            tour="metrics-expanded-analysis"
          />
          <CheckControl
            label="Include camp → teen transition"
            state={controls.teen}
            checked={includeTeenPipeline}
            onChange={setIncludeTeenPipeline}
            tour="metrics-teen-pipeline"
          />
          <MetricsSessionSelector notUsedHere={!controls.pickerUsed} />
        </div>
      </div>
    </nav>
  )
}
