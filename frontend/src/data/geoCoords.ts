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
export function getLocationCoords(
  category: string,
  name: string,
): LatLng | undefined {
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
