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
    case 'curated':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
    case 'manual':
      return 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300'
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  }
}

/** Sub-tab slugs — paths are relative, resolved at render time via geoBasePath(). */
export const SUB_TABS = [
  { id: 'cities', label: 'Cities', slug: 'cities', icon: Building2 },
  { id: 'schools', label: 'Schools', slug: 'schools', icon: School },
  { id: 'congregations', label: 'Congregations', slug: 'congregations', icon: Landmark },
] as const

/** Detect base path from current URL (works under /admin/geo or /manage/geo). */
export function geoBasePath(pathname: string): string {
  const match = pathname.match(/^(\/(?:admin|manage)\/geo)/)
  return match?.[1] ?? '/manage/geo'
}

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
  if (country && !['US', 'USA', ''].includes(country)) {
    return `${city || fallbackName || ''}, ${country}`.replace(/^, /, '')
  }
  return [city, state].filter(Boolean).join(', ')
}

export function getActiveSubTab(pathname: string): string {
  const base = geoBasePath(pathname)
  for (const tab of SUB_TABS) {
    if (pathname.startsWith(`${base}/${tab.slug}`)) return tab.id
  }
  return 'cities'
}
