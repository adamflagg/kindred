import type { LucideIcon } from 'lucide-react'
import {
  RefreshCw,
  Sliders,
  FileSpreadsheet,
  Workflow,
  Database,
  CalendarDays,
  MapPin,
} from 'lucide-react'
import { Permission } from '../constants/permissions'

export interface AdminTabConfig {
  id: 'sync' | 'config' | 'sheets' | 'geo'
  label: string
  path: string
  icon: LucideIcon
  /** Permission required. 'admin' = super-admin only, 'authenticated' = any logged-in user, or a permission codename */
  requiredPermission: 'admin' | 'authenticated' | string
}

export const ADMIN_TABS: AdminTabConfig[] = [
  {
    id: 'sync',
    label: 'Sync Operations',
    path: '/admin/sync',
    icon: RefreshCw,
    requiredPermission: 'authenticated',
  },
  {
    id: 'config',
    label: 'Configuration',
    path: '/admin/config',
    icon: Sliders,
    requiredPermission: 'authenticated',
  },
  {
    id: 'sheets',
    label: 'Sheets',
    path: '/admin/sheets',
    icon: FileSpreadsheet,
    requiredPermission: 'admin',
  },
  {
    id: 'geo',
    label: 'Geo Data',
    path: '/admin/geo',
    icon: MapPin,
    requiredPermission: Permission.METRICS_GEO,
  },
]

export interface ConfigCategoryDef {
  id: string
  name: string
  path: string
  icon: LucideIcon
  description: string
}

export const CONFIG_CATEGORIES: ConfigCategoryDef[] = [
  {
    id: 'solver',
    name: 'Bunk Optimizer',
    path: '/admin/config/solver',
    icon: Sliders,
    description: 'Cabin assignment rules',
  },
  {
    id: 'processing',
    name: 'Request Processing',
    path: '/admin/config/processing',
    icon: Workflow,
    description: 'AI-powered request pipeline',
  },
  {
    id: 'history',
    name: 'Data & History',
    path: '/admin/config/history',
    icon: Database,
    description: 'Historical context & tracking',
  },
  {
    id: 'registration',
    name: 'Registration',
    path: '/admin/config/registration',
    icon: CalendarDays,
    description: 'Registration dates & budgets',
  },
]
