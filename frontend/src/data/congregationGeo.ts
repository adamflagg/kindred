/**
 * Congregation coordinates for geographic map visualization.
 *
 * Bay Area Jewish congregations with coordinates.
 * Coverage: 51 congregations
 */

import type { LatLng } from './californiaGeo'

/**
 * Congregation coordinates mapping.
 * Key is canonical congregation name, value is [lat, lng].
 */
export const CONGREGATION_COORDS: Record<string, LatLng> = {
  'Beth El': [37.8716, -122.2727],
  'Beth Jacob Oakland': [37.8244, -122.2317],
  'Chabad of the East Bay': [37.8716, -122.2727],
  "Congregation B'nai Israel": [37.9101, -122.0652],
  "Congregation B'nai Israel Sacramento": [38.5816, -121.4944],
  "Congregation B'nai Shalom": [37.9101, -122.0652],
  "Congregation B'nai Tikvah": [37.9101, -122.0652],
  'Congregation Beth Am': [37.388, -122.116],
  'Congregation Beth Am Los Angeles': [34.0522, -118.2437],
  'Congregation Beth Ami': [38.4404, -122.7141],
  'Congregation Beth David': [37.319, -121.95],
  'Congregation Beth El': [37.8716, -122.2727],
  'Congregation Beth Israel': [37.8716, -122.2727],
  'Congregation Beth Jacob': [37.463, -122.142],
  'Congregation Beth Shalom Sacramento': [38.5816, -121.4944],
  'Congregation Beth Sholom': [37.783, -122.4681],
  'Congregation Emanu-El': [37.7862, -122.441],
  'Congregation Emeth': [37.4419, -122.143],
  'Congregation Etz Chayim': [37.4419, -122.143],
  'Congregation Kol Emeth': [37.4419, -122.143],
  'Congregation Kol Shofar': [37.9249, -122.5339],
  'Congregation Ner Tamid': [37.7237, -122.4769],
  'Congregation Netivot Shalom': [37.8716, -122.2727],
  'Congregation Rodef Sholom': [37.9735, -122.5311],
  "Congregation Sha'ar Zahav": [37.7606, -122.4269],
  'Congregation Sherith Israel': [37.7885, -122.4285],
  'Congregation Shir Hadash': [37.2358, -121.9624],
  'Congregation Shomrei Torah': [38.4404, -122.7141],
  'Congregation Sinai': [37.3382, -121.8863],
  'Keddem Congregation': [37.455, -122.173],
  'Kehilla Community Synagogue': [37.843, -122.2545],
  'Marin Jewish Community Center': [37.94, -122.52],
  'Or Chadash': [37.6624, -121.8747],
  'Or Shalom': [37.747, -122.453],
  'Or Shalom Jewish Community': [37.747, -122.453],
  'Peninsula Sinai Congregation': [37.3688, -122.0363],
  'Peninsula Temple Beth El': [37.5529, -122.3055],
  'Peninsula Temple Sholom': [37.5841, -122.3661],
  'Stephen Wise Temple': [34.0903, -118.4643],
  'Temple Beth Abraham': [37.8044, -122.2712],
  'Temple Beth Am': [34.0522, -118.2437],
  'Temple Beth Hillel': [37.8771, -122.1797],
  'Temple Beth Sholom': [37.3382, -121.8863],
  'Temple Emanu-El': [37.7862, -122.441],
  'Temple Emanu-El San Jose': [37.3382, -121.8863],
  'Temple Isaiah': [37.8791, -122.5157],
  'Temple Israel': [37.6688, -122.0808],
  'Temple Sinai': [37.8044, -122.2712],
  'Temple of the Arts': [34.0522, -118.2437],
  'Tri-Valley Cultural Jews': [37.6624, -121.8747],
  'Wilshire Boulevard Temple': [34.0579, -118.311],
}

/** Case-insensitive lookup cache (built once on first use). */
let _lowerCache: Map<string, LatLng> | null = null

function getLowerCache(): Map<string, LatLng> {
  if (!_lowerCache) {
    _lowerCache = new Map(Object.entries(CONGREGATION_COORDS).map(([k, v]) => [k.toLowerCase(), v]))
  }
  return _lowerCache
}

/**
 * Get coordinates for a congregation by name (case-insensitive).
 *
 * @param name - Congregation name to look up
 * @returns [lat, lng] pair or undefined if not found
 */
export function getCongregationCoords(name: string): LatLng | undefined {
  const direct = CONGREGATION_COORDS[name]
  if (direct) return direct

  return getLowerCache().get(name.toLowerCase())
}
