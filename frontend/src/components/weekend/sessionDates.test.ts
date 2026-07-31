/**
 * Weekend date formatting.
 *
 * The wire format is PocketBase's datetime, not a bare date, and its 07:00Z
 * IS local midnight at camp — so these cases pin the hand-parse against both
 * the naive-split and the `new Date(...)` failure modes.
 */
import { describe, expect, it } from 'vitest'

import { formatSessionDates } from './sessionDates'

describe('formatSessionDates', () => {
  it('collapses a same-month range', () => {
    expect(formatSessionDates('2026-09-04', '2026-09-07')).toBe('Sep 4–7, 2026')
  })

  it('spells out both months when the weekend spans one', () => {
    expect(formatSessionDates('2026-10-30', '2026-11-01')).toBe('Oct 30 – Nov 1, 2026')
  })

  it('shows a single date when start and end match', () => {
    expect(formatSessionDates('2026-09-04', '2026-09-04')).toBe('Sep 4, 2026')
  })

  it('reads the PocketBase datetime the API actually sends', () => {
    // The wire format is a datetime, not a bare date. Splitting on "-" leaves
    // "22 07:00:00.000Z" as the day and yields NaN — which fails silently as
    // an empty string, so no dates render anywhere.
    expect(formatSessionDates('2026-05-22 07:00:00.000Z', '2026-05-25 07:00:00.000Z')).toBe(
      'May 22–25, 2026'
    )
  })

  it('takes the calendar date rather than converting the instant', () => {
    // 07:00Z IS local midnight at camp, so the leading calendar date is what
    // the field means. `new Date(...)` in a negative offset would land on the
    // right day only by accident.
    expect(formatSessionDates('2026-05-22 07:00:00.000Z', '2026-05-22 07:00:00.000Z')).toBe(
      'May 22, 2026'
    )
  })

  it('spans months in the PocketBase format too', () => {
    expect(formatSessionDates('2026-10-30 07:00:00.000Z', '2026-11-01 07:00:00.000Z')).toBe(
      'Oct 30 – Nov 1, 2026'
    )
  })

  it('returns an empty string when dates are missing or unparseable', () => {
    expect(formatSessionDates(undefined, undefined)).toBe('')
    expect(formatSessionDates('2026-09-04', undefined)).toBe('')
    expect(formatSessionDates('not a date', '2026-09-04')).toBe('')
  })
})
