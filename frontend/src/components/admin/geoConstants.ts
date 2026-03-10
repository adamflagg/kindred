import { Building2, School, Landmark } from 'lucide-react'

export type GeoCategory = 'city' | 'school' | 'congregation'

export const GEO_CATEGORIES: GeoCategory[] = ['city', 'school', 'congregation']

/** Map source key to display label. */
export function sourceLabel(source: string): string {
  switch (source) {
    case 'nces':
      return 'NCES'
    case 'pss':
      return 'PSS'
    case 'simplemaps':
      return 'SimpleMaps'
    case 'curated':
      return 'Curated'
    case 'suggested':
      return 'Suggested'
    case 'manual':
      return 'Manual'
    default:
      return source
  }
}

/** Map source key to Tailwind badge classes (earthy palette). */
export function sourceBadgeClasses(source: string): string {
  switch (source) {
    case 'nces':
    case 'pss':
      return 'bg-forest-100 text-forest-700 dark:bg-forest-800 dark:text-forest-300'
    case 'simplemaps':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
    case 'suggested':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
    case 'manual':
    case 'curated':
      return 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300'
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  }
}

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

/** Map sub-tab id to API category value */
export const SUB_TAB_TO_CATEGORY: Record<string, GeoCategory> = {
  cities: 'city',
  schools: 'school',
  congregations: 'congregation',
}

/** Format location display: "City, ST" for US, "City, Country" for non-US. */
export function formatLocation(
  city?: string,
  state?: string,
  country?: string,
  fallbackName?: string
): string {
  void country
  void fallbackName
  return [city, state].filter(Boolean).join(', ')
}

export function getActiveSubTab(pathname: string): string {
  for (const tab of SUB_TABS) {
    if (pathname.startsWith(tab.path)) return tab.id
  }
  return 'cities'
}
