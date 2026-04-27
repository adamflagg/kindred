import { describe, it, expect } from 'vitest'
import { formatTimestamp } from './formatTimestamp'

const NOW = new Date('2026-04-27T19:00:00Z')

describe('formatTimestamp', () => {
  it('returns "just now" when delta is under 1 minute', () => {
    const t = new Date(NOW.getTime() - 30_000).toISOString()
    expect(formatTimestamp(t, NOW)).toBe('just now')
  })

  it('returns "{n} minutes ago" for sub-hour deltas', () => {
    const t = new Date(NOW.getTime() - 12 * 60_000).toISOString()
    expect(formatTimestamp(t, NOW)).toBe('12 minutes ago')
  })

  it('uses singular "1 minute ago" at exactly 1 minute', () => {
    const t = new Date(NOW.getTime() - 60_000).toISOString()
    expect(formatTimestamp(t, NOW)).toBe('1 minute ago')
  })

  it('returns "{n} hours ago" for sub-day deltas', () => {
    const t = new Date(NOW.getTime() - 5 * 60 * 60_000).toISOString()
    expect(formatTimestamp(t, NOW)).toBe('5 hours ago')
  })

  it('uses singular "1 hour ago" at exactly 1 hour', () => {
    const t = new Date(NOW.getTime() - 60 * 60_000).toISOString()
    expect(formatTimestamp(t, NOW)).toBe('1 hour ago')
  })

  it('stays in relative "X hours ago" form just under 24h, even when minutes round up', () => {
    // 23h31m: Math.round(1411/60) = 24 would have flipped to absolute date.
    // hoursFloor must keep this in the relative branch.
    const t = new Date(NOW.getTime() - (23 * 60 + 31) * 60_000).toISOString()
    expect(formatTimestamp(t, NOW)).toMatch(/hours ago$/)
  })

  it('returns absolute "Apr 25 at 2:32 PM" form for >=24h deltas', () => {
    const t = new Date('2026-04-25T14:32:00').toISOString()
    const result = formatTimestamp(t, NOW)
    expect(result).toMatch(/Apr 25 at 2:32 PM/)
  })
})
