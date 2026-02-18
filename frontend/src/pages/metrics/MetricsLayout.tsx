/**
 * MetricsLayout - Shared layout wrapper for metrics module
 * Provides sticky navigation with primary tabs and conditional sub-nav
 * Wraps content with MetricsSessionProvider for unified session filtering
 */
import { Outlet, useLocation } from 'react-router'
import { LayoutDashboard, Globe, Clock } from 'lucide-react'
import MetricsTypeTabs from '../../components/metrics/MetricsTypeTabs'
import MetricsSubNav, { type SubNavItem } from '../../components/metrics/MetricsSubNav'
import { MetricsSessionProvider } from '../../contexts/MetricsSessionContext'

// Note: Retention has no sub-nav (single page with all breakdowns inline)

/** Sub-nav items for registration section */
const REGISTRATION_SUB_NAV: SubNavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    path: '/metrics/registration/overview',
  },
  {
    id: 'geo',
    label: 'Geographic',
    icon: Globe,
    path: '/metrics/registration/geo',
  },
  {
    id: 'waitlist',
    label: 'Waitlist',
    icon: Clock,
    path: '/metrics/registration/waitlist',
  },
]


export default function MetricsLayout() {
  const location = useLocation()

  // Determine which sub-nav to show based on current section
  const getSubNavItems = (): SubNavItem[] => {
    if (location.pathname.startsWith('/metrics/registration')) {
      return REGISTRATION_SUB_NAV
    }
    return []
  }

  const subNavItems = getSubNavItems()

  // Dynamic header based on section
  const getHeader = () => {
    if (location.pathname.startsWith('/metrics/retention')) {
      return {
        title: 'Retention Metrics',
        subtitle: 'Prior year → current year returning analysis',
      }
    }
    if (location.pathname.startsWith('/metrics/trends')) {
      return { title: 'Trend Analysis', subtitle: 'Long-term enrollment and registration trends' }
    }
    return {
      title: 'Registration Metrics',
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
            <Outlet />
          </div>
        </div>
      </div>
    </MetricsSessionProvider>
  )
}
