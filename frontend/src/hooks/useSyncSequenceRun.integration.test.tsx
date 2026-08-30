/**
 * `useSyncSequenceRun` against a REAL React Query cache.
 *
 * Every other test of this hook mocks `useSyncStatusAPI` (and the query client
 * under it) outright, which means the thing the completion gate actually rests
 * on has never been exercised: that `invalidateQueries()`' own promise resolves
 * only once the refetch it triggered has SETTLED, and that the cache it leaves
 * behind therefore holds a reading which post-dates the press — even when that
 * reading is byte-identical to the one already there, which is the normal case
 * during the arming gap and the one `data` alone could never have carried.
 *
 * That rests on library behaviour that is not ours (`refetchQueries` returns
 * `Promise.all` of the refetches; `Query#setData` bumps `dataUpdateCount` on
 * every resolved fetch whatever the payload, query-core 5.101.4), and on the
 * two ways that promise can lie — see kindred#2599's hazards. If any of it
 * stopped holding, every mocked suite would stay green, because they all model
 * the cache by hand. This one does not.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'

vi.mock('../lib/pocketbase', () => ({
  pb: {
    send: vi.fn(),
    authStore: {
      get isValid() {
        return true
      },
      onChange: () => () => {},
    },
  },
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}))

import { pb } from '../lib/pocketbase'
import { useAuth } from '../contexts/AuthContext'
import { useSyncSequenceRun, BUNKING_REFRESH_CHAIN } from './useSyncSequenceRun'
import { queryKeys } from '../utils/queryKeys'

const CLEANUP_BASELINE = '2026-04-22T09:00:05.000Z'

/** A fresh object every call — structural sharing is what collapses it. */
function idlePayload(terminalEndTime = CLEANUP_BASELINE) {
  return {
    bunks: { status: 'success', end_time: '2026-04-22T09:00:01.000Z' },
    bunk_plans: { status: 'success', end_time: '2026-04-22T09:00:02.000Z' },
    bunk_assignments: { status: 'success', end_time: '2026-04-22T09:00:03.000Z' },
    stranded_assignment_cleanup: { status: 'success', end_time: terminalEndTime },
  }
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
}

describe('useSyncSequenceRun against a real QueryClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(useAuth as Mock).mockReturnValue({ isLoading: false, user: { id: 'u1' } })
  })

  it('captures the baseline from a refetch whose payload is byte-identical, and still detects the cutover', async () => {
    let terminal = CLEANUP_BASELINE
    // A couple of milliseconds of "network", so nothing here can resolve
    // synchronously and hide an ordering mistake.
    ;(pb.send as Mock).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 2))
      return idlePayload(terminal)
    })

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const onComplete = vi.fn()
    const { result } = renderHook(
      () => useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete }),
      { wrapper: wrapper(qc) }
    )

    await waitFor(() => expect(pb.send).toHaveBeenCalledTimes(1))

    // The press. `start()` invalidates and AWAITS; the refetch returns a
    // payload IDENTICAL to the one already cached, so `data` keeps its
    // reference and nothing about the rendered result changes. The promise
    // resolving is the whole signal that a post-press reading has landed.
    await act(async () => {
      await result.current.start()
    })
    expect(pb.send).toHaveBeenCalledTimes(2)
    expect(result.current.isRunning).toBe(true)
    expect(onComplete).not.toHaveBeenCalled()

    // The chain runs and finishes. No poll ever caught a job running — the
    // terminal end_time moving is the whole signal, and it is only readable
    // against the baseline the step above must have captured.
    terminal = '2026-04-22T10:00:06.000Z'
    await act(async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.syncStatus() })
    })

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('success'))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  /**
   * kindred#2599, hazard 2 — deduplication onto a fetch that predates the press.
   *
   * `Query#fetch` hands back the EXISTING retryer promise when a fetch is
   * already in flight and `state.data` is still undefined: `cancelRefetch`,
   * which `refetchQueries` passes by default, can only cancel a refetch that
   * has something to revert to. So a press landing while the FIRST status
   * request is outstanding would await a promise that settles with an answer
   * the server decided before the press — and an unrelated run that finished in
   * between is then invisible to the baseline and arrives on the next poll,
   * reading as our chain completing.
   *
   * `start()` cancels first, which makes "the reading I trust was requested
   * after the press" true by construction. Deleting that `cancelQueries` call
   * turns the last assertion here into `onComplete('success')`.
   */
  it('does not adopt a baseline from a poll that was already in flight when the press landed', async () => {
    const MOVED_BY_AN_UNRELATED_RUN = '2026-04-22T09:59:50.000Z'
    let terminal = CLEANUP_BASELINE
    let issued = 0
    let releasePrePressPoll: (() => void) | undefined
    ;(pb.send as Mock).mockImplementation(() => {
      // The server decides its answer when the request goes out. That is what
      // makes an in-flight poll's payload pre-date anything that happens next.
      const answer = idlePayload(terminal)
      issued += 1
      if (issued === 1) {
        return new Promise((resolve) => {
          releasePrePressPoll = () => resolve(answer)
        })
      }
      return Promise.resolve(answer)
    })

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const onComplete = vi.fn()
    const { result } = renderHook(
      () => useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete }),
      { wrapper: wrapper(qc) }
    )

    // The first status request is outstanding: nothing is in the cache yet.
    await waitFor(() => expect(pb.send).toHaveBeenCalledTimes(1))
    expect(qc.getQueryData(queryKeys.syncStatus())).toBeUndefined()

    // An unrelated run finishes while it is still in flight, and that poll
    // answers a moment later carrying the value from BEFORE the move.
    terminal = MOVED_BY_AN_UNRELATED_RUN
    setTimeout(() => releasePrePressPoll?.(), 5)

    await act(async () => {
      await result.current.start()
    })

    // A further poll. Our chain has not started, let alone finished, so the
    // only thing that has "moved" is what the press should already have seen.
    await act(async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.syncStatus() })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(onComplete).not.toHaveBeenCalled()
    expect(result.current.isRunning).toBe(true)
  })

  /**
   * Polling has to survive the GAP BETWEEN TWO CHAIN JOBS.
   *
   * `runSyncAndWait` waits on a 500 ms ticker (pocketbase/sync/orchestrator.go),
   * so up to half a second separates job N finishing from job N+1 starting, and
   * in that window NOTHING in the status payload says anything is happening:
   * `RunSyncSequence` sets no run-type flag ("It carries no run-type flag") and
   * does not go through the sync queue, so `_daily_sync_running`,
   * `_historical_sync_running` and `_queue_length` are all quiet too.
   *
   * `useSyncStatusAPI`'s `refetchInterval` therefore returns `false` for a poll
   * that lands in one — and React Query CLEARS the interval when it does.
   * Nothing restarts it but a window focus, so the rest of the chain then runs
   * unobserved: no cutover, no invalidation, the stall timeout retiring the run
   * in silence 120 s later under a progress bar that has simply vanished. That
   * is exactly the staleness kindred#2587 exists to prevent.
   *
   * Which is why `forcePolling` covers the whole run rather than the arming gap
   * alone. Everywhere a chain job IS published as running it changes nothing —
   * `refetchInterval` already returns 3000 — so the gaps are the entire delta,
   * and the run is still bounded: every exit goes through `reset()`, which puts
   * the phase back to `idle` and drops the force with it. Family Camp is the
   * exposed case at 13½ minutes and five gaps; the 4.7 s bunking chain is
   * nearly immune only because it is over before the second poll.
   *
   * The mocked suites cannot see any of this: they replace `useSyncStatusAPI`
   * outright, so `refetchInterval` never runs. This one drives the real query.
   */
  it('keeps polling across the gap between two chain jobs, so the cutover is still seen', async () => {
    vi.useFakeTimers()
    try {
      let payload: Record<string, unknown> = idlePayload()
      ;(pb.send as Mock).mockImplementation(() => Promise.resolve(payload))

      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const onComplete = vi.fn()
      const { result } = renderHook(
        () => useSyncSequenceRun({ chain: BUNKING_REFRESH_CHAIN, enabled: true, onComplete }),
        { wrapper: wrapper(qc) }
      )

      // The mount's own first read.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(pb.send).toHaveBeenCalledTimes(1)

      await act(async () => {
        await result.current.start()
      })
      expect(result.current.isRunning).toBe(true)

      // The chain's first job is marked running, and a poll catches it.
      payload = {
        ...idlePayload(),
        bunks: { status: 'running', start_time: '2026-04-22T10:00:00.000Z' },
      }
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(result.current.isRunning).toBe(true)

      // THE GAP: `bunks` is done, `bunk_plans` has not been marked running yet,
      // and the terminal end_time has not moved. A poll lands right here.
      payload = {
        ...idlePayload(),
        bunks: { status: 'success', end_time: '2026-04-22T10:00:01.000Z' },
      }
      const beforeGap = (pb.send as Mock).mock.calls.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect((pb.send as Mock).mock.calls.length).toBeGreaterThan(beforeGap)
      expect(onComplete).not.toHaveBeenCalled()
      expect(result.current.isRunning).toBe(true)

      // The rest of the chain runs and the terminal job lands a new end_time.
      // Only a POLL can carry that — which is the whole point.
      const afterGap = (pb.send as Mock).mock.calls.length
      payload = idlePayload('2026-04-22T10:00:06.000Z')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000)
      })
      expect((pb.send as Mock).mock.calls.length).toBeGreaterThan(afterGap)
      expect(onComplete).toHaveBeenCalledWith('success')
      expect(result.current.isRunning).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
