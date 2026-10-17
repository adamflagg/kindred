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
const mockRefetch = vi.fn()

vi.mock('./useSyncStatusAPI', () => ({
  useSyncStatusAPI: (opts: Opts = {}) => {
    if (opts.year === undefined) return { data: unscoped }
    return { data: opts.enabled === false ? undefined : scoped[opts.year], refetch: mockRefetch }
  },
}))

import { forgetFinishedRuns } from './useAnalyticsFreshness'
import { forgetStaleRefetches, useLiveSync } from './useLiveSync'

const job = (status: string, end_time?: string) => ({ status, ...(end_time ? { end_time } : {}) })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-12-14T22:40:00Z'))
  forgetFinishedRuns()
  forgetStaleRefetches()
  mockRefetch.mockReset()
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

  it('keeps the failed flag while the next run is going, and dates by the last success (row 2)', () => {
    scoped[2027] = {
      attendees: {
        ...job('failed', '2026-12-14T22:05:00Z'),
        last_success_at: '2026-12-14T20:05:00Z',
      },
    }
    const { result, rerender } = renderHook(() => useLiveSync(2027))
    expect(result.current.sync).toMatchObject({ at: '2026-12-14T20:05:00Z', failed: true })
    scoped[2027] = {
      attendees: { ...job('running'), last_success_at: '2026-12-14T20:05:00Z' },
    }
    rerender()
    expect(result.current.sync).toMatchObject({ at: '2026-12-14T20:05:00Z', failed: true })
  })

  // Row 1 of the scan: a tab left open past a missed refetch reads amber off a status that is only
  // stale in the cache. On the minute tick, a known sync older than 65 min refetches the viewed
  // season's status once; the staleTime is unchanged.
  describe('a sync more than 65 minutes old', () => {
    it('refetches the viewed season status once, not on every tick', () => {
      scoped[2027] = { attendees: job('success', '2026-12-14T21:30:00Z') } // 70 min before 22:40
      renderHook(() => useLiveSync(2027))
      expect(mockRefetch).toHaveBeenCalledTimes(1)
      act(() => {
        vi.advanceTimersByTime(3 * 60_000)
      })
      expect(mockRefetch).toHaveBeenCalledTimes(1)
    })

    it('does not refetch within 65 minutes, then does once the page sits open past it', () => {
      scoped[2027] = { attendees: job('success', '2026-12-14T21:40:00Z') } // 60 min
      renderHook(() => useLiveSync(2027))
      expect(mockRefetch).not.toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(6 * 60_000) // 66 min
      })
      expect(mockRefetch).toHaveBeenCalledTimes(1)
    })

    it('refetches again for a later stale sync time', () => {
      scoped[2027] = { attendees: job('success', '2026-12-14T21:30:00Z') }
      const { rerender } = renderHook(() => useLiveSync(2027))
      scoped[2027] = { attendees: job('success', '2026-12-14T21:31:00Z') }
      rerender()
      act(() => {
        vi.advanceTimersByTime(60_000)
      })
      expect(mockRefetch).toHaveBeenCalledTimes(2)
    })

    // Scan of the #3283 fix delta: the once-per guard dated by the last SUCCESS pinned a tab after a
    // failed run, since the success time never moves; nothing polls an idle status and window focus
    // does not refetch (queryClient), so the next good run never reached it. Dated by the latest
    // finished run instead, a failure is re-read once it is 65 minutes old too.
    it('re-reads after a failed run once that run is 65 minutes old, not pinned to the last success', () => {
      scoped[2027] = { attendees: job('success', '2026-12-14T21:30:00Z') } // 70 min before 22:40
      const { rerender } = renderHook(() => useLiveSync(2027))
      expect(mockRefetch).toHaveBeenCalledTimes(1)
      // The refetch brings a failed run at 22:35; the last success is still 21:30.
      scoped[2027] = {
        attendees: {
          ...job('failed', '2026-12-14T22:35:00Z'),
          last_success_at: '2026-12-14T21:30:00Z',
        },
      }
      rerender()
      expect(mockRefetch).toHaveBeenCalledTimes(1)
      act(() => {
        vi.advanceTimersByTime(66 * 60_000) // 23:46: the failed run is 71 min old
      })
      expect(mockRefetch).toHaveBeenCalledTimes(2)
      act(() => {
        vi.advanceTimersByTime(5 * 60_000)
      })
      expect(mockRefetch).toHaveBeenCalledTimes(2)
    })

    it('does nothing when no sync time is known', () => {
      renderHook(() => useLiveSync(2024))
      expect(mockRefetch).not.toHaveBeenCalled()
    })
  })
})
