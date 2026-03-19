/**
 * Tests for school coordinate lookup.
 *
 * Validates that SCHOOL_COORDS provides lat/lng pairs
 * and getSchoolCoords handles case-insensitive matching.
 */

import { describe, it, expect } from 'vitest'
import { SCHOOL_COORDS, getSchoolCoords } from './schoolGeo'

describe('getSchoolCoords', () => {
  it('returns coordinates for a known school', () => {
    const knownSchool = Object.keys(SCHOOL_COORDS)[0]!
    const coords = getSchoolCoords(knownSchool)
    expect(coords).toBeDefined()
    expect(coords).toHaveLength(2)
  })

  it('returns undefined for an unknown school', () => {
    expect(getSchoolCoords('Xyzzy Academy of Nonsense')).toBeUndefined()
  })

  it('is case-insensitive', () => {
    const knownSchool = Object.keys(SCHOOL_COORDS)[0]!
    const upper = getSchoolCoords(knownSchool.toUpperCase())
    const lower = getSchoolCoords(knownSchool.toLowerCase())
    const direct = getSchoolCoords(knownSchool)

    expect(upper).toEqual(direct)
    expect(lower).toEqual(direct)
  })
})
