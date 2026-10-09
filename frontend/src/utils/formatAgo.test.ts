import { describe, expect, it } from 'vitest'

import { formatAgo } from './formatAgo'

const NOW = new Date('2026-10-08T18:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('formatAgo (the secondary bar’s compact relative time)', () => {
  it.each([
    [30 * 1000, 'just now'],
    [1 * MIN, '1m ago'],
    [59 * MIN, '59m ago'],
    [60 * MIN, '1h ago'],
    [18 * HOUR + 40 * MIN, '18h ago'],
    [23 * HOUR + 59 * MIN, '23h ago'],
    [1 * DAY, '1d ago'],
    [3 * DAY + 5 * HOUR, '3d ago'],
    [29 * DAY, '29d ago'],
    [30 * DAY, '1mo ago'],
    [62 * DAY, '2mo ago'],
    [364 * DAY, '12mo ago'],
    [365 * DAY, '1y ago'],
    [800 * DAY, '2y ago'],
  ])('%i ms ago reads %s', (ms, expected) => {
    expect(formatAgo(ago(ms), NOW)).toBe(expected)
  })

  it('reads a timestamp slightly in the future (clock skew) as just now', () => {
    expect(formatAgo(new Date(NOW.getTime() + 5 * MIN).toISOString(), NOW)).toBe('just now')
  })
})
