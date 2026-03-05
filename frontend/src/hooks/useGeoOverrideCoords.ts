/**
 * Hook to fetch all geo_overrides with coordinates across all categories.
 *
 * Returns a Map<string, LatLng> keyed by "category:canonical_name" for use
 * with getLocationCoordsWithOverrides to overlay admin-geocoded locations
 * on the GeoAnalysis map.
 */

import { useQuery } from '@tanstack/react-query'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'
import { fetchOverrides } from '../services/geoService'
import type { LatLng } from '../data/californiaGeo'

const GEO_CATEGORIES = ['city', 'school', 'congregation'] as const

export function useGeoOverrideCoords(year: number) {
  const { fetchWithAuth } = useApiWithAuth()

  const query = useQuery({
    queryKey: queryKeys.geoOverrideCoords(year),
    queryFn: async () => {
      const results = await Promise.all(
        GEO_CATEGORIES.map((cat) => fetchOverrides(cat, year, fetchWithAuth))
      )

      const coordMap = new Map<string, LatLng>()
      for (const overrides of results) {
        for (const o of overrides) {
          if (o.lat !== null && o.lng !== null) {
            coordMap.set(`${o.category}:${o.canonical_name}`, [o.lat, o.lng])
          }
        }
      }
      return coordMap
    },
    ...syncDataOptions,
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
  }
}
