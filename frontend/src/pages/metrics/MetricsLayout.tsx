/**
 * MetricsLayout - Shared layout wrapper for metrics module
 * Provides sticky navigation with primary tabs and conditional sub-nav
 */
import { Outlet, useLocation } from 'react-router';
import { LayoutDashboard, Globe, Building2, Clock } from 'lucide-react';
import MetricsTypeTabs from '../../components/metrics/MetricsTypeTabs';
import MetricsSubNav, { type SubNavItem } from '../../components/metrics/MetricsSubNav';

/** Sub-nav items for registration section */
const REGISTRATION_SUB_NAV: SubNavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, path: '/metrics/registration/overview' },
  { id: 'geo', label: 'Geographic', icon: Globe, path: '/metrics/registration/geo' },
  { id: 'synagogue', label: 'Synagogue', icon: Building2, path: '/metrics/registration/synagogue' },
  { id: 'waitlist', label: 'Waitlist', icon: Clock, path: '/metrics/registration/waitlist' },
];

export default function MetricsLayout() {
  const location = useLocation();

  // Determine which sub-nav to show based on current section
  const getSubNavItems = (): SubNavItem[] => {
    if (location.pathname.startsWith('/metrics/registration')) {
      return REGISTRATION_SUB_NAV;
    }
    // retention and trends don't have sub-pages yet
    return [];
  };

  const subNavItems = getSubNavItems();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Registration Metrics</h1>
          <p className="mt-1 text-muted-foreground">
            Analyze registration data and retention trends
          </p>
        </div>

        {/* Sticky Navigation */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
          <MetricsTypeTabs />
          {subNavItems.length > 0 && <MetricsSubNav items={subNavItems} />}
        </div>

        {/* Page Content */}
        <div className="mt-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
