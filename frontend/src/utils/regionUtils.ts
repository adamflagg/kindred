/**
 * Region classification and aggregation utilities.
 *
 * Groups cities into Bay Area sub-regions (Marin, SF, Peninsula, South Bay,
 * East Bay, Napa/Sonoma), Other CA, Rest of US, and International.
 * All computation is frontend-only using existing by_city API data.
 */

import { getCityRegion, CA_CITY_COORDS } from '../data/californiaGeo'
import { US_CITY_STATES } from '../data/cityGeo'
import type { CityBreakdown, RetentionByCity } from '../types/metrics'

/** Maps region keys to human-readable display names. */
export const REGION_DISPLAY_NAMES: Record<string, string> = {
  marin: 'Marin',
  sf: 'San Francisco',
  peninsula: 'Peninsula',
  southBay: 'South Bay',
  eastBay: 'East Bay',
  napaSonoma: 'Napa / Sonoma',
  'Other CA': 'Other CA',
  'Rest of US': 'Rest of US',
  International: 'International',
}

/** Valid US state/territory codes for distinguishing from country codes. */
const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP',
])

/**
 * Parse "City, ST" format into bare city name and state abbreviation.
 * Returns [bareName, state] where state may be empty if no suffix present.
 * Only recognizes valid US state codes to avoid misclassifying Canadian
 * provinces (ON, BC, QC) or country codes (DE, UK) as US states.
 */
function parseCityState(city: string): [string, string] {
  const commaIdx = city.lastIndexOf(', ')
  if (commaIdx === -1) return [city, '']
  const suffix = city.slice(commaIdx + 2)
  if (suffix.length === 2 && US_STATE_CODES.has(suffix)) {
    return [city.slice(0, commaIdx), suffix]
  }
  return [city, '']
}

/**
 * Classify a city into a region.
 *
 * Handles both bare names ("Oakland") and "City, ST" format ("Oakland, CA").
 * Priority: Bay Area sub-region > Other CA > Rest of US > International
 */
export function classifyCity(city: string): string {
  if (!city) return 'International'

  const [bareName, stateFromName] = parseCityState(city)

  // Check Bay Area regions first (using bare name)
  const bayAreaRegion = getCityRegion(bareName)
  if (bayAreaRegion) return bayAreaRegion

  // Check if it's a California city (in CA_CITY_COORDS but not Bay Area)
  const lowerBare = bareName.toLowerCase()
  for (const caCity of Object.keys(CA_CITY_COORDS)) {
    if (caCity.toLowerCase() === lowerBare) return 'Other CA'
  }

  // If state was embedded in the name, use it directly
  if (stateFromName) {
    return stateFromName === 'CA' ? 'Other CA' : 'Rest of US'
  }

  // Check if it's a US city via lookup (handles bare names)
  if (US_CITY_STATES[city]) {
    return US_CITY_STATES[city] === 'CA' ? 'Other CA' : 'Rest of US'
  }
  // Case-insensitive fallback
  const lowerCity = city.toLowerCase()
  for (const [usCity, state] of Object.entries(US_CITY_STATES)) {
    if (usCity.toLowerCase() === lowerCity) {
      return state === 'CA' ? 'Other CA' : 'Rest of US'
    }
  }

  return 'International'
}

/**
 * Aggregate city count breakdowns by region.
 * Returns regions sorted by count descending with recomputed percentages.
 */
export function aggregateCityCountsByRegion(
  byCity: CityBreakdown[]
): Array<{ region: string; count: number; percentage: number }> {
  if (byCity.length === 0) return []

  const regionCounts = new Map<string, number>()
  for (const item of byCity) {
    const region = classifyCity(item.city)
    regionCounts.set(region, (regionCounts.get(region) ?? 0) + item.count)
  }

  const total = Array.from(regionCounts.values()).reduce((sum, c) => sum + c, 0)

  return Array.from(regionCounts.entries())
    .map(([region, count]) => ({
      region,
      count,
      percentage: total > 0 ? (count / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Aggregate city retention data by region.
 * Sums base_count and returned_count, recomputes retention_rate.
 */
export function aggregateCityRetentionByRegion(
  byCity: RetentionByCity[]
): Array<{ region: string; base_count: number; returned_count: number; retention_rate: number }> {
  if (byCity.length === 0) return []

  const regionData = new Map<string, { base: number; returned: number }>()
  for (const item of byCity) {
    const region = classifyCity(item.city)
    const existing = regionData.get(region) ?? { base: 0, returned: 0 }
    existing.base += item.base_count
    existing.returned += item.returned_count
    regionData.set(region, existing)
  }

  return Array.from(regionData.entries())
    .map(([region, data]) => ({
      region,
      base_count: data.base,
      returned_count: data.returned,
      retention_rate: data.base > 0 ? data.returned / data.base : 0,
    }))
    .sort((a, b) => b.base_count - a.base_count)
}

/**
 * Aggregate city enrollment data by region for trends charts.
 */
export function aggregateCityEnrollmentByRegion(
  byCity: Array<{ city: string; count: number }>
): Array<{ region: string; count: number }> {
  if (byCity.length === 0) return []

  const regionCounts = new Map<string, number>()
  for (const item of byCity) {
    const region = classifyCity(item.city)
    regionCounts.set(region, (regionCounts.get(region) ?? 0) + item.count)
  }

  return Array.from(regionCounts.entries())
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count)
}
