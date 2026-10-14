/**
 * useAnalyticsFreshness — how fresh are the enrollments Analytics is showing? (PR 4, pick 3A)
 *
 * It reads the ENROLLMENT (attendees) sync's own last run for the season being viewed, never
 * the hourly bunk-assignment run, so it never overstates freshness. Unscoped, the status payload
 * is each job's latest run of ANY season, so 2026's nightly pass would vouch for 2027: the hook
 * must ask for the viewed season, and only a synced season can be asked for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

interface Opts {
  enabled?: boolean
  year?: number
}
const calls: Opts[] = []
let unscoped: unknown
let scoped: Record<number, unknown>

vi.mock('./useSyncStatusAPI', () => ({
  useSyncStatusAPI: (opts: Opts = {}) => {
    calls.push(opts)
    if (opts.year === undefined) return { data: unscoped }
    return { data: opts.enabled === false ? undefined : scoped[opts.year] }
  },
}))

import { forgetFinishedRuns, useAnalyticsFreshness } from './useAnalyticsFreshness'

const job = (status: string, end_time?: string) => ({ status, ...(end_time ? { end_time } : {}) })

beforeEach(() => {
  forgetFinishedRuns()
  calls.length = 0
  unscoped = { _synced_years: [2027, 2026], attendees: job('success', '2026-10-27T10:04:00Z') }
  scoped = {}
})

describe('useAnalyticsFreshness', () => {
  it("reads the viewed season's own attendees run", () => {
    scoped[2027] = {
      attendees: job('success', '2026-10-27T10:04:00Z'),
      bunk_assignments: job('success', '2026-10-27T16:00:00Z'),
    }
    const { result } = renderHook(() => useAnalyticsFreshness(2027))
    expect(calls).toContainEqual({ enabled: true, year: 2027 })
    expect(result.current).toEqual({ kind: 'synced', at: '2026-10-27T10:04:00Z', running: false })
  })

  it('never reads the hourly bunk-assignment run', () => {
    scoped[2027] = { bunk_assignments: job('success', '2026-10-27T16:00:00Z') }
    const { result } = renderHook(() => useAnalyticsFreshness(2027))
    expect(result.current).toEqual({ kind: 'never' })
  })

  // A live run carries no end_time: the backend returns the running (or queued) entry in place
  // of the last finished one (orchestrator.go statusLocked). So the hook remembers the last
  // finished time it saw, and without one says only that a sync is going.
  it('keeps the last finished time it saw while a run is live ("… · syncing now")', () => {
    scoped[2026] = { attendees: job('success', '2026-10-26T10:04:00Z') }
    const { result, rerender } = renderHook(() => useAnalyticsFreshness(2026))
    expect(result.current).toEqual({ kind: 'synced', at: '2026-10-26T10:04:00Z', running: false })
    scoped[2026] = { attendees: job('running') }
    rerender()
    expect(result.current).toEqual({ kind: 'synced', at: '2026-10-26T10:04:00Z', running: true })
  })

  it('treats a queued run in the nightly sequence as live too', () => {
    scoped[2026] = { attendees: job('success', '2026-10-26T10:04:00Z') }
    const { result, rerender } = renderHook(() => useAnalyticsFreshness(2026))
    scoped[2026] = { attendees: job('pending') }
    rerender()
    expect(result.current).toEqual({ kind: 'synced', at: '2026-10-26T10:04:00Z', running: true })
  })

  it('says "syncing" for a live run when no finished time has been seen, never "never"', () => {
    scoped[2027] = { attendees: job('running') }
    const { result } = renderHook(() => useAnalyticsFreshness(2027))
    expect(result.current).toEqual({ kind: 'syncing' })
  })

  it('does not carry one season’s finished time to another', () => {
    scoped[2026] = { attendees: job('success', '2026-10-26T10:04:00Z') }
    scoped[2027] = { attendees: job('running') }
    let year = 2026
    const { result, rerender } = renderHook(() => useAnalyticsFreshness(year))
    year = 2027
    rerender()
    expect(result.current).toEqual({ kind: 'syncing' })
  })

  it('says "never" when the season is synced but its attendees job has not run', () => {
    scoped[2027] = {}
    const { result } = renderHook(() => useAnalyticsFreshness(2027))
    expect(result.current).toEqual({ kind: 'never' })
  })

  it('shows nothing for a season outside the synced pair, and never asks the backend for it', () => {
    const { result } = renderHook(() => useAnalyticsFreshness(2024))
    expect(result.current).toEqual({ kind: 'none' })
    expect(calls.some((c) => c.year === 2024 && c.enabled !== false)).toBe(false)
  })

  it('falls back to the configured year and the one before when the backend omits _synced_years', () => {
    unscoped = { _configured_year: 2027 }
    scoped[2026] = { attendees: job('success', '2026-10-27T10:04:00Z') }
    const { result } = renderHook(() => useAnalyticsFreshness(2026))
    expect(result.current).toMatchObject({ kind: 'synced' })
  })

  it('is loading until both payloads arrive', () => {
    unscoped = undefined
    const { result } = renderHook(() => useAnalyticsFreshness(2027))
    expect(result.current).toEqual({ kind: 'loading' })
  })
})
