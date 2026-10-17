/**
 * useLiveSync — what the sync status says about drawing PR 5b's live point (velocityLive.livePoint):
 * when the viewed season's enrollment run last finished, whether it failed, and whether the nightly is
 * running (#111: the nightly window shows the stored count only). It reads the same run the chip does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

interface Opts {
  enabled?: boolean
  year?: number
}
let unscoped: unknown
let scoped: Record<number, unknown>

vi.mock('./useSyncStatusAPI', () => ({
  useSyncStatusAPI: (opts: Opts = {}) => {
    if (opts.year === undefined) return { data: unscoped }
    return { data: opts.enabled === false ? undefined : scoped[opts.year] }
  },
}))

import { forgetFinishedRuns } from './useAnalyticsFreshness'
import { useLiveSync } from './useLiveSync'

const job = (status: string, end_time?: string) => ({ status, ...(end_time ? { end_time } : {}) })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-12-14T22:40:00Z'))
  forgetFinishedRuns()
  unscoped = { _synced_years: [2027, 2026] }
  scoped = {}
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useLiveSync', () => {
  it("dates the live point by the viewed season's attendees run", () => {
    scoped[2027] = { attendees: job('success', '2026-12-14T22:05:00Z'), _daily_sync_running: false }
    const { result } = renderHook(() => useLiveSync(2027))
    expect(result.current.sync).toEqual({
      at: '2026-12-14T22:05:00Z',
      failed: false,
      nightly: false,
    })
    expect(result.current.now).toBe(Date.parse('2026-12-14T22:40:00Z'))
  })

  it('says when the nightly is running', () => {
    scoped[2027] = { attendees: job('success', '2026-12-14T10:05:00Z'), _daily_sync_running: true }
    const { result } = renderHook(() => useLiveSync(2027))
    expect(result.current.sync.nightly).toBe(true)
  })

  it('says when the last run failed', () => {
    scoped[2027] = { attendees: job('failed', '2026-12-14T22:05:00Z') }
    const { result } = renderHook(() => useLiveSync(2027))
    expect(result.current.sync.failed).toBe(true)
  })

  it('knows no time for a season the scheduled runs do not cover', () => {
    const { result } = renderHook(() => useLiveSync(2024))
    expect(result.current.sync.at).toBeNull()
  })

  it('ticks, so a point goes stale while the page sits open', () => {
    scoped[2027] = { attendees: job('success', '2026-12-14T22:05:00Z') }
    const { result } = renderHook(() => useLiveSync(2027))
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current.now).toBe(Date.parse('2026-12-14T22:41:00Z'))
  })
})
