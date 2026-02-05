/**
 * California city coordinates for geographic map visualization.
 *
 * Focused on Bay Area regions where most campers come from:
 * - Marin County
 * - San Francisco
 * - Peninsula (San Mateo County)
 * - South Bay (Santa Clara County)
 * - East Bay (Alameda, Contra Costa)
 *
 * Also includes major California cities for out-of-area campers.
 */

/** Coordinates as [latitude, longitude] */
export type LatLng = [number, number];

/**
 * California city coordinates mapping.
 * Key is city name (case-sensitive, should match CampMinder data).
 */
export const CA_CITY_COORDS: Record<string, LatLng> = {
  // ========== MARIN COUNTY ==========
  'San Rafael': [37.9735, -122.5311],
  'Mill Valley': [37.906, -122.545],
  'Tiburon': [37.8735, -122.4567],
  'Belvedere': [37.8726, -122.4644],
  'Larkspur': [37.9341, -122.5353],
  'Corte Madera': [37.9257, -122.5275],
  'Kentfield': [37.9521, -122.5569],
  'Greenbrae': [37.9457, -122.5355],
  'Ross': [37.9624, -122.555],
  'San Anselmo': [37.9746, -122.5616],
  'Fairfax': [37.987, -122.5889],
  'Novato': [38.1074, -122.5697],
  Sausalito: [37.8591, -122.485],
  Stinson: [37.9017, -122.6397],
  'Stinson Beach': [37.9017, -122.6397],
  Bolinas: [37.9091, -122.6861],
  Inverness: [38.1007, -122.8569],
  'Point Reyes Station': [38.0688, -122.8069],
  Woodacre: [38.0113, -122.6447],
  'San Geronimo': [38.0124, -122.6647],
  Lagunitas: [38.0163, -122.6769],
  'Forest Knolls': [38.0185, -122.6833],

  // ========== SAN FRANCISCO ==========
  'San Francisco': [37.7749, -122.4194],
  SF: [37.7749, -122.4194],

  // ========== PENINSULA (San Mateo County) ==========
  'Daly City': [37.6879, -122.4702],
  'South San Francisco': [37.6547, -122.4077],
  'San Bruno': [37.6305, -122.4111],
  Millbrae: [37.5985, -122.387],
  Burlingame: [37.5841, -122.3661],
  'San Mateo': [37.5629, -122.3255],
  'Foster City': [37.5585, -122.2711],
  'Belmont': [37.5202, -122.2758],
  'San Carlos': [37.5072, -122.2608],
  'Redwood City': [37.4852, -122.2364],
  'Woodside': [37.4299, -122.2539],
  Portola: [37.384, -122.2355],
  'Portola Valley': [37.384, -122.2355],
  'Menlo Park': [37.453, -122.1817],
  Atherton: [37.4613, -122.1978],
  'Palo Alto': [37.4419, -122.143],
  'Los Altos': [37.3852, -122.1141],
  'Los Altos Hills': [37.3796, -122.1377],
  'Mountain View': [37.3861, -122.0839],
  Sunnyvale: [37.3688, -122.0363],
  'Half Moon Bay': [37.4636, -122.4286],
  Pacifica: [37.6138, -122.4869],

  // ========== SOUTH BAY (Santa Clara County) ==========
  'San Jose': [37.3382, -121.8863],
  'Santa Clara': [37.3541, -121.9552],
  Cupertino: [37.323, -122.0322],
  Saratoga: [37.2638, -122.023],
  'Los Gatos': [37.2358, -121.9624],
  Campbell: [37.2872, -121.9499],
  Milpitas: [37.4323, -121.8996],
  Fremont: [37.5485, -121.9886],
  Newark: [37.5297, -122.0402],
  'Morgan Hill': [37.1305, -121.6544],
  Gilroy: [37.0058, -121.5683],

  // ========== EAST BAY (Alameda County) ==========
  Oakland: [37.8044, -122.2712],
  Berkeley: [37.8716, -122.2727],
  Albany: [37.8869, -122.2977],
  'El Cerrito': [37.9161, -122.3102],
  Richmond: [37.9358, -122.3477],
  Piedmont: [37.8244, -122.2317],
  Alameda: [37.7652, -122.2416],
  Emeryville: [37.8313, -122.2852],
  'San Leandro': [37.7249, -122.1561],
  Hayward: [37.6688, -122.0808],
  'Castro Valley': [37.6941, -122.0864],
  'Union City': [37.5934, -122.0438],
  'San Lorenzo': [37.6809, -122.1244],
  Livermore: [37.6819, -121.768],
  Pleasanton: [37.6624, -121.8747],
  Dublin: [37.7022, -121.9358],

  // ========== EAST BAY (Contra Costa County) ==========
  Orinda: [37.8771, -122.1797],
  Lafayette: [37.8858, -122.118],
  Moraga: [37.835, -122.1297],
  'Walnut Creek': [37.9101, -122.0652],
  'Pleasant Hill': [37.9481, -122.0758],
  Concord: [37.9779, -122.0311],
  'Martinez': [38.0194, -122.1341],
  Danville: [37.8216, -121.9999],
  'San Ramon': [37.7799, -121.978],
  Alamo: [37.8505, -122.0322],
  Antioch: [38.005, -121.8058],
  Brentwood: [37.9319, -121.6958],
  'Clayton': [37.9408, -121.9358],
  Pittsburg: [38.0278, -121.8847],
  Pinole: [37.9991, -122.2991],
  Hercules: [37.9985, -122.2888],
  'El Sobrante': [37.9724, -122.2952],

  // ========== NAPA / SONOMA ==========
  Napa: [38.2975, -122.2869],
  'St. Helena': [38.5052, -122.4697],
  Yountville: [38.4016, -122.3608],
  Calistoga: [38.5788, -122.5797],
  Sonoma: [38.2919, -122.458],
  Petaluma: [38.2324, -122.6366],
  'Santa Rosa': [38.4404, -122.7141],
  Sebastopol: [38.402, -122.8239],
  Healdsburg: [38.6105, -122.8694],
  Rohnert: [38.3397, -122.7011],
  'Rohnert Park': [38.3397, -122.7011],
  Windsor: [38.5466, -122.8166],
  Cotati: [38.3277, -122.7086],

  // ========== GREATER CALIFORNIA ==========
  Sacramento: [38.5816, -121.4944],
  'Los Angeles': [34.0522, -118.2437],
  'San Diego': [32.7157, -117.1611],
  'Santa Barbara': [34.4208, -119.6982],
  Fresno: [36.7378, -119.7871],
  'Santa Cruz': [36.9741, -122.0308],
  Monterey: [36.6002, -121.8947],
  Carmel: [36.5552, -121.9233],
  'Carmel Valley': [36.4825, -121.7331],
  'Big Sur': [36.2704, -121.8081],
  Stockton: [37.9577, -121.2908],
  Modesto: [37.6391, -120.9969],
  Davis: [38.5449, -121.7405],
  Tahoe: [39.0968, -120.0324],
  'Lake Tahoe': [39.0968, -120.0324],
  'South Lake Tahoe': [38.9399, -119.9772],
  'Truckee': [39.3279, -120.1833],
  Grass: [39.2189, -121.0611],
  'Grass Valley': [39.2189, -121.0611],
  'Nevada City': [39.2616, -121.0177],

  // ========== COMMON VARIATIONS ==========
  'Walnut Crk': [37.9101, -122.0652],
  'Mtn View': [37.3861, -122.0839],
  'RWC': [37.4852, -122.2364],
  'Redwood Shores': [37.5325, -122.2475],
};

/**
 * Bay Area map bounds (SW, NE corners).
 * Covers from Santa Cruz to Napa/Sonoma.
 */
export const BAY_AREA_BOUNDS: [LatLng, LatLng] = [
  [36.9, -123.1], // SW corner (south of Santa Cruz, west of coast)
  [38.8, -121.5], // NE corner (north of Napa, east of Livermore)
];

/**
 * Default map center (roughly center of Bay Area).
 */
export const BAY_AREA_CENTER: LatLng = [37.6, -122.2];

/**
 * Default zoom level for Bay Area view.
 */
export const BAY_AREA_ZOOM = 9;

/**
 * Zoom level when focusing on a single region.
 */
export const REGION_ZOOM = 11;

/**
 * Bay Area regions for grouping cities.
 */
export const BAY_AREA_REGIONS = {
  marin: {
    name: 'Marin County',
    center: [37.95, -122.55] as LatLng,
    cities: [
      'San Rafael',
      'Mill Valley',
      'Tiburon',
      'Belvedere',
      'Larkspur',
      'Corte Madera',
      'Kentfield',
      'Greenbrae',
      'Ross',
      'San Anselmo',
      'Fairfax',
      'Novato',
      'Sausalito',
    ],
  },
  sf: {
    name: 'San Francisco',
    center: [37.7749, -122.4194] as LatLng,
    cities: ['San Francisco', 'SF'],
  },
  peninsula: {
    name: 'Peninsula',
    center: [37.5, -122.25] as LatLng,
    cities: [
      'Menlo Park',
      'Atherton',
      'Palo Alto',
      'Redwood City',
      'San Mateo',
      'Burlingame',
      'San Carlos',
      'Belmont',
      'Foster City',
      'Woodside',
      'Portola Valley',
    ],
  },
  southBay: {
    name: 'South Bay',
    center: [37.35, -121.95] as LatLng,
    cities: [
      'San Jose',
      'Los Gatos',
      'Saratoga',
      'Cupertino',
      'Santa Clara',
      'Sunnyvale',
      'Mountain View',
      'Los Altos',
      'Campbell',
      'Milpitas',
    ],
  },
  eastBay: {
    name: 'East Bay',
    center: [37.85, -122.15] as LatLng,
    cities: [
      'Oakland',
      'Berkeley',
      'Piedmont',
      'Alameda',
      'Albany',
      'El Cerrito',
      'Orinda',
      'Lafayette',
      'Moraga',
      'Walnut Creek',
      'Pleasant Hill',
      'Concord',
      'Danville',
      'San Ramon',
      'Livermore',
      'Pleasanton',
      'Dublin',
      'Fremont',
      'Hayward',
      'Castro Valley',
    ],
  },
} as const;

/**
 * Look up coordinates for a city name.
 * Handles case-insensitive matching and common variations.
 *
 * @param cityName - City name to look up
 * @returns Coordinates [lat, lng] or undefined if not found
 */
export function getCityCoords(cityName: string): LatLng | undefined {
  // Direct lookup first
  if (CA_CITY_COORDS[cityName]) {
    return CA_CITY_COORDS[cityName];
  }

  // Try case-insensitive match
  const lowerName = cityName.toLowerCase();
  for (const [city, coords] of Object.entries(CA_CITY_COORDS)) {
    if (city.toLowerCase() === lowerName) {
      return coords;
    }
  }

  // Try partial match for city names with state suffix (e.g., "Oakland, CA")
  const cityOnly = cityName.split(',')[0].trim();
  if (cityOnly !== cityName) {
    return getCityCoords(cityOnly);
  }

  return undefined;
}

/**
 * Get region name for a city.
 *
 * @param cityName - City name to look up
 * @returns Region key or undefined if not in Bay Area
 */
export function getCityRegion(
  cityName: string
): keyof typeof BAY_AREA_REGIONS | undefined {
  for (const [regionKey, region] of Object.entries(BAY_AREA_REGIONS)) {
    if (
      region.cities.some((c) => c.toLowerCase() === cityName.toLowerCase())
    ) {
      return regionKey as keyof typeof BAY_AREA_REGIONS;
    }
  }
  return undefined;
}
