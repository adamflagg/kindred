/**
 * Tests for age calculator utility
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { calculateAge } from './ageCalculator'

describe('calculateAge', () => {
  beforeEach(() => {
    // Mock Date to a fixed point: January 15, 2025
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2025, 0, 15)) // Month is 0-indexed
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['2015-01-01', 10.0, 'birthday earlier this year'],
    ['2015-03-15', 9.1, 'birthday not yet reached'],
    ['2015-01-15', 10.0, 'same day birthday'],
    ['2015-01-14', 10.0, 'birthday yesterday (just turned)'],
    ['2014-02-15', 10.11, 'fractional months'],
    ['2014-12-15', 10.01, 'year boundary'],
    ['2024-12-15', 0.01, 'very young age'],
    ['2015-12-15', 9.01, 'future birthday in current year'],
  ])('calculates age correctly for %s: %s', (birthDate, expected, _description) => {
    expect(calculateAge(birthDate)).toBe(expected)
  })
})
