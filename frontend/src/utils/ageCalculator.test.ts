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
    { birthDate: '2015-01-01', expected: 10.0, desc: 'birthday earlier this year' },
    { birthDate: '2015-03-15', expected: 9.1, desc: 'birthday not yet reached' },
    { birthDate: '2015-01-15', expected: 10.0, desc: 'same day birthday' },
    { birthDate: '2015-01-14', expected: 10.0, desc: 'birthday yesterday (just turned)' },
    { birthDate: '2014-02-15', expected: 10.11, desc: 'fractional months' },
    { birthDate: '2014-12-15', expected: 10.01, desc: 'year boundary' },
    { birthDate: '2024-12-15', expected: 0.01, desc: 'very young age' },
    { birthDate: '2015-12-15', expected: 9.01, desc: 'future birthday in current year' },
  ])('$desc ($birthDate → $expected)', ({ birthDate, expected }) => {
    expect(calculateAge(birthDate)).toBe(expected)
  })
})
