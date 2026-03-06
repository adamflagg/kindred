/**
 * Unified coordinate lookup that delegates to category-specific modules.
 *
 * Usage:
 *   const coords = getLocationCoords('city', 'Oakland')
 *   const coords = getLocationCoords('school', 'Park Day School')
 *   const coords = getLocationCoords('synagogue', 'Temple Beth Abraham')
 */

import type { LatLng } from './californiaGeo'
import { getCityCoords } from './californiaGeo'
import { getCongregationCoords } from './congregationGeo'
import { getSchoolCoords } from './schoolGeo'

/**
 * Get coordinates for a location by category and name.
 *
 * @param category - One of 'city', 'school', 'synagogue'
 * @param name - Location name to look up (case-insensitive)
 * @returns [lat, lng] pair or undefined if not found
 */
export function getLocationCoords(category: string, name: string): LatLng | undefined {
  switch (category) {
    case 'city':
      return getCityCoords(name)
    case 'school':
      return getSchoolCoords(name)
    case 'synagogue':
      return getCongregationCoords(name)
    default:
      return undefined
  }
}

/**
 * Get coordinates with override priority.
 *
 * Checks the override map first (keyed by DB category), then falls
 * back to static coordinate lookup. Maps frontend "synagogue" to
 * DB "congregation" for the override key.
 */
export function getLocationCoordsWithOverrides(
  category: string,
  name: string,
  overrideCoords?: Map<string, LatLng>
): LatLng | undefined {
  if (overrideCoords) {
    const dbCategory = category === 'synagogue' ? 'congregation' : category
    const key = `${dbCategory}:${name}`
    const override = overrideCoords.get(key)
    if (override) return override
  }
  return getLocationCoords(category, name)
}
