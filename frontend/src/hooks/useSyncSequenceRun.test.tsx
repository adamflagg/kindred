/**
 * The completion-detection primitive for `Orchestrator.RunSyncSequence` runs
 * (kindred#2478 §4.2c, kindred#2587).
 *
 * `_current_run` IS ABSENT for these runs — `GetCurrentRunProgress` switches on
 * dailySyncRunning / historicalSyncRunning / weeklySyncRunning /
 * customValuesSyncRunning and returns "" by default, and `RunSyncSequence` sets
 * none of them ("It carries no run-type flag"). So the only signal is the JOB
 * STATUSES in GET /api/custom/sync/status, which is what PR #2591 made complete.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { SyncStatusResponse } from './useSyncStatusAPI'

const syncStatusSpy = vi.fn((_opts?: unknown): { data: SyncStatusResponse | null | undefined } => ({
  data: undefined,
}))
vi.mock('./useSyncStatusAPI', () => ({
  useSyncStatusAPI: (...args: unknown[]) => syncStatusSpy(...args),
}))

const invalidateQueries = vi.fn()
vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return { ...actual, useQueryClient: () => ({ invalidateQueries }) }
})

import {
  useSyncSequenceRun,
  FAMILY_CAMP_REFRESH_CHAIN,
  BUNKING_REFRESH_CHAIN,
} from './useSyncSequenceRun'

/** A status payload with every chain job idle and a terminal end_time baseline. */
function idleStatus(overrides: Record<string, unknown> = {}): SyncStatusResponse {
  return {
    attendees: { status: 'success', end_time: '2026-04-22T09:00:00.000Z' },
    persons: { status: 'success', end_time: '2026-04-22T09:00:20.000Z' },
    person_custom_values_family_camp: { status: 'success', end_time: '2026-04-22T09:09:00.000Z' },
    household_custom_values_family_camp: {
      status: 'success',
      end_time: '2026-04-22T09:13:00.000Z',
    },
    family_camp_derived: { status: 'success', end_time: '2026-04-22T09:13:06.000Z' },
    lodging_assignments: { status: 'success', end_time: '2026-04-22T09:13:08.000Z' },
    bunks: { status: 'success', end_time: '2026-04-22T09:00:01.000Z' },
    bunk_plans: { status: 'success', end_time: '2026-04-22T09:00:02.000Z' },
    bunk_assignments: { status: 'success', end_time: '2026-04-22T09:00:03.000Z' },
    stranded_assignment_cleanup: { status: 'success', end_time: '2026-04-22T09:00:05.000Z' },
    ...overrides,
  } as unknown as SyncStatusResponse
}

function setStatus(status: SyncStatusResponse | null | undefined) {
  syncStatusSpy.mockImplementation(() => ({ data: status }))
}

describe('useSyncSequenceRun — chain shape', () => {
  it('mirrors GetRefreshFamilyCampJobs, terminating on lodging_assignments', () => {
    expect(FAMILY_CAMP_REFRESH_CHAIN.map((j) => j.service)).toEqual([
      'attendees',
      'persons',
      'person_custom_values_family_camp',
      'household_custom_values_family_camp',
      'family_camp_derived',
      'lodging_assignments',
    ])
  })

  it('mirrors GetRefreshBunkingJobs, terminating on stranded_assignment_cleanup', () => {
    expect(BUNKING_REFRESH_CHAIN.map((j) => j.service)).toEqual([
      'bunks',
      'bunk_plans',
      'bunk_assignments',
      'stranded_assignment_cleanup',
    ])
  })
})

describe('useSyncSequenceRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-22T10:00:00.000Z'))
    setStatus(idleStatus())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is not running at rest', () => {
    const { result } = renderHook(() =>
      useSyncSequenceRun({ chain: FAMILY_CAMP_REFRESH_CHAIN, enabled: true })
    )
    expect(result.current.isRunning).toBe(false)
  })

  it('reports running while a chain job is running, and survives a fresh mount (reload)', () => {
    setStatus(
      idleStatus({
        person_custom_values_family_camp: {
          status: 'running',
          start_time: '2026-04-22T09:59:00.000Z',
        },
      })
    )
    const { result } = renderHook(() =>
      useSyncSequenceRun({ chain: FAMILY_CAMP_REFRESH_CHAIN, enabled: true })
    )
    expect(result.current.isRunning).toBe(true)
  })

  it('does NOT report running when the orchestrator is doing a daily sync', () => {
    setStatus(
      idleStatus({
        attendees: { status: 'running', start_time: '2026-04-22T09:59:00.000Z' },
        _daily_sync_running: true,
        _current_run: { type: 'daily', total_jobs: 20, completed_jobs: 3, remaining_jobs: [] },
      })
    )
    const { result } = renderHook(() =>
      useSyncSequenceRun({ chain: FAMILY_CAMP_REFRESH_CHAIN, enabled: true })
    )
    expect(result.current.isRunning).toBe(false)
  })

  it('forces polling between the press and the first observed job (the arming gap)', () => {
    const { result } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true })
    )
    expect(syncStatusSpy).toHaveBeenLastCalledWith({ enabled: true, forcePolling: false })
    act(() => result.current.start())
    expect(syncStatusSpy).toHaveBeenLastCalledWith({ enabled: true, forcePolling: true })
    expect(result.current.isRunning).toBe(true)
  })

  it('fires onComplete("success") when the terminal job lands a NEW end_time', () => {
    const onComplete = vi.fn()
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete })
    )
    act(() => result.current.start())

    setStatus(idleStatus({ bunks: { status: 'running', start_time: '2026-04-22T10:00:01.000Z' } }))
    rerender()
    expect(result.current.isRunning).toBe(true)
    expect(onComplete).not.toHaveBeenCalled()

    setStatus(
      idleStatus({
        stranded_assignment_cleanup: { status: 'success', end_time: '2026-04-22T10:00:06.000Z' },
      })
    )
    rerender()
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith('success')
    expect(result.current.isRunning).toBe(false)
  })

  it('does NOT complete in the gap between two chain jobs', () => {
    const onComplete = vi.fn()
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: FAMILY_CAMP_REFRESH_CHAIN, enabled: true, onComplete })
    )
    act(() => result.current.start())

    setStatus(
      idleStatus({ attendees: { status: 'running', start_time: '2026-04-22T10:00:01.000Z' } })
    )
    rerender()
    expect(result.current.isRunning).toBe(true)

    // attendees finished; persons has not been marked running yet. The terminal
    // job's end_time is UNCHANGED, so the run is not over.
    setStatus(
      idleStatus({ attendees: { status: 'success', end_time: '2026-04-22T10:00:04.000Z' } })
    )
    rerender()
    expect(onComplete).not.toHaveBeenCalled()
    expect(result.current.isRunning).toBe(true)
  })

  it('fires onComplete("failed") when the chain aborts mid-way', () => {
    const onComplete = vi.fn()
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: FAMILY_CAMP_REFRESH_CHAIN, enabled: true, onComplete })
    )
    act(() => result.current.start())

    setStatus(
      idleStatus({ persons: { status: 'running', start_time: '2026-04-22T10:00:04.000Z' } })
    )
    rerender()
    setStatus(
      idleStatus({
        persons: { status: 'failed', end_time: '2026-04-22T10:00:09.000Z', error: 'boom' },
      })
    )
    rerender()

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith('failed')
    expect(result.current.isRunning).toBe(false)
  })

  it('completes even if every poll missed the run (a 4.7 s chain against a 3 s poll)', () => {
    const onComplete = vi.fn()
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete })
    )
    act(() => result.current.start())
    // No poll ever caught a running job; the first one back shows the terminal
    // job already finished with a new end_time.
    setStatus(
      idleStatus({
        stranded_assignment_cleanup: { status: 'success', end_time: '2026-04-22T10:00:05.000Z' },
      })
    )
    rerender()
    expect(onComplete).toHaveBeenCalledWith('success')
  })

  it('gives up arming, silently, if nothing ever starts', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete })
    )
    act(() => result.current.start())
    expect(result.current.isRunning).toBe(true)
    act(() => {
      vi.advanceTimersByTime(120_000)
    })
    expect(result.current.isRunning).toBe(false)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('abandon() drops the run without announcing anything', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete })
    )
    act(() => result.current.start())
    act(() => result.current.abandon())
    expect(result.current.isRunning).toBe(false)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('estimates the remaining time from the measured per-job durations', () => {
    // person_custom_values_family_camp (536.7 s) has been running 60 s. What is
    // left is the rest of it plus household_custom_values (242.7) +
    // family_camp_derived (5.7) + lodging_assignments (1.8).
    setStatus(
      idleStatus({
        person_custom_values_family_camp: {
          status: 'running',
          start_time: '2026-04-22T09:59:00.000Z',
        },
      })
    )
    const { result } = renderHook(() =>
      useSyncSequenceRun({ chain: FAMILY_CAMP_REFRESH_CHAIN, enabled: true })
    )
    const expected = 536.7 - 60 + 242.7 + 5.7 + 1.8
    expect(result.current.remainingSeconds).toBeCloseTo(expected, 1)
    expect(result.current.progress).toBeGreaterThan(0)
    expect(result.current.progress).toBeLessThan(1)
  })

  it('never reads the status endpoint while auth is still resolving', () => {
    renderHook(() => useSyncSequenceRun({ chain: FAMILY_CAMP_REFRESH_CHAIN, enabled: false }))
    expect(syncStatusSpy).toHaveBeenLastCalledWith({ enabled: false, forcePolling: false })
  })
})
