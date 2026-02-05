/**
 * Tests for address utility functions
 *
 * Phase 2: Using discrete columns (address_city, address_state) instead of JSON parsing.
 */
import { describe, it, expect } from 'vitest'
import { getLocationDisplay } from './addressUtils'

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
