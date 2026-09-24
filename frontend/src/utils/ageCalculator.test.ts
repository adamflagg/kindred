/**
 * Tests for age calculator utility
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { calculateAge, parseCalendarDay } from './ageCalculator'

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

// Owner ruling 2026-09-24: a prior year's age is the age at that year's
// session start, so the helper takes the reference day instead of assuming
// today. Same completed-months arithmetic as the server's `_completed_months`
// (api/services/lodging_roster_service.py) — a month counts once it finishes.
describe('calculateAge as of a reference day', () => {
  it.each([
    {
      birthDate: '2013-03-15',
      asOf: '2025-07-06',
      expected: 12.03,
      desc: 'a summer session start',
    },
    { birthDate: '2013-03-15', asOf: '2026-09-24', expected: 13.06, desc: 'a later day' },
    {
      birthDate: '2013-03-15',
      asOf: '2025-03-14',
      expected: 11.11,
      desc: 'the day before a birthday',
    },
    { birthDate: '2013-03-15', asOf: '2025-03-15', expected: 12.0, desc: 'on the birthday' },
    {
      birthDate: '2016-02-29',
      asOf: '2025-02-28',
      expected: 8.11,
      desc: 'leap-day birth, Feb 28 of a common year',
    },
    {
      birthDate: '2016-02-29',
      asOf: '2025-03-01',
      expected: 9.0,
      desc: 'leap-day birth turns over on Mar 1',
    },
    {
      birthDate: '2016-02-29',
      asOf: '2024-02-29',
      expected: 8.0,
      desc: 'leap-day birth on a leap day',
    },
  ])('$desc ($birthDate at $asOf → $expected)', ({ birthDate, asOf, expected }) => {
    expect(calculateAge(birthDate, asOf)).toBe(expected)
  })

  it('reads a PocketBase datetime as its calendar day, not a UTC instant', () => {
    // camp_sessions.start_date is Pacific midnight stored as UTC — the day is
    // the first ten characters, whatever the runner's time zone.
    expect(calculateAge('2013-03-15', '2025-07-06 07:00:00.000Z')).toBe(12.03)
    expect(calculateAge('2013-03-15 00:00:00.000Z', '2025-03-15 07:00:00.000Z')).toBe(12.0)
  })

  it('accepts a Date as the reference day, read in local time', () => {
    expect(calculateAge('2013-03-15', new Date(2025, 6, 6, 23, 30))).toBe(12.03)
  })
})

// The server's `_as_date` uses `date.fromisoformat`, which refuses a day the
// month does not have, and `_age_at` reports a reference day before the birth
// as unknown. The frontend mirror must fail safe the same way.
describe('server parity on bad dates', () => {
  it.each(['2025-02-30', '2025-04-31', '2025-02-29 00:00:00.000Z'])(
    'refuses %s, a day its month does not have',
    (value) => {
      expect(parseCalendarDay(value)).toBeNull()
    }
  )

  it('accepts Feb 29 in a leap year', () => {
    expect(parseCalendarDay('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 })
  })

  it('reports a reference day before the birth as NaN, not a negative age', () => {
    expect(calculateAge('2020-05-15', '2020-04-01')).toBeNaN()
  })
})
