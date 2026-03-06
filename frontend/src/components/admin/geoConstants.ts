import { Building2, School, Landmark } from 'lucide-react'

export type GeoCategory = 'city' | 'school' | 'congregation'

export const SUB_TABS = [
  { id: 'cities', label: 'Cities', path: '/admin/geo/cities', icon: Building2 },
  { id: 'schools', label: 'Schools', path: '/admin/geo/schools', icon: School },
  {
    id: 'congregations',
    label: 'Congregations',
    path: '/admin/geo/congregations',
    icon: Landmark,
  },
] as const

export const CATEGORY_SIDEBAR = [
  { id: 'city' as const, label: 'Cities', icon: Building2, path: '/admin/geo/cities' },
  { id: 'school' as const, label: 'Schools', icon: School, path: '/admin/geo/schools' },
  { id: 'congregation' as const, label: 'Congregations', icon: Landmark, path: '/admin/geo/congregations' },
]

/** Map sub-tab id to API category value */
export const SUB_TAB_TO_CATEGORY: Record<string, GeoCategory> = {
  cities: 'city',
  schools: 'school',
  congregations: 'congregation',
}

export function getActiveSubTab(pathname: string): string {
  for (const tab of SUB_TABS) {
    if (pathname.startsWith(tab.path)) return tab.id
  }
  return 'cities'
}
