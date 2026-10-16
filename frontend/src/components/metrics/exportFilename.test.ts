import { afterEach, describe, expect, it, vi } from 'vitest'
import { csvFilename } from './exportFilename'

describe('csvFilename (ruling #65)', () => {
  afterEach(() => vi.useRealTimers())

  it('is <season>-<view>-<camp date>.csv', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-16T05:00:00Z')) // 10:00 pm Oct 15 at camp
    expect(csvFilename(2026, 'Trends: Year-by-Year')).toBe(
      '2026-trends-year-by-year-2026-10-15.csv'
    )
  })
})
