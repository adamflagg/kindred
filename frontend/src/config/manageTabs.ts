import type { LucideIcon } from 'lucide-react'
import {
  MapPin,
  CalendarDays,
  FileSpreadsheet,
  Home,
  RefreshCw,
  Sliders,
  Workflow,
  Database,
  Settings2,
} from 'lucide-react'
import { Permission } from '../constants/permissions'

/**
 * Who can see a tab. Deliberately a tagged union, not `{ requiredPermission: string }`.
 *
 * `usePermissions().hasPermission` resolves as `isAdmin || permSet.has(perm)`, so
 * `hasPermission('admin')` returns `true` for an admin and `false` for everyone
 * else today — but only by coincidence, because no real permission is named
 * `admin`. A bare `string` field lets a real codename and the `'admin'`
 * sentinel collapse into the same type, which is exactly what #387 did (a
 * `metrics.geo` tab landed under /admin) and #450 had to unwind. Tagging
 * `{ kind: 'admin' }` separately makes that mix-up a compile error instead of
 * a silent authorization hole, and — via `canSeeTab` below — resolves against
 * `isAdmin` directly rather than through `hasPermission('admin')`.
 */
export type TabAccess = { kind: 'permission'; codename: string } | { kind: 'admin' }

export function canSeeTab(
  access: TabAccess,
  ctx: { hasPermission: (permission: string) => boolean; isAdmin: boolean }
): boolean {
  return access.kind === 'admin' ? ctx.isAdmin : ctx.hasPermission(access.codename)
}

export interface ManageTabConfig {
  id: 'geo' | 'registration' | 'sheets' | 'lodging' | 'sync' | 'config'
  label: string
  path: string
  icon: LucideIcon
  access: TabAccess
}

export const MANAGE_TABS: ManageTabConfig[] = [
  {
    id: 'geo',
    label: 'Geo Data',
    path: '/manage/geo',
    icon: MapPin,
    access: { kind: 'permission', codename: Permission.METRICS_GEO },
  },
  {
    id: 'registration',
    label: 'Registration',
    path: '/manage/registration',
    icon: CalendarDays,
    access: { kind: 'permission', codename: Permission.REGISTRATION_MANAGE },
  },
  {
    id: 'sheets',
    label: 'Sheets',
    path: '/manage/sheets',
    icon: FileSpreadsheet,
    access: { kind: 'permission', codename: Permission.SHEETS_EXPORT },
  },
  {
    // Confirming cabins, correcting the unit registry and resolving ingest
    // names are bunking staff's work, so this sits behind bunking.manage
    // rather than admin — matching the write rules on every lodging_*
    // collection (pb_migrations/1500000130).
    id: 'lodging',
    label: 'Family Camp Lodging',
    path: '/manage/lodging',
    icon: Home,
    access: { kind: 'permission', codename: Permission.BUNKING_MANAGE },
  },
  {
    id: 'sync',
    label: 'Sync Operations',
    path: '/manage/sync',
    icon: RefreshCw,
    access: { kind: 'admin' },
  },
  {
    id: 'config',
    label: 'Configuration',
    path: '/manage/config',
    icon: Sliders,
    access: { kind: 'admin' },
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
    path: '/manage/config/solver',
    icon: Sliders,
    description: 'Cabin assignment rules',
  },
  {
    id: 'processing',
    name: 'Request Processing',
    path: '/manage/config/processing',
    icon: Workflow,
    description: 'AI-powered request pipeline',
  },
  {
    id: 'history',
    name: 'Data & History',
    path: '/manage/config/history',
    icon: Database,
    description: 'Historical context & tracking',
  },
  {
    id: 'general',
    name: 'General',
    path: '/manage/config/general',
    icon: Settings2,
    description: 'UI and display preferences',
  },
]
