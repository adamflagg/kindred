/**
 * Shared navigation configuration for metrics module.
 * Single source of truth for sub-nav items used by MetricsLayout and MetricsTypeTabs.
 */
import {
  LayoutDashboard,
  Globe,
  Clock,
  GitBranch,
  Grid2x2,
  Users,
  Table,
  Target,
  Zap,
  XCircle,
  CalendarCheck,
} from 'lucide-react'
import { Permission } from '../../constants/permissions'
import type { SubNavItem } from '../../components/metrics/MetricsSubNav'

/** Sub-nav items for retention section */
export const RETENTION_SUB_NAV: SubNavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    path: '/analytics/retention',
  },
  {
    id: 'flow',
    label: 'Session Flow',
    icon: GitBranch,
    path: '/analytics/retention/flow',
  },
  {
    id: 'bunks',
    label: 'Bunk Analysis',
    icon: Grid2x2,
    path: '/analytics/retention/bunks',
  },
  {
    id: 'staff',
    label: 'Staff Analysis',
    icon: Users,
    path: '/analytics/retention/staff',
    permission: Permission.STAFF_HIRING,
  },
]

/** Sub-nav items for registration section */
export const REGISTRATION_SUB_NAV: SubNavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    path: '/analytics/registration/overview',
  },
  {
    id: 'geo',
    label: 'Geographic',
    icon: Globe,
    path: '/analytics/registration/geo',
  },
  {
    id: 'waitlist',
    label: 'Waitlist',
    icon: Clock,
    path: '/analytics/registration/waitlist',
  },
  {
    id: 'availability',
    label: 'Availability',
    icon: Table,
    path: '/analytics/registration/availability',
  },
  {
    id: 'forecast',
    label: 'Forecast',
    icon: Target,
    path: '/analytics/registration/forecast',
  },
  {
    id: 'cancellations',
    label: 'Cancellations',
    icon: XCircle,
    path: '/analytics/registration/cancellations',
  },
  {
    id: 'day1',
    label: 'Day 1',
    icon: CalendarCheck,
    path: '/analytics/registration/day1',
  },
]

/** Sub-nav items for trends section */
export const TRENDS_SUB_NAV: SubNavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    path: '/analytics/trends',
  },
  {
    id: 'velocity',
    label: 'Velocity',
    icon: Zap,
    path: '/analytics/trends/velocity',
  },
  {
    id: 'cancellations',
    label: 'Cancellations',
    icon: XCircle,
    path: '/analytics/trends/cancellations',
  },
]
