import { describe, expect, it } from 'vitest'

import { campToday, formatLongDate, formatShortDate, parseIsoDay } from './dates'

describe('campToday (api/services/camp_calendar.py CAMP_TZ)', () => {
  it('is the date on camp time, not UTC', () => {
    // 05:30 UTC on Oct 2 is 22:30 on Oct 1 in camp time.
    expect(campToday(new Date('2026-10-02T05:30:00Z'))).toBe('2026-10-01')
  })
})

describe('parseIsoDay', () => {
  it('reads a real calendar day', () => {
    expect(parseIsoDay('2027-04-01')).toEqual({ year: 2027, month: 4, day: 1 })
  })

  it.each(['2026-13-01', '2026-02-30', 'yesterday', '2026-4-1', ''])('refuses %j', (raw) => {
    expect(parseIsoDay(raw)).toBeNull()
  })
})

describe('formatShortDate / formatLongDate', () => {
  it('names the month and drops the leading zero', () => {
    expect(formatShortDate('2027-04-01')).toBe('Apr 1')
    expect(formatLongDate('2027-04-01')).toBe('Apr 1, 2027')
  })

  it('reads the day part of a timestamp', () => {
    expect(formatShortDate('2027-06-03T00:00:00Z')).toBe('Jun 3')
  })

  it('returns anything it cannot read unchanged', () => {
    expect(formatShortDate('not a date')).toBe('not a date')
  })
})
