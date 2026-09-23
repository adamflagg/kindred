/**
 * Tests for address utility functions
 *
 * Phase 2: Using discrete columns (address_city, address_state) instead of JSON parsing.
 */
import { describe, it, expect } from 'vitest'
import { getLocationDisplay, personLocation } from './addressUtils'

describe('getLocationDisplay', () => {
  it('should return null when both city and state are undefined', () => {
    expect(getLocationDisplay(undefined, undefined)).toBe(null)
  })

  it('should return null when both city and state are null', () => {
    expect(getLocationDisplay(null, null)).toBe(null)
  })

  it('should return null when both city and state are empty strings', () => {
    expect(getLocationDisplay('', '')).toBe(null)
  })

  it('should return formatted string with city and state', () => {
    expect(getLocationDisplay('San Francisco', 'CA')).toBe('San Francisco, CA')
  })

  it('should handle city only', () => {
    expect(getLocationDisplay('Berkeley', undefined)).toBe('Berkeley')
    expect(getLocationDisplay('Berkeley', null)).toBe('Berkeley')
    expect(getLocationDisplay('Berkeley', '')).toBe('Berkeley')
  })

  it('should handle state only', () => {
    expect(getLocationDisplay(undefined, 'CA')).toBe('CA')
    expect(getLocationDisplay(null, 'CA')).toBe('CA')
    expect(getLocationDisplay('', 'CA')).toBe('CA')
  })

  it('should handle whitespace in values', () => {
    expect(getLocationDisplay('Los Angeles', 'California')).toBe('Los Angeles, California')
  })

  it('should trim whitespace-only values', () => {
    expect(getLocationDisplay('  ', 'CA')).toBe('CA')
    expect(getLocationDisplay('Oakland', '  ')).toBe('Oakland')
    expect(getLocationDisplay('  ', '  ')).toBe(null)
  })
})

// `normalized_city` is a DISPLAY-READY "City, ST" label set by the
// geo-normalization sync (pocketbase/sync/family_camp_roster.go —
// rosterStateSuffix/rosterCleanCity; 2,232 of 2,246 2026 values end in
// ", ST"). Both `CamperDetail.tsx` and `CamperDetailsPanel.tsx` used to do
// `getLocationDisplay(person.normalized_city ?? person.address_city,
// person.address_state)`, which appended the state a SECOND time onto an
// already-complete label ("San Carlos, CA, CA") — a pre-existing bug, fixed
// here at the field level rather than by string-matching a suffix onto
// `getLocationDisplay` itself, which stays exactly as it was.
describe('personLocation', () => {
  it('uses normalized_city whole, without appending state again', () => {
    expect(
      personLocation({ normalized_city: 'San Carlos, CA', address_city: null, address_state: 'CA' })
    ).toBe('San Carlos, CA')
  })

  it('falls back to composing address_city + address_state when normalized_city is blank', () => {
    expect(
      personLocation({ normalized_city: '', address_city: 'San Carlos', address_state: 'CA' })
    ).toBe('San Carlos, CA')
    expect(
      personLocation({ normalized_city: null, address_city: 'San Carlos', address_state: 'CA' })
    ).toBe('San Carlos, CA')
  })

  it('returns null when every field is blank', () => {
    expect(personLocation({ normalized_city: null, address_city: null, address_state: null })).toBe(
      null
    )
  })
})
