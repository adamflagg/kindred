/**
 * Tests for unified coordinate lookup.
 *
 * Validates that getLocationCoords delegates to the correct
 * category-specific lookup function.
 */

import { describe, it, expect } from 'vitest'
import { getLocationCoords } from './geoCoords'
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
