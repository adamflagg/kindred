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
  REGION_COLORS,
  getCityCoords,
  getCityRegion,
  type RegionPolygon,
} from './californiaGeo'

// All expected region keys
const REGION_KEYS = ['marin', 'sf', 'peninsula', 'southBay', 'eastBay', 'napaSonoma'] as const

describe('BAY_AREA_REGIONS', () => {
  it('has exactly 6 regions including napaSonoma', () => {
    const keys = Object.keys(BAY_AREA_REGIONS)
    expect(keys).toHaveLength(6)
    for (const key of REGION_KEYS) {
      expect(BAY_AREA_REGIONS).toHaveProperty(key)
    }
  })

  it('napaSonoma region has expected cities', () => {
    const region = BAY_AREA_REGIONS.napaSonoma
    expect(region.name).toBe('Napa / Sonoma')
    expect(region.cities).toContain('Napa')
    expect(region.cities).toContain('Petaluma')
    expect(region.cities).toContain('Santa Rosa')
    expect(region.cities).toContain('Sonoma')
    expect(region.cities.length).toBeGreaterThanOrEqual(8)
  })

  it('each region has a name, center, and cities', () => {
    for (const key of REGION_KEYS) {
      const region = BAY_AREA_REGIONS[key]
      expect(region.name).toBeTruthy()
      expect(region.center).toHaveLength(2)
      expect(region.cities.length).toBeGreaterThan(0)
    }
  })
})

describe('BAY_AREA_REGION_POLYGONS', () => {
  it('has exactly 6 entries matching region keys', () => {
    const keys = Object.keys(BAY_AREA_REGION_POLYGONS)
    expect(keys).toHaveLength(6)
    for (const key of REGION_KEYS) {
      expect(BAY_AREA_REGION_POLYGONS).toHaveProperty(key)
    }
  })

  it('each polygon has at least 3 coordinate tuples', () => {
    for (const key of REGION_KEYS) {
      const poly: RegionPolygon = BAY_AREA_REGION_POLYGONS[key]
      expect(poly.polygon.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('each polygon has a name and labelCenter', () => {
    for (const key of REGION_KEYS) {
      const poly: RegionPolygon = BAY_AREA_REGION_POLYGONS[key]
      expect(poly.name).toBeTruthy()
      expect(poly.labelCenter).toHaveLength(2)
    }
  })

  it('polygon coordinates are within Bay Area bounds', () => {
    // Bay Area roughly: lat 36.9-39.0, lng -123.5 to -121.0
    for (const key of REGION_KEYS) {
      const poly: RegionPolygon = BAY_AREA_REGION_POLYGONS[key]
      for (const [lat, lng] of poly.polygon) {
        expect(lat).toBeGreaterThan(36.5)
        expect(lat).toBeLessThan(39.5)
        expect(lng).toBeGreaterThan(-124)
        expect(lng).toBeLessThan(-120.5)
      }
    }
  })
})

describe('REGION_COLORS', () => {
  it('has exactly 6 entries with fill and stroke', () => {
    const keys = Object.keys(REGION_COLORS)
    expect(keys).toHaveLength(6)
    for (const key of REGION_KEYS) {
      const color = REGION_COLORS[key]
      expect(color).toHaveProperty('fill')
      expect(color).toHaveProperty('stroke')
      expect(typeof color.fill).toBe('string')
      expect(typeof color.stroke).toBe('string')
    }
  })
})

describe('getCityCoords (regression)', () => {
  it('returns coordinates for known cities', () => {
    expect(getCityCoords('San Francisco')).toBeDefined()
    expect(getCityCoords('Oakland')).toBeDefined()
    expect(getCityCoords('Palo Alto')).toBeDefined()
  })

  it('handles case-insensitive lookup', () => {
    expect(getCityCoords('san francisco')).toBeDefined()
  })

  it('returns undefined for unknown cities', () => {
    expect(getCityCoords('Atlantis')).toBeUndefined()
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
