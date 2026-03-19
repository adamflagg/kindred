/**
 * Tests for californiaGeo data module.
 *
 * Validates region data, polygon boundaries, colors, and
 * existing utility functions (getCityCoords, getCityRegion).
 */

import { describe, it, expect } from 'vitest'
import {
  BAY_AREA_REGIONS,
  BAY_AREA_REGION_POLYGONS,
  getCityCoords,
  getCityRegion,
  type RegionPolygon,
} from './californiaGeo'

// All expected region keys
const REGION_KEYS = ['marin', 'sf', 'peninsula', 'southBay', 'eastBay', 'napaSonoma'] as const

describe('BAY_AREA_REGIONS', () => {
  it('napaSonoma region has expected cities', () => {
    const region = BAY_AREA_REGIONS.napaSonoma
    expect(region.name).toBe('Napa / Sonoma')
    expect(region.cities).toContain('Napa')
    expect(region.cities).toContain('Petaluma')
    expect(region.cities).toContain('Santa Rosa')
    expect(region.cities).toContain('Sonoma')
    expect(region.cities.length).toBeGreaterThanOrEqual(8)
  })
})

describe('BAY_AREA_REGION_POLYGONS', () => {
  it('polygon coordinates are within Bay Area bounds', () => {
    // Bay Area roughly: lat 36.5-39.5, lng -124 to -120.5
    const checkPoint = ([lat, lng]: [number, number]) => {
      expect(lat).toBeGreaterThan(36.5)
      expect(lat).toBeLessThan(39.5)
      expect(lng).toBeGreaterThan(-124)
      expect(lng).toBeLessThan(-120.5)
    }
    for (const key of REGION_KEYS) {
      const poly: RegionPolygon = BAY_AREA_REGION_POLYGONS[key]
      const isMulti = Array.isArray(poly.polygon[0]?.[0])
      if (isMulti) {
        for (const ring of poly.polygon as Array<Array<[number, number]>>) {
          for (const pt of ring) checkPoint(pt)
        }
      } else {
        for (const pt of poly.polygon as Array<[number, number]>) checkPoint(pt)
      }
    }
  })
})

describe('getCityCoords (regression)', () => {
  it('returns coordinates for known CA cities', () => {
    expect(getCityCoords('San Francisco')).toBeDefined()
    expect(getCityCoords('Oakland')).toBeDefined()
    expect(getCityCoords('Palo Alto')).toBeDefined()
  })

  it('handles case-insensitive lookup', () => {
    expect(getCityCoords('san francisco')).toBeDefined()
  })

  it('returns undefined for truly unknown cities', () => {
    expect(getCityCoords('Xyzzyville')).toBeUndefined()
  })

  it('returns coordinates for out-of-state US cities via US_CITY_COORDS', () => {
    // These are NOT in CA_CITY_COORDS but should resolve via US_CITY_COORDS
    expect(getCityCoords('Denver')).toBeDefined()
    expect(getCityCoords('Portland')).toBeDefined()
    expect(getCityCoords('Seattle')).toBeDefined()
    expect(getCityCoords('Chicago')).toBeDefined()
  })

  it('prefers CA_CITY_COORDS over US_CITY_COORDS for Bay Area cities', () => {
    // San Francisco is in both CA_CITY_COORDS and US_CITY_COORDS
    // CA_CITY_COORDS should win (fast path)
    const coords = getCityCoords('San Francisco')
    expect(coords).toBeDefined()
    expect(coords![0]).toBeCloseTo(37.7749, 2) // CA_CITY_COORDS value
  })

  it('handles city names with state suffix via US_CITY_COORDS fallback', () => {
    // "Denver, CO" should strip to "Denver" and find via US_CITY_COORDS
    expect(getCityCoords('Denver, CO')).toBeDefined()
  })

  it('handles case-insensitive US city lookup', () => {
    expect(getCityCoords('denver')).toBeDefined()
    expect(getCityCoords('PORTLAND')).toBeDefined()
  })
})

describe('getCityRegion (regression)', () => {
  it('returns correct regions for known cities', () => {
    expect(getCityRegion('San Rafael')).toBe('marin')
    expect(getCityRegion('San Francisco')).toBe('sf')
    expect(getCityRegion('Palo Alto')).toBe('peninsula')
    expect(getCityRegion('San Jose')).toBe('southBay')
    expect(getCityRegion('Oakland')).toBe('eastBay')
  })

  it('returns napaSonoma for Napa/Sonoma cities', () => {
    expect(getCityRegion('Napa')).toBe('napaSonoma')
    expect(getCityRegion('Petaluma')).toBe('napaSonoma')
    expect(getCityRegion('Santa Rosa')).toBe('napaSonoma')
  })

  it('returns undefined for non-Bay Area cities', () => {
    expect(getCityRegion('Los Angeles')).toBeUndefined()
  })
})
