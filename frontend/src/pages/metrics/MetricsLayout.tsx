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

  // Dynamic header based on section
  const getHeader = () => {
    if (location.pathname.startsWith('/analytics/retention')) {
      return {
        title: 'Retention',
        subtitle: 'Prior year → current year returning analysis',
      }
    }
    if (location.pathname.startsWith('/analytics/trends')) {
      return { title: 'Trend Analysis', subtitle: 'Long-term enrollment and registration trends' }
    }
    return {
      title: 'Registration',
      subtitle: 'Analyze registration data and enrollment patterns',
    }
  }
  const header = getHeader()

  return (
    <MetricsSessionProvider>
      <div className="bg-background min-h-screen">
        <div className="mx-auto max-w-7xl px-4 pt-4 pb-8 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-foreground text-2xl font-bold">{header.title}</h1>
            <p className="text-muted-foreground mt-1">{header.subtitle}</p>
          </div>

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
