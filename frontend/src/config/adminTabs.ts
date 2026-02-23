import type { LucideIcon } from 'lucide-react'
import { RefreshCw, Sliders, FileSpreadsheet } from 'lucide-react'

export interface AdminTabConfig {
  id: 'sync' | 'config' | 'sheets'
  label: string
  icon: LucideIcon
  /** Permission required. 'admin' = super-admin only, 'authenticated' = any logged-in user */
  requiredPermission: 'admin' | 'authenticated'
}

export const ADMIN_TABS: AdminTabConfig[] = [
  { id: 'sync', label: 'Sync Operations', icon: RefreshCw, requiredPermission: 'authenticated' },
  { id: 'config', label: 'Configuration', icon: Sliders, requiredPermission: 'authenticated' },
  { id: 'sheets', label: 'Sheets', icon: FileSpreadsheet, requiredPermission: 'admin' },
]
