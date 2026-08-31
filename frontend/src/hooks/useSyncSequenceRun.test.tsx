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
import { renderHook, act, type RenderHookResult } from '@testing-library/react'
import type { SyncStatusResponse } from './useSyncStatusAPI'

const syncStatusSpy = vi.fn((_opts?: unknown): { data: SyncStatusResponse | null | undefined } => ({
  data: undefined,
}))
vi.mock('./useSyncStatusAPI', () => ({
  useSyncStatusAPI: (...args: unknown[]) => syncStatusSpy(...args),
}))

/**
 * The ONE React Query cache entry `start()` now drives the baseline off —
 * `['sync-status']` — modelled just far enough to exercise it (kindred#2599).
 *
 * `invalidateQueries()` returns a promise that resolves when the refetch it
 * triggered has settled, so the hook no longer has to reconstruct "a reading
 * that post-dates the press has landed" from `dataUpdatedAt`. What it reads
 * back afterwards is the CACHE, not the render — hence this fake, which keeps
 * `dataUpdateCount` (the proof a fetch actually happened) and `data` moving
 * together the way `Query#setData` does.
 */
let cache: { data: SyncStatusResponse | null | undefined; dataUpdateCount: number } = {
  data: undefined,
  dataUpdateCount: 0,
}
/** What the next simulated FETCH would return — the server's current answer. */
let served: SyncStatusResponse | null | undefined
/**
 * Whether an invalidation reaches the network at all. `invalidateQueries` hands
 * its filters to `refetchQueries`, which defaults to `type: 'active'`: with no
 * ACTIVE observer it matches nothing, resolves immediately, and leaves the
 * cache exactly as stale as it was. Set false to exercise that.
 */
let invalidationRefetches = true
/** Hold the invalidation open, so a test can act between the press and it. */
let holdInvalidation = false
let releaseInvalidation: () => void = () => {}
/**
 * Hold the CANCEL open, so a test can act inside the window a SECOND press
 * opens: its synchronous re-arm has already cleared the baseline, but its own
 * reading has not landed yet. An earlier press's invalidation resolving in
 * exactly that window is what the run token exists to refuse.
 */
let holdCancel = false
let releaseCancel: () => void = () => {}

/**
 * One resolved fetch: the cache entry and what the hook RENDERS move together,
 * which is what `Query#setData` plus the observer notification amount to.
 * Nothing else may move them — a payload that only the server knows about is
 * `serveOnly`.
 */
function landFetch(status: SyncStatusResponse | null | undefined) {
  cache = { data: status, dataUpdateCount: cache.dataUpdateCount + 1 }
  syncStatusSpy.mockImplementation(() => ({ data: status }))
}

const cancelQueries = vi.fn(() => {
  if (!holdCancel) return Promise.resolve()
  return new Promise<void>((resolve) => {
    releaseCancel = resolve
  })
})
const invalidateQueries = vi.fn(() => {
  if (invalidationRefetches) landFetch(served)
  if (holdInvalidation) {
    return new Promise<void>((resolve) => {
      releaseInvalidation = resolve
    })
  }
  return Promise.resolve()
})
const getQueryState = vi.fn(() => cache)
vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useQueryClient: () => ({ cancelQueries, invalidateQueries, getQueryState }),
  }
})

import {
  useSyncSequenceRun,
  FAMILY_CAMP_REFRESH_CHAIN,
  BUNKING_REFRESH_CHAIN,
  type SyncSequenceRun,
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
 * A poll landing: the cache and what the hook renders move together, which is
 * what one resolved fetch does in production.
 */
function setStatus(status: SyncStatusResponse | null | undefined) {
  served = status
  landFetch(status)
}

/**
 * The server's answer changes with NO poll to carry it — polling stops
 * entirely while the hook is at rest, so this is what an idle window looks
 * like from the client (kindred#2595). Only a genuinely new fetch can see it.
 */
function serveOnly(status: SyncStatusResponse | null | undefined) {
  served = status
}

/** The press. `start()` is async, so its baseline capture has to be flushed. */
async function press(result: RenderHookResult<SyncSequenceRun, unknown>['result']) {
  await act(async () => {
    await result.current.start()
  })
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
    cache = { data: undefined, dataUpdateCount: 0 }
    invalidationRefetches = true
    holdInvalidation = false
    holdCancel = false
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

  /**
   * The force is asked for over the WHOLE run, not just the arming gap. The
   * behaviour that buys is pinned end-to-end against a real query client in
   * `useSyncSequenceRun.integration.test.tsx` ("keeps polling across the gap
   * between two chain jobs"); this is the prop-level statement of it.
   */
  it('forces polling for the whole run — the arming gap and the gaps between jobs alike', async () => {
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true })
    )
    expect(syncStatusSpy).toHaveBeenLastCalledWith({ enabled: true, forcePolling: false })

    // The arming gap: the POST has returned, no job is marked running yet.
    await press(result)
    expect(syncStatusSpy).toHaveBeenLastCalledWith({ enabled: true, forcePolling: true })
    expect(result.current.isRunning).toBe(true)

    // A chain job is running. The payload would keep polling on its own here.
    setStatus(idleStatus({ bunks: { status: 'running', start_time: '2026-04-22T10:00:01.000Z' } }))
    rerender()
    expect(syncStatusSpy).toHaveBeenLastCalledWith({ enabled: true, forcePolling: true })

    // ...and here it would NOT. `bunks` is done, `bunk_plans` has not been
    // marked running yet, and a `RunSyncSequence` sets no run-type flag and
    // takes no queue entry — so nothing in the payload reports a chain in
    // flight, and a poll landing in this gap would stop the polling dead.
    setStatus(idleStatus({ bunks: { status: 'success', end_time: '2026-04-22T10:00:02.000Z' } }))
    rerender()
    expect(syncStatusSpy).toHaveBeenLastCalledWith({ enabled: true, forcePolling: true })
    expect(result.current.isRunning).toBe(true)
  })

  it('fires onComplete("success") when the terminal job lands a NEW end_time', async () => {
    const onComplete = vi.fn()
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete })
    )
    await press(result)

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

  it('does NOT complete in the gap between two chain jobs', async () => {
    const onComplete = vi.fn()
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: FAMILY_CAMP_REFRESH_CHAIN, enabled: true, onComplete })
    )
    await press(result)

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

  it('fires onComplete("failed") when the chain aborts mid-way', async () => {
    const onComplete = vi.fn()
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: FAMILY_CAMP_REFRESH_CHAIN, enabled: true, onComplete })
    )
    await press(result)

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
   * actually running. The FIRST reading after the press — the one `start()`'s
   * own invalidation waits for — is always trusted as the baseline, on pain of
   * being unable to tell a stale cache from a fast chain (see the test below
   * and kindred#2595). So a chain that finishes before that reading is, by
   * construction, undetectable: that reading IS the new baseline, not a
   * completion. What this pins is the case that IS detectable — the chain
   * finishes between the (unmoved) post-press reading and the next poll 3 s
   * later, which is what production actually gives it, since `start()`'s own
   * refetch resolves in well under a second.
   */
  it('completes once a later poll catches the chain done, even though the first post-press response missed it entirely (a 4.7 s chain against a 3 s poll)', async () => {
    const onComplete = vi.fn()
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete })
    )
    // The press. Its own invalidation refetches and settles in the arming gap:
    // no chain job has been observed running, and the terminal end_time has
    // not moved. That reading is the baseline.
    await press(result)
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
   * `end_time` during that idle window, the refetch `start()` awaits reveals a
   * value that differs from whatever was cached at press time, even though OUR
   * chain has not been observed running at all yet. That must not read as our
   * chain completing.
   *
   * What stops it is that the first post-press reading is TRUSTED AS THE
   * BASELINE and never compared against the pre-press cache: a still-arming
   * run has no grounds YET to call anything "moved". The two readings this
   * test and the one above get are identical on the data, and they must not be
   * told apart by it.
   */
  it('does not report success from a stale cached baseline when an unrelated run moved the terminal end_time while idle', async () => {
    const onComplete = vi.fn()
    // Mounted at rest: the cache holds the DEFAULT idle status from
    // `beforeEach`, terminal end_time 09:00:05 — nothing has polled since.
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete })
    )

    // An unrelated run finished while the page sat idle. No poll carried it.
    const moved = idleStatus({
      stranded_assignment_cleanup: { status: 'success', end_time: '2026-04-22T09:59:50.000Z' },
    })
    serveOnly(moved)

    // The press. Its invalidation's refetch reveals the DIFFERENT terminal
    // end_time — but this is an unrelated run that finished before the press,
    // not our chain: no chain job has ever been observed running.
    await press(result)
    expect(onComplete).not.toHaveBeenCalled()
    expect(result.current.isRunning).toBe(true)

    // A further poll shows nothing has changed since — our own chain has
    // neither started nor finished.
    setStatus(moved)
    rerender()
    expect(onComplete).not.toHaveBeenCalled()
    expect(result.current.isRunning).toBe(true)

    // ...and it does not sit armed for ever either. This is the OTHER reading
    // of the same payload — CodeRabbit read it on #2596 as "our own chain
    // finished before the first post-press response, so completion is now
    // lost" — and the two are not separable on the data (see the docstring
    // above). What IS guaranteed either way is that the run is BOUNDED: the
    // arming timeout retires it silently rather than leaving a spinner and a
    // disabled button standing for ever.
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current.isRunning).toBe(false)
    expect(onComplete).not.toHaveBeenCalled()
  })

  /**
   * kindred#2599, hazard 1 — the one a naive port of this to
   * `invalidateQueries`' promise walks straight into.
   *
   * `invalidateQueries` hands its filters to `refetchQueries`, which defaults
   * to `type: 'active'`. With no ACTIVE observer for `['sync-status']` — the
   * hook's own read disabled while auth resolves, or no cache entry at all —
   * it matches nothing, resolves IMMEDIATELY, and has fetched nothing. Reading
   * the cache back at that point hands over the arbitrarily old payload
   * kindred#2595 is about, with no signal at all that it is old.
   *
   * `dataUpdateCount` is the proof that a fetch actually landed. Without that
   * check this test reports success off a baseline the press never refreshed:
   * the unrelated run's move is still invisible to the cache, so it arrives on
   * the next poll and reads as our chain finishing.
   */
  it('does not trust the cache when the invalidation resolves without fetching anything', async () => {
    const onComplete = vi.fn()
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete })
    )

    // Nothing is watching `['sync-status']`, so the invalidation is a no-op.
    invalidationRefetches = false
    // ...and an unrelated run moved the terminal end_time while we were idle,
    // which the cache the press is about to read has never seen.
    const moved = idleStatus({
      stranded_assignment_cleanup: { status: 'success', end_time: '2026-04-22T09:59:50.000Z' },
    })
    serveOnly(moved)

    await press(result)
    expect(onComplete).not.toHaveBeenCalled()

    // Polling resumes and the move finally arrives. With no trustworthy
    // baseline there are no grounds to call it ours.
    setStatus(moved)
    rerender()
    expect(onComplete).not.toHaveBeenCalled()
    expect(result.current.isRunning).toBe(true)

    // Still bounded: an armed run that never sees its chain retires silently.
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current.isRunning).toBe(false)
    expect(onComplete).not.toHaveBeenCalled()
  })

  /**
   * kindred#2599, hazard 2 — the ORDER, pinned here; the behaviour it buys is
   * pinned against a real cache in `useSyncSequenceRun.integration.test.tsx`
   * ("does not adopt a baseline from a poll that was already in flight").
   *
   * `Query#fetch` hands back the EXISTING retryer promise when a fetch is
   * already running and the cache holds no data — `cancelRefetch` can only
   * cancel a refetch that has something to revert to. The awaited invalidation
   * would then resolve with a payload the server decided BEFORE the press.
   */
  it('cancels an in-flight fetch before invalidating, so the reading it waits for is post-press', async () => {
    const { result } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true })
    )
    await press(result)

    expect(cancelQueries).toHaveBeenCalledWith({ queryKey: ['sync-status'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sync-status'] })
    expect(cancelQueries.mock.invocationCallOrder[0]!).toBeLessThan(
      invalidateQueries.mock.invocationCallOrder[0]!
    )
  })

  /**
   * kindred#2595 follow-up, found reviewing #2596. `useSyncStatusAPI`'s queryFn
   * SWALLOWS a 401 and returns `null` (pb.afterSend has already cleared auth),
   * and React Query treats that as a perfectly successful fetch: `setData`
   * dispatches `'success'` and bumps `dataUpdateCount` like any other. So a
   * payload-less reading satisfies the "a fetch actually landed" guard while
   * carrying no terminal `end_time` at all — `jobStatus(null, …)` is
   * undefined, so the baseline would be captured as `null`. Every later
   * reading that DOES carry data then differs from `null`, and reads as our
   * chain completing.
   *
   * A reading that post-dates the press is not the same thing as a reading
   * that SAYS anything, and the promise shape inherits that distinction
   * unchanged.
   */
  it('does not take a payload-less (401) reading as the baseline', async () => {
    const onComplete = vi.fn()
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete })
    )

    // The invalidation's own refetch 401s: a resolved fetch, and no payload.
    serveOnly(null)
    await press(result)
    expect(onComplete).not.toHaveBeenCalled()

    // Auth catches up (useSyncStatusAPI invalidates on the invalid→valid
    // transition) and the next reading carries a real payload — byte-identical
    // to the one cached before the press. Nothing has moved.
    setStatus(idleStatus())
    rerender()
    expect(onComplete).not.toHaveBeenCalled()
    expect(result.current.isRunning).toBe(true)
  })

  /**
   * The same 401 the other way round, and the reason the guard is in BOTH
   * places. Once a baseline is captured, a payload-less reading has no terminal
   * `end_time` to offer — `jobStatus(null, …)` is undefined — so comparing
   * against it reads every string baseline as having moved to nothing, i.e. as
   * our chain completing, when in fact nothing has been heard at all.
   */
  it('does not read a payload-less (401) poll as the chain completing', async () => {
    const onComplete = vi.fn()
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete })
    )
    await press(result)

    setStatus(idleStatus({ bunks: { status: 'running', start_time: '2026-04-22T10:00:01.000Z' } }))
    rerender()
    expect(result.current.isRunning).toBe(true)

    // Auth lapses mid-chain. Nothing landed, and nothing may be announced.
    setStatus(null)
    rerender()
    expect(onComplete).not.toHaveBeenCalled()
    expect(result.current.isRunning).toBe(true)
  })

  /**
   * The press can land before the FIRST status response — a cold load, or a
   * press inside the first poll interval. The refetch `start()` awaits then
   * resolves carrying nothing, so the baseline stays uncaptured. Nothing
   * downstream captured it either: the `phase === 'idle'` branch is skipped
   * (phase is `arming`) and the `isActive` branch only moved the phase.
   * `terminalMoved` could then never become true, so a perfectly successful
   * chain ended in a silent stall timeout with no invalidation — the exact
   * staleness kindred#2587 is about.
   */
  it('still completes when the press lands before the first status response', async () => {
    const onComplete = vi.fn()
    setStatus(undefined)
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete })
    )
    await press(result)

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

  /**
   * Pinned to ARMING_TIMEOUT_MS EXACTLY (60 s), not merely to "eventually".
   * Advancing past STALL_TIMEOUT_MS (120 s) instead would pass just as well
   * with the `phase === 'arming' ? … : …` branch deleted — and a real press
   * would then sit spinning for two minutes rather than one. The arming
   * timeout is the user-visible exit for an armed run that never sees its
   * chain, so the constant is load-bearing.
   */
  it('gives up arming, silently, at 60 s if nothing ever starts', async () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete })
    )
    await press(result)
    expect(result.current.isRunning).toBe(true)

    act(() => {
      vi.advanceTimersByTime(59_999)
    })
    expect(result.current.isRunning).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.isRunning).toBe(false)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('abandon() drops the run without announcing anything', async () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete })
    )
    await press(result)
    act(() => result.current.abandon())
    expect(result.current.isRunning).toBe(false)
    expect(onComplete).not.toHaveBeenCalled()
  })

  /**
   * The end-to-end statement about `abandon()`: a press abandoned before its
   * invalidation resolves announces NOTHING, however late that promise lands.
   *
   * ⚠️ This does NOT pin the run-token guard, and did not when it was named as
   * if it did. With `runTokenRef` deleted the stale continuation still reaches
   * `captureBaseline` and still writes a baseline here — but `abandon()` has
   * put the phase back to `idle`, and the `phase === 'idle'` branch of the
   * state machine never reads a baseline; it only ever overwrites one when a
   * chain job is seen running. So `isRunning === false` and a silent
   * `onComplete` hold either way. What makes the write observable is a SECOND
   * press inheriting it, which is the sibling test below.
   */
  it('announces nothing when a press is abandoned before its invalidation resolves', async () => {
    const onComplete = vi.fn()
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete })
    )

    // Hold the invalidation open, abandon the run, then let it resolve.
    holdInvalidation = true
    let pressed: Promise<void> = Promise.resolve()
    await act(async () => {
      pressed = result.current.start()
      // Let `cancelQueries` settle so the held invalidation is actually entered.
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => result.current.abandon())
    await act(async () => {
      releaseInvalidation()
      await pressed
    })
    expect(result.current.isRunning).toBe(false)

    // A poll now moves the terminal end_time. Nothing is armed, so nothing
    // may be announced.
    setStatus(
      idleStatus({
        stranded_assignment_cleanup: { status: 'success', end_time: '2026-04-22T10:00:06.000Z' },
      })
    )
    rerender()
    expect(onComplete).not.toHaveBeenCalled()
  })

  /**
   * The run token, pinned — a SECOND press racing a first that is still
   * pending. This is the case its own docstring names ("an `abandon()`, a
   * cutover or a second press in between"), and the only one of the three in
   * which the stale write is observable.
   *
   * `abandon()` re-enables the button the moment a POST fails, so a second
   * press can land while the first press's invalidation is still in flight.
   * Press #2 clears the baseline synchronously; if press #1's continuation
   * then resolves before press #2's own reading has landed, it finds the
   * baseline `undefined` and WINS the never-overwrite race in `captureBaseline`
   * — with a reading taken before press #2 existed. Press #2's own reading is
   * then discarded as a no-op.
   *
   * The damage is kindred#2595 reintroduced: an unrelated run that moved the
   * terminal `end_time` between the two presses is invisible to the baseline
   * run #2 is left holding, so run #2 announces success on its first poll,
   * before its chain has done anything.
   */
  it('does not let a still-pending press supply the baseline for the press that replaced it', async () => {
    const onComplete = vi.fn()
    const { result, rerender } = renderHook(() =>
      useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete })
    )

    // PRESS #1. Its invalidation refetches — a reading byte-identical to the
    // cached one, terminal end_time 09:00:05 — but the promise is held open,
    // so `start()` has not reached its capture.
    holdInvalidation = true
    let firstPress: Promise<void> = Promise.resolve()
    await act(async () => {
      firstPress = result.current.start()
      // Let `cancelQueries` settle so the held invalidation is actually entered.
      await Promise.resolve()
      await Promise.resolve()
    })

    // The POST failed. `abandon()` re-enables the button — which is what makes
    // a second press possible while the first is still in flight.
    act(() => result.current.abandon())
    expect(result.current.isRunning).toBe(false)

    // An unrelated run finishes while the operator reaches for the button
    // again. No poll carried it; only a new fetch can see it.
    const moved = idleStatus({
      stranded_assignment_cleanup: { status: 'success', end_time: '2026-04-22T09:59:50.000Z' },
    })
    serveOnly(moved)

    // PRESS #2, with press #1's invalidation resolving INSIDE it: after the
    // synchronous re-arm has cleared the baseline, before press #2's own
    // reading has landed. Holding the cancel is what pins that ordering.
    holdInvalidation = false
    holdCancel = true
    let secondPress: Promise<void> = Promise.resolve()
    await act(async () => {
      secondPress = result.current.start()
      releaseInvalidation()
      await firstPress
      releaseCancel()
      await secondPress
    })

    // Press #2's own reading is the only one that may be the baseline, and it
    // already carries the unrelated run's end_time. Nothing has moved since,
    // so run #2 is still arming — not complete.
    rerender()
    expect(onComplete).not.toHaveBeenCalled()
    expect(result.current.isRunning).toBe(true)
  })

  /**
   * 🚨 THE CROSS-WEEKEND PIN (kindred#2601).
   *
   * `Refresh Housing` used to cover every family-camp weekend, so a job NAME was a
   * sufficient identity and the mid-run pickup below deliberately arms on "a
   * reload, a navigation, or a weekend switch". Scoping the press turned that
   * intent into a defect: press on weekend A, walk to weekend B, and B armed on
   * A's run — showing "Refreshing housing", then firing B's success toast and
   * cache invalidation for a run that never touched B.
   *
   * The run now says which weekend it is for, and a weekend only arms on its own.
   */
  it('does NOT arm on a run scoped to a different weekend', () => {
    setStatus(
      idleStatus({
        person_custom_values_family_camp: {
          status: 'running',
          start_time: '2026-04-22T09:59:00.000Z',
          session: '1001',
        },
      })
    )
    const { result } = renderHook(() =>
      useSyncSequenceRun({ chain: FAMILY_CAMP_REFRESH_CHAIN, enabled: true, session: '900' })
    )
    expect(result.current.isRunning).toBe(false)
  })

  it('DOES arm on a run scoped to this weekend', () => {
    setStatus(
      idleStatus({
        person_custom_values_family_camp: {
          status: 'running',
          start_time: '2026-04-22T09:59:00.000Z',
          session: '900',
        },
      })
    )
    const { result } = renderHook(() =>
      useSyncSequenceRun({ chain: FAMILY_CAMP_REFRESH_CHAIN, enabled: true, session: '900' })
    )
    expect(result.current.isRunning).toBe(true)
  })

  /**
   * An UNSCOPED run genuinely covers every weekend — that is the nightly cron —
   * so an absent session must read as "matches everybody". Getting this backwards
   * would silently stop the cron from driving any weekend's readout, which is a
   * quieter regression than the one above and would outlive it.
   */
  it('arms on an UNSCOPED run, because the nightly pass covers every weekend', () => {
    setStatus(
      idleStatus({
        person_custom_values_family_camp: {
          status: 'running',
          start_time: '2026-04-22T09:59:00.000Z',
        },
      })
    )
    const { result } = renderHook(() =>
      useSyncSequenceRun({ chain: FAMILY_CAMP_REFRESH_CHAIN, enabled: true, session: '900' })
    )
    expect(result.current.isRunning).toBe(true)
  })

  it('estimates the remaining time from the measured per-job durations', () => {
    // person_custom_values_family_camp has been running 60 s. What is left is
    // the rest of it plus household_custom_values + family_camp_derived +
    // lodging_assignments.
    //
    // Built from the chain BY NAME rather than from literals: the per-job
    // seconds are measurement data that moves when the cohort does (they were
    // rescaled for one weekend in kindred#2601), while the arithmetic under
    // test — "the rest of the running job, plus every job after it" — is the
    // part that must not. Hardcoding the durations pinned the data and let the
    // rescale read as a behaviour regression.
    const secondsFor = (service: string) => {
      const job = FAMILY_CAMP_REFRESH_CHAIN.find((j) => j.service === service)
      if (job === undefined) throw new Error(`no such job in the chain: ${service}`)
      return job.seconds
    }

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
    const expected =
      secondsFor('person_custom_values_family_camp') -
      60 +
      secondsFor('household_custom_values_family_camp') +
      secondsFor('family_camp_derived') +
      secondsFor('lodging_assignments')
    expect(result.current.remainingSeconds).toBeCloseTo(expected, 1)
    expect(result.current.progress).toBeGreaterThan(0)
    expect(result.current.progress).toBeLessThan(1)
  })

  /**
   * The readout has to advance on its own, because NOTHING ELSE MOVES.
   *
   * `person_custom_values_family_camp` runs for minutes and its status payload is
   * byte-identical for the whole of it — `Status.Summary` is written only at
   * completion (pocketbase/sync/orchestrator.go), so `status`, `start_time` and
   * every other field are fixed while it runs. React Query's structural sharing
   * then hands the observer the SAME `data` reference on every poll, and an
   * observer that tracks only `data` is not notified: measured against
   * query-core 5.101.4, 15 identical refetches 3 s apart re-rendered a
   * `const { data }` observer exactly ONCE.
   *
   * So a `remainingSeconds` computed only during render does not merely sit
   * still for nine minutes — it sits on the value it had when the job STARTED,
   * i.e. "about 14 min left" at the point four minutes actually remain.
   *
   * That measurement is true of this hook again since kindred#2599: the
   * baseline no longer comes from `dataUpdatedAt`, so nothing puts that key
   * into the observer's tracked props and an identical poll notifies nobody.
   * The tick is once more the ONLY thing that moves the readout — which is
   * what this test pins, with the query layer mocked out entirely.
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
