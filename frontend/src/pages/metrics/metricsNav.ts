/**
 * Shared navigation configuration for metrics module.
 * Single source of truth for sub-nav items used by MetricsLayout and MetricsTypeTabs.
 */
import { LayoutDashboard, Globe, Clock, GitBranch, Grid2x2, Users, Table } from 'lucide-react'
import type { SubNavItem } from '../../components/metrics/MetricsSubNav'

/** Sub-nav items for retention section */
export const RETENTION_SUB_NAV: SubNavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    path: '/metrics/retention',
  },
  {
    id: 'flow',
    label: 'Session Flow',
    icon: GitBranch,
    path: '/metrics/retention/flow',
  },
  {
    id: 'bunks',
    label: 'Bunk Analysis',
    icon: Grid2x2,
    path: '/metrics/retention/bunks',
  },
  {
    id: 'staff',
    label: 'Staff Analysis',
    icon: Users,
    path: '/metrics/retention/staff',
  },
]

/** Sub-nav items for registration section */
export const REGISTRATION_SUB_NAV: SubNavItem[] = [
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
  {
    id: 'availability',
    label: 'Availability',
    icon: Table,
    path: '/metrics/registration/availability',
  },
]
