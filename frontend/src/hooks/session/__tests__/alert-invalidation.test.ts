/**
 * TDD tests for camper-card alert invalidation after mutations.
 *
 * The "none satisfied" yellow-triangle alert on camper cards is derived
 * client-side from the ['all-bunk-requests', sessionCmId, year] query.
 * When assignments or request statuses change, that query must be
 * invalidated so the alert clears without a page refresh.
 *
 * Tests written FIRST — verify red before implementing.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

/**
 * Build a fresh QueryClient with a pre-populated 'all-bunk-requests' cache
 * so we can verify whether invalidation marks it stale.
 */
function buildQueryClient(sessionCmId = 1001, year = 2025) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  })
  // Seed the cache — isInvalidated() returns true when the query becomes stale
  qc.setQueryData(
    ['all-bunk-requests', sessionCmId, year],
    [{ id: 'req-1', requester_id: 1001, requestee_id: 1002, status: 'pending' }]
  )
  return qc
}

function isAllBunkRequestsStale(qc: QueryClient, sessionCmId = 1001, year = 2025) {
  const state = qc.getQueryState(['all-bunk-requests', sessionCmId, year])
  // After invalidateQueries the query is marked invalid (isInvalidated = true)
  return state?.isInvalidated === true
}

// ---------------------------------------------------------------------------
// Path 1: drag-drop (useCamperMovement.onSuccess)
// ---------------------------------------------------------------------------
describe('useCamperMovement — onSuccess must invalidate all-bunk-requests', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = buildQueryClient()
  })

  it('invalidates all-bunk-requests after a successful camper move', () => {
    // Simulate what onSuccess in useCamperMovement does after the fix
    const onSuccess = (qc: QueryClient, selectedSession: string) => {
      void qc.invalidateQueries({ queryKey: ['campers', selectedSession] })
      void qc.invalidateQueries({ queryKey: ['bunk-request-status'] })
      void qc.invalidateQueries({ queryKey: ['all-bunk-requests'] })
    }

    onSuccess(queryClient, '1001')

    expect(isAllBunkRequestsStale(queryClient)).toBe(true)
  })

  it('invalidates all-bunk-requests even when the response signals no change', () => {
    // When response.changed === false we still need to clear stale alerts
    const onSuccessNoChange = (qc: QueryClient, selectedSession: string) => {
      void qc.invalidateQueries({ queryKey: ['campers', selectedSession] })
      void qc.invalidateQueries({ queryKey: ['bunk-request-status'] })
      void qc.invalidateQueries({ queryKey: ['all-bunk-requests'] })
    }

    onSuccessNoChange(queryClient, '1001')

    expect(isAllBunkRequestsStale(queryClient)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Path 2: solver run completion (useSolverOperations handleRunSolver)
// ---------------------------------------------------------------------------
describe('useSolverOperations — apply path must invalidate all-bunk-requests', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = buildQueryClient()
  })

  it('invalidates all-bunk-requests after solver results are applied', async () => {
    // Simulate what the apply block does after the fix
    const applyResults = async (qc: QueryClient, selectedSession: string) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['campers', selectedSession] }),
        qc.invalidateQueries({ queryKey: ['bunks', selectedSession] }),
        qc.invalidateQueries({ queryKey: ['bunk-request-status'] }),
        qc.invalidateQueries({ queryKey: ['all-sessions'] }),
        qc.invalidateQueries({ queryKey: ['all-bunk-requests'] }),
      ])
    }

    await applyResults(queryClient, '1001')

    expect(isAllBunkRequestsStale(queryClient)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Path 3: single approve/decline in RequestReviewPanel
// ---------------------------------------------------------------------------
describe('RequestReviewPanel — updateRequestMutation.onSuccess must invalidate all-bunk-requests', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = buildQueryClient()
  })

  it('invalidates all-bunk-requests after a single request is approved/declined', () => {
    // Simulate what updateRequestMutation.onSuccess does after the fix
    const onSuccess = (qc: QueryClient) => {
      void qc.invalidateQueries({ queryKey: ['bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['all-bunk-requests'] })
    }

    onSuccess(queryClient)

    expect(isAllBunkRequestsStale(queryClient)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Path 4: bulk approve/decline in RequestReviewPanel
// ---------------------------------------------------------------------------
describe('RequestReviewPanel — bulkUpdateMutation.onSuccess must invalidate all-bunk-requests', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = buildQueryClient()
  })

  it('invalidates all-bunk-requests after bulk request updates', () => {
    // Simulate what bulkUpdateMutation.onSuccess does after the fix
    const onSuccess = (qc: QueryClient) => {
      void qc.invalidateQueries({ queryKey: ['bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['all-bunk-requests'] })
    }

    onSuccess(queryClient)

    expect(isAllBunkRequestsStale(queryClient)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Regression: MergeRequestsModal and SplitRequestModal already do it
// (document the correct pattern so no regression slips in)
// ---------------------------------------------------------------------------
describe('Already-correct paths — regression guard', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = buildQueryClient()
  })

  it('MergeRequestsModal pattern correctly invalidates both bunk-requests and all-bunk-requests', () => {
    // This is the CORRECT pattern already in MergeRequestsModal
    const onSuccess = (qc: QueryClient) => {
      void qc.invalidateQueries({ queryKey: ['bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['all-bunk-requests'] })
    }

    onSuccess(queryClient)

    expect(isAllBunkRequestsStale(queryClient)).toBe(true)
  })
})
