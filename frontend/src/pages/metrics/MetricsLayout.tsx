/**
 * MetricsLayout - Shared layout wrapper for metrics module
 * Provides sticky navigation with primary tabs and conditional sub-nav
 * Wraps content with MetricsSessionProvider for unified session filtering
 */
import { Outlet, useLocation } from 'react-router'
import { Loader2 } from 'lucide-react'
import MetricsTypeTabs from '../../components/metrics/MetricsTypeTabs'
import MetricsSubNav from '../../components/metrics/MetricsSubNav'
import type { SubNavItem } from '../../components/metrics/MetricsSubNav'
import { MetricsSessionProvider } from '../../contexts/MetricsSessionContext'
import { RETENTION_SUB_NAV, REGISTRATION_SUB_NAV, TRENDS_SUB_NAV } from './metricsNav'
import { SeasonEmptyState } from '../../components/metrics/SeasonEmptyState'
import { useCurrentYear } from '../../hooks/useCurrentYear'
import { useSeasonHasRows } from '../../hooks/useSeasonHasRows'
import { useAnalyticsFreshness } from '../../hooks/useAnalyticsFreshness'
import { usePriorityRegDate } from '../../hooks/useRegistrationDates'
import { useViewSeason } from '../../hooks/useViewSeason'
import { useMetricsSession } from '../../hooks/useMetricsSession'
import { scopeLine, scopeWords, SUMMER_ONLY } from './scopeLine'

/**
 * The page title and, under it, what the page counts (PR 4, pick 1A, replacing the subtitle):
 * "2026 · At Camp — Quests and Teens not counted · counted in campers · Summer only: …".
 * Inside the session provider, because the line follows the session filter.
 */
function MetricsHeader({ title }: { title: string }) {
  const location = useLocation()
  const { currentYear } = useCurrentYear()
  const session = useMetricsSession()
  const line = scopeLine(location.pathname, currentYear, scopeWords(session))
  return (
    <div className="mb-4">
      <h1 className="text-foreground text-xl font-bold">{title}</h1>
      <p className="text-muted-foreground mt-0.5 text-sm" data-testid="metrics-scope-line">
        <span className="text-foreground font-medium">{line.head}</span>
        {line.left && ` — ${line.left}`}
        {line.unit && ` · ${line.unit}`} · {SUMMER_ONLY}
      </p>
    </div>
  )
}

/**
 * The page body, gated on the viewed season having countable summer rows (PR 4, board 9 A).
 * After the Oct 26 rollover the new season has no sign-ups for weeks, and every page would
 * otherwise draw zeros under it. One gate here covers every page; the header, tabs, sub-nav,
 * picker and season bar stay. While the count loads, a spinner stands in so no zeros flash.
 */
function SeasonGatedOutlet() {
  const { currentYear } = useCurrentYear()
  const { hasRows } = useSeasonHasRows(currentYear)
  const freshness = useAnalyticsFreshness(currentYear)
  const priorityDate = usePriorityRegDate(currentYear)
  const viewSeason = useViewSeason()

  if (hasRows === undefined) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="season-rows-loading">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
      </div>
    )
  }
  if (!hasRows) {
    return (
      <SeasonEmptyState
        year={currentYear}
        prior={currentYear - 1}
        neverSynced={freshness.kind === 'never'}
        priorityDate={priorityDate}
        onViewPrior={() => viewSeason(currentYear - 1)}
      />
    )
  }
  return <Outlet />
}

export default function MetricsLayout() {
  const location = useLocation()

  // Determine which sub-nav to show based on current section
  const getSubNavItems = (): SubNavItem[] => {
    if (location.pathname.startsWith('/analytics/registration')) {
      return REGISTRATION_SUB_NAV
    }
    if (location.pathname.startsWith('/analytics/retention')) {
      return RETENTION_SUB_NAV
    }
    if (location.pathname.startsWith('/analytics/trends')) {
      return TRENDS_SUB_NAV
    }
    return []
  }

  const subNavItems = getSubNavItems()

  const title = location.pathname.startsWith('/analytics/retention')
    ? 'Retention'
    : location.pathname.startsWith('/analytics/trends')
      ? 'Trend Analysis'
      : 'Registration'

  return (
    <MetricsSessionProvider>
      <div className="bg-background min-h-screen">
        <div className="mx-auto max-w-7xl px-4 pt-4 pb-8 sm:px-6 lg:px-8">
          <MetricsHeader title={title} />

          {/* Sticky Navigation */}
          <div className="bg-background/95 sticky top-0 z-10 backdrop-blur-sm">
            <MetricsTypeTabs />
            {subNavItems.length > 0 && <MetricsSubNav items={subNavItems} />}
          </div>

          {/* Page Content */}
          <div className="mt-6">
            <SeasonGatedOutlet />
          </div>
        </div>
      </div>
    </MetricsSessionProvider>
  )
}
