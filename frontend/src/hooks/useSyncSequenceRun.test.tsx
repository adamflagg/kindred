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

const syncStatusSpy = vi.fn(
  (_opts?: unknown): { data: SyncStatusResponse | null | undefined; dataUpdatedAt: number } => ({
    data: undefined,
    dataUpdatedAt: 0,
  })
)
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

/**
 * A monotonic stand-in for React Query's `dataUpdatedAt`: it advances on every
 * simulated FETCH (every call to `setStatus`), never on a re-render that
 * merely reads the same cached mock return. That is the real semantics too —
 * verified against the installed `@tanstack/query-core` (5.101.4):
 * `Query#setData` unconditionally dispatches a `'success'` action that stamps
 * a fresh `dataUpdatedAt`, on every resolved fetch, regardless of whether the
 * data it carries is structurally identical to what came before. `start()`
 * relies on exactly that to tell a genuinely post-press response apart from
 * the stale cache it can no longer trust (kindred#2595).
 */
let statusVersion = 0
function setStatus(status: SyncStatusResponse | null | undefined) {
  statusVersion += 1
  syncStatusSpy.mockImplementation(() => ({ data: status, dataUpdatedAt: statusVersion }))
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
    statusVersion = 0
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

  /**
   * A 4.7 s chain against a 3 s poll: no poll ever catches a chain job
   * actually running. Reshaped for kindred#2595 — under the freshness rule
   * the FIRST reading after `start()` is always trusted as the baseline, on
   * pain of being unable to tell a stale cache from a fast chain (see the
   * test above and the module docstring's "Why the naive fix does not work").
   * So a chain that finishes before that first post-press response is, by
   * construction, undetectable — that response IS the new baseline, not a
   * completion. What this test now proves is the case that IS detectable:
   * the chain finishes between the (unmoved) first post-press response and
   * the next poll 3 s later, which is what production actually gives it —
   * `start()`'s own invalidation resolves in well under a second, long before
   * a 4.7 s chain can finish.
   */
  it('completes once a later poll catches the chain done, even though the first post-press response missed it entirely (a 4.7 s chain against a 3 s poll)', () => {
    const onComplete = vi.fn()
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete })
    )
    act(() => result.current.start())

    // The invalidation's own refetch lands first, in the arming gap: no chain
    // job has been observed running, and the terminal end_time has not moved.
    // This is what confirms the baseline as genuinely post-press.
    setStatus(idleStatus())
    rerender()
    expect(onComplete).not.toHaveBeenCalled()

    // The chain runs and finishes entirely between this poll and the last one
    // — no poll ever caught a job running — but the baseline is now trusted,
    // so the moved end_time alone is enough.
    setStatus(
      idleStatus({
        stranded_assignment_cleanup: { status: 'success', end_time: '2026-04-22T10:00:05.000Z' },
      })
    )
    rerender()
    expect(onComplete).toHaveBeenCalledWith('success')
  })

  /**
   * kindred#2595. `start()` cannot snapshot the baseline from the CACHED
   * payload: polling stops entirely while the hook is at rest, so the cache
   * can be arbitrarily old. If an unrelated run moved the terminal job's
   * `end_time` during that idle window, the stale cache never saw it — so the
   * refetch `start()` triggers reveals a value that differs from whatever was
   * cached at press time, even though OUR chain has not been observed running
   * at all yet. That must not read as our chain completing.
   *
   * The naive fix — capture the baseline from the first response after
   * `start()` instead of the cache — is not sufficient by itself: this test
   * and the reshaped "misses every poll" test above are what a fetched
   * baseline gets on ITS first read too, and they must not be told apart by
   * data alone. What tells them apart is that a still-arming run has no
   * grounds YET to call anything "moved" — the first post-press reading is
   * always trusted as the new baseline, never compared against the old one.
   */
  it('does not report success from a stale cached baseline when an unrelated run moved the terminal end_time while idle', () => {
    const onComplete = vi.fn()
    // Mounted at rest: the cache holds the DEFAULT idle status from
    // `beforeEach`, terminal end_time 09:00:05 — nothing has polled since, so
    // this is what `start()` would see if it read the cache.
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete })
    )
    act(() => result.current.start())

    // The invalidation's refetch resolves. It reveals a DIFFERENT terminal
    // end_time — but this is an unrelated run that finished before the press,
    // not our chain: no chain job has ever been observed running.
    setStatus(
      idleStatus({
        stranded_assignment_cleanup: { status: 'success', end_time: '2026-04-22T09:59:50.000Z' },
      })
    )
    rerender()
    expect(onComplete).not.toHaveBeenCalled()
    expect(result.current.isRunning).toBe(true)

    // A further poll shows nothing has changed since — our own chain has
    // neither started nor finished.
    setStatus(
      idleStatus({
        stranded_assignment_cleanup: { status: 'success', end_time: '2026-04-22T09:59:50.000Z' },
      })
    )
    rerender()
    expect(onComplete).not.toHaveBeenCalled()
    expect(result.current.isRunning).toBe(true)
  })

  /**
   * The press can land before the FIRST status response — a cold load, or a
   * press inside the first poll interval. `start()` then has nothing to
   * snapshot, so the baseline stays uncaptured. Nothing downstream captured it
   * either: the `phase === 'idle'` branch is skipped (phase is `arming`) and
   * the `isActive` branch only moved the phase. `terminalMoved` could then
   * never become true, so a perfectly successful chain ended in a silent stall
   * timeout with no invalidation — the exact staleness kindred#2587 is about.
   */
  it('still completes when the press lands before the first status response', () => {
    const onComplete = vi.fn()
    setStatus(undefined)
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete })
    )
    act(() => result.current.start())

    setStatus(idleStatus({ bunks: { status: 'running', start_time: '2026-04-22T10:00:01.000Z' } }))
    rerender()
    expect(result.current.isRunning).toBe(true)

    setStatus(
      idleStatus({
        stranded_assignment_cleanup: { status: 'success', end_time: '2026-04-22T10:00:06.000Z' },
      })
    )
    rerender()
    expect(onComplete).toHaveBeenCalledTimes(1)
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

  /**
   * The readout has to advance on its own, because NOTHING ELSE MOVES.
   *
   * `person_custom_values_family_camp` runs 536.7 s and its status payload is
   * byte-identical for the whole of it — `Status.Summary` is written only at
   * completion (pocketbase/sync/orchestrator.go), so `status`, `start_time` and
   * every other field are fixed while it runs. React Query's structural sharing
   * then hands the observer the SAME `data` reference on every poll, and an
   * observer that tracks only `data` is not notified. Measured with a real
   * QueryClient: 15 identical polls produced ZERO additional renders.
   *
   * So a `remainingSeconds` computed only during render does not merely sit
   * still for nine minutes — it sits on the value it had when the job STARTED,
   * i.e. "about 14 min left" at the point four minutes actually remain.
   */
  it('advances the remaining-time estimate while the status payload is unchanged', () => {
    setStatus(
      idleStatus({
        person_custom_values_family_camp: {
          status: 'running',
          start_time: '2026-04-22T10:00:00.000Z',
        },
      })
    )
    const { result } = renderHook(() =>
      useSyncSequenceRun({ chain: FAMILY_CAMP_REFRESH_CHAIN, enabled: true })
    )
    const atStart = result.current.remainingSeconds

    // Two minutes pass. The server says exactly what it said before.
    act(() => {
      vi.advanceTimersByTime(120_000)
    })

    expect(result.current.remainingSeconds).toBeLessThan(atStart - 100)
    expect(result.current.progress).toBeGreaterThan(0)
  })

  it('never reads the status endpoint while auth is still resolving', () => {
    renderHook(() => useSyncSequenceRun({ chain: FAMILY_CAMP_REFRESH_CHAIN, enabled: false }))
    expect(syncStatusSpy).toHaveBeenLastCalledWith({ enabled: false, forcePolling: false })
  })
})
