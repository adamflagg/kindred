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
    permission: Permission.STAFF_HIRING,
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
  {
    id: 'forecast',
    label: 'Forecast',
    icon: Target,
    path: '/metrics/registration/forecast',
  },
  {
    id: 'cancellations',
    label: 'Cancellations',
    icon: XCircle,
    path: '/metrics/registration/cancellations',
  },
  {
    id: 'day1',
    label: 'Day 1',
    icon: CalendarCheck,
    path: '/metrics/registration/day1',
  },
]

/** Sub-nav items for trends section */
export const TRENDS_SUB_NAV: SubNavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    path: '/metrics/trends',
  },
  {
    id: 'velocity',
    label: 'Velocity',
    icon: Zap,
    path: '/metrics/trends/velocity',
  },
  {
    id: 'cancellations',
    label: 'Cancellations',
    icon: XCircle,
    path: '/metrics/trends/cancellations',
  },
]
