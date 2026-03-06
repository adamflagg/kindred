/**
 * Tests for unified coordinate lookup.
 *
 * Validates that getLocationCoords delegates to the correct
 * category-specific lookup function, and that getLocationCoordsWithOverrides
 * layers override coordinates on top of static lookups.
 */

import { describe, it, expect } from 'vitest'
import { getLocationCoords } from './geoCoords'
import type { LatLng } from './californiaGeo'
import { CA_CITY_COORDS } from './californiaGeo'
import { SCHOOL_COORDS } from './schoolGeo'
import { CONGREGATION_COORDS } from './congregationGeo'

describe('getLocationCoords', () => {
  it('delegates city lookups to getCityCoords', () => {
    const knownCity = Object.keys(CA_CITY_COORDS)[0]!
    const coords = getLocationCoords('city', knownCity)
    expect(coords).toBeDefined()
    expect(coords).toHaveLength(2)
  })

  it('delegates school lookups to getSchoolCoords', () => {
    const knownSchool = Object.keys(SCHOOL_COORDS)[0]!
    const coords = getLocationCoords('school', knownSchool)
    expect(coords).toBeDefined()
    expect(coords).toHaveLength(2)
  })

  it('delegates synagogue lookups to getCongregationCoords', () => {
    const known = Object.keys(CONGREGATION_COORDS)[0]!
    const coords = getLocationCoords('synagogue', known)
    expect(coords).toBeDefined()
    expect(coords).toHaveLength(2)
  })

  it('returns undefined for unknown names', () => {
    expect(getLocationCoords('city', 'Nonexistent City XYZ')).toBeUndefined()
    expect(getLocationCoords('school', 'Nonexistent School XYZ')).toBeUndefined()
    expect(getLocationCoords('synagogue', 'Nonexistent Temple XYZ')).toBeUndefined()
  })
})

describe('getLocationCoordsWithOverrides', () => {
  const overrideCoords = new Map<string, LatLng>([
    ['city:Maplewood', [40.7312, -74.2726]],
    ['school:Riverside Elementary', [37.82, -122.27]],
    ['congregation:Temple Shalom', [37.56, -122.33]],
  ])

  // Use dynamic import so tests compile even before the function is exported
  async function loadFn() {
    const mod: Record<string, unknown> = await import('./geoCoords')
    const fn = mod['getLocationCoordsWithOverrides'] as (
      category: string,
      name: string,
      overrideCoords?: Map<string, LatLng>
    ) => LatLng | undefined
    expect(fn).toBeDefined()
    return fn
  }

  it('returns override coord when present in map', async () => {
    const fn = await loadFn()
    expect(fn('city', 'Maplewood', overrideCoords)).toEqual([40.7312, -74.2726])
  })

  it('returns override coord for school category', async () => {
    const fn = await loadFn()
    expect(fn('school', 'Riverside Elementary', overrideCoords)).toEqual([37.82, -122.27])
  })

  it('falls back to static lookup when not in override map', async () => {
    const fn = await loadFn()
    const knownCity = Object.keys(CA_CITY_COORDS)[0]!
    const coords = fn('city', knownCity, overrideCoords)
    expect(coords).toEqual(getLocationCoords('city', knownCity))
    expect(coords).toBeDefined()
  })

  it('works without override map (undefined)', async () => {
    const fn = await loadFn()
    const knownCity = Object.keys(CA_CITY_COORDS)[0]!
    expect(fn('city', knownCity, undefined)).toEqual(getLocationCoords('city', knownCity))
  })

  it('works without override map (no argument)', async () => {
    const fn = await loadFn()
    const knownSchool = Object.keys(SCHOOL_COORDS)[0]!
    expect(fn('school', knownSchool)).toEqual(getLocationCoords('school', knownSchool))
  })

  it('maps "synagogue" category to "congregation" for key lookup', async () => {
    const fn = await loadFn()
    expect(fn('synagogue', 'Temple Shalom', overrideCoords)).toEqual([37.56, -122.33])
  })

  it('returns undefined for unknown names with no overrides', async () => {
    const fn = await loadFn()
    expect(fn('city', 'Nonexistent XYZ', overrideCoords)).toBeUndefined()
  })

  it('returns undefined for unknown category', async () => {
    const fn = await loadFn()
    expect(fn('unknown', 'Test', overrideCoords)).toBeUndefined()
  })
})
