import type { LucideIcon } from 'lucide-react'
import { MapPin, CalendarDays, FileSpreadsheet, Home } from 'lucide-react'
import { Permission } from '../constants/permissions'

export interface ManageTabConfig {
  id: 'geo' | 'registration' | 'sheets' | 'lodging'
  label: string
  path: string
  icon: LucideIcon
  /** Permission required to see this tab (always a real permission codename, not a sentinel like 'admin'/'authenticated') */
  requiredPermission: string
}

export const MANAGE_TABS: ManageTabConfig[] = [
  {
    id: 'geo',
    label: 'Geo Data',
    path: '/manage/geo',
    icon: MapPin,
    requiredPermission: Permission.METRICS_GEO,
  },
  {
    id: 'registration',
    label: 'Registration',
    path: '/manage/registration',
    icon: CalendarDays,
    requiredPermission: Permission.REGISTRATION_MANAGE,
  },
  {
    id: 'sheets',
    label: 'Sheets',
    path: '/manage/sheets',
    icon: FileSpreadsheet,
    requiredPermission: Permission.SHEETS_EXPORT,
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
    requiredPermission: Permission.BUNKING_MANAGE,
  },
]
