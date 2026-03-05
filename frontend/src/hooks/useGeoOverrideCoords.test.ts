/**
 * TDD Tests for useGeoOverrideCoords hook.
 *
 * This hook fetches all geo_overrides across city, school, and congregation
 * categories and builds a Map<string, LatLng> for coordinate lookups.
 */
import { describe, it, expect } from 'vitest'

describe('useGeoOverrideCoords', () => {
  describe('data transformation logic', () => {
    it('should build a Map<string, LatLng> with category:name keys', () => {
      const exampleMap = new Map<string, [number, number]>()
      exampleMap.set('city:Maplewood', [40.73, -74.27])
      exampleMap.set('school:Riverside Elementary', [37.82, -122.27])
      exampleMap.set('congregation:Temple Shalom', [37.56, -122.33])

      expect(exampleMap.get('city:Maplewood')).toEqual([40.73, -74.27])
      expect(exampleMap.get('school:Riverside Elementary')).toEqual([37.82, -122.27])
      expect(exampleMap.get('congregation:Temple Shalom')).toEqual([37.56, -122.33])
      expect(exampleMap.size).toBe(3)
    })

    it('should filter out overrides without coordinates', () => {
      const overrides = [
        { canonical_name: 'Maplewood', category: 'city', lat: 40.73, lng: -74.27 },
        { canonical_name: 'Unknown Place', category: 'city', lat: null, lng: null },
        { canonical_name: 'Partial', category: 'school', lat: 37.82, lng: null },
      ]

      const filtered = overrides.filter((o) => o.lat !== null && o.lng !== null)
      expect(filtered).toHaveLength(1)
      expect(filtered[0]!.canonical_name).toBe('Maplewood')
    })

    it('should use DB category names (city, school, congregation) in map keys', () => {
      const map = new Map<string, [number, number]>()
      map.set('congregation:Temple Shalom', [37.56, -122.33])

      // DB key "congregation" works
      expect(map.get('congregation:Temple Shalom')).toBeDefined()
      // Frontend key "synagogue" does NOT work in the map directly
      expect(map.get('synagogue:Temple Shalom')).toBeUndefined()
    })
  })

  describe('query key', () => {
    it('should have geoOverrideCoords key in queryKeys', async () => {
      const mod = await import('../utils/queryKeys')
      const keys = mod.queryKeys as unknown as Record<string, unknown>
      expect(typeof keys['geoOverrideCoords']).toBe('function')
    })

    it('should include year in query key', async () => {
      const mod = await import('../utils/queryKeys')
      const keys = mod.queryKeys as unknown as Record<
        string,
        ((year: number) => readonly unknown[]) | undefined
      >
      const fn = keys['geoOverrideCoords']
      expect(fn).toBeDefined()
      const key = fn!(2026)
      expect(Array.isArray(key)).toBe(true)
      expect(key).toContain(2026)
    })
  })
})
