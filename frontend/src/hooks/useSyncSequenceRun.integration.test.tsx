/**
 * `useSyncSequenceRun` against a REAL React Query cache.
 *
 * Every other test of this hook mocks `useSyncStatusAPI` outright, which means
 * the thing the completion gate actually rests on has never been exercised:
 * that a refetch returning a BYTE-IDENTICAL payload still reaches the hook.
 * Two library behaviours have to hold for that, and neither is ours —
 * measured against the installed `@tanstack/query-core` 5.101.4:
 *
 *  1. `Query#setData` stamps a fresh `dataUpdatedAt` on every resolved fetch,
 *     whatever the payload (`successState`: `dataUpdatedAt ?? Date.now()`).
 *  2. Reading `dataUpdatedAt` off the `useQuery` result TRACKS it, so the
 *     observer is notified on that stamp alone. Measured over 15 identical
 *     polls 3 s apart, one observer: `const { data }` re-rendered ONCE,
 *     `const { data, dataUpdatedAt }` re-rendered 15 times.
 *
 * If either stopped holding, the mocked suites would stay green while the
 * armed run captured no baseline until the 5 s readout tick — and a ~4.7 s
 * bunking chain would then land inside the window it cannot detect. This test
 * is the guard for that, and it is why it does not mock the query layer.
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
    // A couple of milliseconds of "network" so two successive fetches cannot
    // share a `Date.now()` millisecond — which is the only way `dataUpdatedAt`
    // could repeat, and would defer the capture by a whole poll.
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

    // The press. `start()` invalidates; the refetch returns a payload
    // IDENTICAL to the one already cached, so `data` keeps its reference and
    // only `dataUpdatedAt` moves. That reading is what has to arrive.
    await act(async () => {
      result.current.start()
    })
    await waitFor(() => expect(pb.send).toHaveBeenCalledTimes(2))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(result.current.isRunning).toBe(true)
    expect(onComplete).not.toHaveBeenCalled()

    // The chain runs and finishes. No poll ever caught a job running — the
    // terminal end_time moving is the whole signal, and it is only readable
    // against a baseline the step above must have captured.
    terminal = '2026-04-22T10:00:06.000Z'
    await act(async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.syncStatus() })
    })

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('success'))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})
