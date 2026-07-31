/**
 * Weekend lifecycle grouping for the lander.
 *
 * The dates are PocketBase datetimes whose 07:00Z is local midnight at camp,
 * so status compares calendar dates rather than instants.
 */
import { describe, expect, it } from 'vitest'

import type { WeekendSession } from '../../types/lodging'
import { calendarKey, groupWeekends, todayKey, weekendStatus } from './weekendStatus'

function session(overrides: Partial<WeekendSession> = {}): WeekendSession {
  return {
    session_id: 's1',
    session_cm_id: 1000001,
    name: 'Family Camp 1',
    session_type: 'family',
    start_date: '2026-05-22 07:00:00.000Z',
    end_date: '2026-05-25 07:00:00.000Z',
    ...overrides,
  }
}

describe('calendarKey', () => {
  it('reads the leading calendar date from a PocketBase datetime', () => {
    expect(calendarKey('2026-05-22 07:00:00.000Z')).toBe(20260522)
  })

  it('reads a bare ISO date too', () => {
    expect(calendarKey('2026-05-22')).toBe(20260522)
  })

  it('returns null when there is no date', () => {
    expect(calendarKey(undefined)).toBeNull()
    expect(calendarKey('')).toBeNull()
    expect(calendarKey('sometime in May')).toBeNull()
  })
})

describe('todayKey', () => {
  it('uses the local calendar date, not UTC', () => {
    // 2026-05-22 at 23:00 local is still the 22nd wherever the viewer is.
    expect(todayKey(new Date(2026, 4, 22, 23, 0, 0))).toBe(20260522)
  })
})

describe('weekendStatus', () => {
  it('is upcoming before the start date', () => {
    expect(weekendStatus(session(), 20260501)).toBe('upcoming')
  })

  it('is in progress on the first day', () => {
    expect(weekendStatus(session(), 20260522)).toBe('in-progress')
  })

  it('is in progress on the last day', () => {
    expect(weekendStatus(session(), 20260525)).toBe('in-progress')
  })

  it('is completed the day after it ends', () => {
    expect(weekendStatus(session(), 20260526)).toBe('completed')
  })

  it('treats a weekend with no dates as upcoming rather than hiding it', () => {
    const undated = session()
    delete undated.start_date
    delete undated.end_date
    expect(weekendStatus(undated, 20260601)).toBe('upcoming')
  })
})

describe('groupWeekends', () => {
  it('splits by status and sorts each group by start date', () => {
    const groups = groupWeekends(
      [
        session({
          session_cm_id: 3,
          name: 'Later',
          start_date: '2026-09-04 07:00:00.000Z',
          end_date: '2026-09-07 07:00:00.000Z',
        }),
        session({
          session_cm_id: 1,
          name: 'Past',
          start_date: '2026-01-02 07:00:00.000Z',
          end_date: '2026-01-04 07:00:00.000Z',
        }),
        session({
          session_cm_id: 2,
          name: 'Sooner',
          start_date: '2026-06-05 07:00:00.000Z',
          end_date: '2026-06-08 07:00:00.000Z',
        }),
      ],
      20260501
    )
    expect(groups.completed.map((s) => s.name)).toEqual(['Past'])
    expect(groups.upcoming.map((s) => s.name)).toEqual(['Sooner', 'Later'])
    expect(groups.inProgress).toEqual([])
  })

  it('puts a weekend happening right now in its own group', () => {
    const groups = groupWeekends([session()], 20260523)
    expect(groups.inProgress.map((s) => s.name)).toEqual(['Family Camp 1'])
    expect(groups.upcoming).toEqual([])
  })

  it('returns empty groups for an empty year', () => {
    const groups = groupWeekends([], 20260501)
    expect(groups).toEqual({ inProgress: [], upcoming: [], completed: [] })
  })
})
