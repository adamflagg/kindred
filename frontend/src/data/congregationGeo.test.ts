/**
 * Tests for congregation coordinate lookup.
 *
 * Validates that CONGREGATION_COORDS provides lat/lng pairs
 * and getCongregationCoords handles case-insensitive matching.
 */

import { describe, it, expect } from 'vitest'
import { CONGREGATION_COORDS, getCongregationCoords } from './congregationGeo'

describe('CONGREGATION_COORDS', () => {
  it('is a non-empty record', () => {
    expect(Object.keys(CONGREGATION_COORDS).length).toBeGreaterThan(0)
  })

  it('contains [lat, lng] pairs', () => {
    const first = Object.values(CONGREGATION_COORDS)[0]
    expect(first).toHaveLength(2)
    // Latitude roughly in Bay Area range
    expect(first![0]).toBeGreaterThan(30)
    expect(first![0]).toBeLessThan(42)
    // Longitude roughly in Bay Area range
    expect(first![1]).toBeGreaterThan(-125)
    expect(first![1]).toBeLessThan(-114)
  })
})

describe('getCongregationCoords', () => {
  it('returns coordinates for a known congregation', () => {
    const known = Object.keys(CONGREGATION_COORDS)[0]!
    const coords = getCongregationCoords(known)
    expect(coords).toBeDefined()
    expect(coords).toHaveLength(2)
  })

  it('returns undefined for an unknown congregation', () => {
    expect(getCongregationCoords('Temple of Quantum Basketweaving')).toBeUndefined()
  })

  it('is case-insensitive', () => {
    const known = Object.keys(CONGREGATION_COORDS)[0]!
    const upper = getCongregationCoords(known.toUpperCase())
    const lower = getCongregationCoords(known.toLowerCase())
    const direct = getCongregationCoords(known)

    expect(upper).toEqual(direct)
    expect(lower).toEqual(direct)
  })
})
