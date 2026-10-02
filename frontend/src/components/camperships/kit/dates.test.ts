import { afterEach, describe, expect, it } from 'vitest'

import {
  campToday,
  formatCampDateTime,
  formatLongDate,
  formatShortDate,
  parseIsoDay,
} from './dates'

describe('campToday (api/services/camp_calendar.py CAMP_TZ)', () => {
  it('is the date on camp time, not UTC', () => {
    // 05:30 UTC on Oct 2 is 22:30 on Oct 1 in camp time.
    expect(campToday(new Date('2026-10-02T05:30:00Z'))).toBe('2026-10-01')
  })
})

const saved = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, 'format') ?? {}

describe('campToday does not trust a locale to print ISO', () => {
  afterEach(() => {
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', saved)
  })

  it('assembles YYYY-MM-DD from parts even if format() would print month-first', () => {
    // `format` is an accessor on the prototype: swap it, restored in afterEach.
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', {
      configurable: true,
      get: () => () => '10/01/2026',
    })
    expect(campToday(new Date('2026-10-01T18:00:00Z'))).toBe('2026-10-01')
  })

  it('pads a single-digit month and day', () => {
    expect(campToday(new Date('2026-03-04T18:00:00Z'))).toBe('2026-03-04')
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

describe('formatCampDateTime', () => {
  it('reads a stored time on camp time, day and 24-hour clock', () => {
    // 23:05 UTC on Apr 9 is 16:05 Pacific daylight time.
    expect(formatCampDateTime('2027-04-09T23:05:00Z')).toBe('Apr 9 16:05')
    // 03:30 UTC on Jan 21 is still Jan 20 on camp time (standard time, UTC-8).
    expect(formatCampDateTime('2027-01-21T03:30:00.123000Z')).toBe('Jan 20 19:30')
    expect(formatCampDateTime('2027-04-10T07:00:00Z')).toBe('Apr 10 00:00')
  })

  it('gives back anything unreadable unchanged', () => {
    expect(formatCampDateTime('not a time')).toBe('not a time')
  })
})
