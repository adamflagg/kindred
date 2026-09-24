/**
 * Tests for getDisplayAge — owner ruling 2026-09-24.
 *
 * `persons.age` is CampMinder's yy.mm SNAPSHOT, taken at each year-row's last
 * sync, and rows for different years were last synced at different times. So
 * "stored age minus (calendar year - viewing year)" drifts: the real-shaped
 * case below read 11y11m on its 2025 page and 13y6m on its 2026 page, about
 * 1y7m apart for what should be one year.
 *
 * The ruling:
 * - prior year  -> age at that year's SESSION START, from birthdate (the
 *   caller passes the session in context, or the person's earliest enrolled
 *   session start that year); with no session, the age on today's date that
 *   many years ago
 * - current year -> age as of today, from birthdate
 * - no birthdate -> the stored age with the old year adjustment (approximate)
 *
 * Fictional data throughout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { earliestSessionStart, getDisplayAge, getDisplayAgeForYear } from './displayAge'

// Local noon, so the "today" these tests reason about is the same calendar
// day in every runner time zone.
const TODAY = new Date(2026, 8, 24, 12, 0, 0) // 2026-09-24

describe('getDisplayAge', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Olivia Chen, born 2013-03-15. Her 2020-2025 rows were last synced early
  // in 2026 (stored 12.11); her 2026 row was synced this month (13.06).
  // Her 2025 summer session started 2025-07-06.
  describe('the real-shaped case (snapshots synced at different times)', () => {
    const row2025 = { age: 12.11, birthdate: '2013-03-15' }
    const row2026 = { age: 13.06, birthdate: '2013-03-15' }
    const SESSION_2025_START = '2025-07-06 07:00:00.000Z'

    it('shows the 2025 age at that summer session start, not the snapshot minus one', () => {
      // Old rule: 12.11 - 1 = 11.11.
      expect(getDisplayAge(row2025, 2025, SESSION_2025_START)).toBe(12.03)
    })

    it('shows the 2026 age as of today, from birthdate', () => {
      expect(getDisplayAge(row2026, 2026)).toBe(13.06)
    })

    it('ignores a stale current-year snapshot in favour of the birthdate', () => {
      // The same person read through a row last synced early in the year.
      expect(getDisplayAge({ age: 12.11, birthdate: '2013-03-15' }, 2026)).toBe(13.06)
    })

    it('ignores the session start for the current year', () => {
      expect(getDisplayAge(row2026, 2026, '2026-07-05 07:00:00.000Z')).toBe(13.06)
    })

    it('falls back to today, that many years ago, when a prior year has no session', () => {
      // 2025-09-24
      expect(getDisplayAge(row2025, 2025)).toBe(12.06)
      expect(getDisplayAge(row2025, 2025, null)).toBe(12.06)
      expect(getDisplayAge(row2025, 2025, '')).toBe(12.06)
    })

    it('reads an older year from its own session start', () => {
      // 2021 session started 2021-07-11 -> 8 years 3 months.
      expect(getDisplayAge(row2025, 2021, '2021-07-11 07:00:00.000Z')).toBe(8.03)
    })
  })

  describe('leap-day birthdate', () => {
    const person = { age: 10.06, birthdate: '2016-02-29' }

    it('is still 8 on Feb 28 of a common year', () => {
      expect(getDisplayAge(person, 2025, '2025-02-28')).toBe(8.11)
    })

    it('turns 9 on Mar 1 of a common year', () => {
      expect(getDisplayAge(person, 2025, '2025-03-01')).toBe(9.0)
    })

    it('turns 8 on the leap day itself', () => {
      expect(getDisplayAge(person, 2024, '2024-02-29')).toBe(8.0)
    })

    it('is computed from birthdate for the current year too', () => {
      expect(getDisplayAge(person, 2026)).toBe(10.06)
    })

    it('does not invent Feb 29 in a common year when today is a leap day', () => {
      vi.setSystemTime(new Date(2028, 1, 29, 12, 0, 0))
      // Today that many years ago is 2025-02-28, not a non-existent 2025-02-29.
      expect(getDisplayAge({ birthdate: '2016-03-01' }, 2025)).toBe(8.11)
      expect(getDisplayAge(person, 2025)).toBe(8.11)
    })
  })

  describe('no birthdate: the stored snapshot, approximately adjusted', () => {
    it('returns the stored age unchanged for the current year', () => {
      expect(getDisplayAge({ age: 15.04 }, 2026)).toBe(15.04)
    })

    it('subtracts the year difference for a prior year', () => {
      expect(getDisplayAge({ age: 15.04 }, 2025)).toBe(14.04)
      expect(getDisplayAge({ age: 15.04, birthdate: '' }, 2024)).toBe(13.04)
    })

    it('uses the stored age when the birthdate cannot be read', () => {
      expect(getDisplayAge({ age: 15.04, birthdate: 'not a date' }, 2025)).toBe(14.04)
    })

    it('keeps two-decimal yy.mm without float noise', () => {
      expect(getDisplayAge({ age: 12.06 }, 2025)).toBe(11.06)
      expect(getDisplayAge({ age: 11.11 }, 2024)).toBe(9.11)
    })
  })

  it('returns null when both age and birthdate are missing', () => {
    expect(getDisplayAge({}, 2026)).toBeNull()
    expect(getDisplayAge({ age: undefined, birthdate: undefined }, 2025)).toBeNull()
  })

  it('returns null when the reference day predates the birth', () => {
    // Bad data, not a valid age — same as the server's `_age_at`.
    expect(getDisplayAge({ birthdate: '2026-01-10' }, 2025, '2025-07-06')).toBeNull()
  })

  it('projects a future year from today, that many years ahead', () => {
    expect(getDisplayAge({ birthdate: '2013-03-15' }, 2027)).toBe(14.06)
  })

  it('getDisplayAgeForYear is the same function', () => {
    const person = { age: 12.11, birthdate: '2013-03-15' }
    expect(getDisplayAgeForYear(person, 2025, '2025-07-06')).toBe(12.03)
    expect(getDisplayAgeForYear(person, 2026)).toBe(13.06)
  })
})

describe('earliestSessionStart', () => {
  it('picks the earliest start by calendar day', () => {
    expect(
      earliestSessionStart([
        { start_date: '2025-07-06 07:00:00.000Z' },
        { start_date: '2025-06-08 07:00:00.000Z' },
        { start_date: '2025-08-03 07:00:00.000Z' },
      ])
    ).toBe('2025-06-08 07:00:00.000Z')
  })

  it('skips missing sessions and blank dates', () => {
    expect(
      earliestSessionStart([null, undefined, { start_date: '' }, { start_date: '2025-07-06' }])
    ).toBe('2025-07-06')
  })

  it('returns undefined when there is nothing to choose from', () => {
    expect(earliestSessionStart([])).toBeUndefined()
    expect(earliestSessionStart([null, { start_date: '' }, {}])).toBeUndefined()
  })

  // Owner decision 2026-09-24 (PR #2818 review): the camper page reads a past
  // year's age at the earliest SUMMER-camp start, so it agrees with the board.
  // A spring family weekend or a teen program counts only when there is no
  // summer session that year.
  it('prefers the earliest summer-camp start over an earlier family weekend', () => {
    expect(
      earliestSessionStart([
        { start_date: '2025-07-06', session_type: 'main' },
        { start_date: '2025-05-23', session_type: 'family' },
        { start_date: '2025-07-13', session_type: 'ag' },
      ])
    ).toBe('2025-07-06')
  })

  it.each(['main', 'embedded', 'ag', 'quest'])('counts %s as summer camp', (sessionType) => {
    expect(
      earliestSessionStart([
        { start_date: '2025-08-03', session_type: 'main' },
        { start_date: '2025-06-20', session_type: sessionType },
        { start_date: '2025-05-01', session_type: 'family' },
      ])
    ).toBe('2025-06-20')
  })

  it('falls back to any enrolled start when there is no summer session', () => {
    expect(
      earliestSessionStart([
        { start_date: '2025-06-15', session_type: 'tli' },
        { start_date: '2025-05-23', session_type: 'family' },
      ])
    ).toBe('2025-05-23')
  })

  it('falls back when the only summer session has no start date', () => {
    expect(
      earliestSessionStart([
        { start_date: '', session_type: 'main' },
        { start_date: '2025-05-23', session_type: 'family' },
      ])
    ).toBe('2025-05-23')
  })
})
