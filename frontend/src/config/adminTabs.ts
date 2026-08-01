import type { LucideIcon } from 'lucide-react'
import { RefreshCw, Sliders, Workflow, Database, Settings2 } from 'lucide-react'

export interface AdminTabConfig {
  id: 'sync' | 'config'
  label: string
  path: string
  icon: LucideIcon
  /**
   * Always `'admin'` — every tab under /admin is admin-only, and the guard in
   * `AdminLayout` relies on that rather than resolving the matched route's own
   * requirement.
   *
   * This is deliberately a literal type, not `string`. It used to be
   * `'admin' | 'authenticated' | string`, which collapses to `string` and let a
   * tab carrying an ordinary permission codename sit under /admin — #387 did
   * exactly that with a `metrics.geo` tab, and #450 had to move it (and Sheets,
   * and Registration) out to /manage, where every route carries its own
   * `RequirePermission`. Narrowed so that adding such a tab back is a compile
   * error pointing at the guard, instead of a silent authorization hole.
   */
  requiredPermission: 'admin'
}

export const ADMIN_TABS: AdminTabConfig[] = [
  {
    id: 'sync',
    label: 'Sync Operations',
    path: '/admin/sync',
    icon: RefreshCw,
    requiredPermission: 'admin',
  },
  {
    id: 'config',
    label: 'Configuration',
    path: '/admin/config',
    icon: Sliders,
    requiredPermission: 'admin',
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
    id: 'general',
    name: 'General',
    path: '/admin/config/general',
    icon: Settings2,
    description: 'UI and display preferences',
  },
]
