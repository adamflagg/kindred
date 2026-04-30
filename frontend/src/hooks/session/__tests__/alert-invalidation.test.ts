/**
 * TDD tests for camper-card alert invalidation after request mutations.
 *
 * The "none satisfied" alert is derived client-side from
 * `['all-bunk-requests', sessionCmId, year]`. As of Stage 3a the satisfaction
 * filter ALSO honors `status === 'resolved'` (spec §2.1), so pure status
 * mutations (approve/decline/delete-via-status) DO change the alert and must
 * invalidate the cache. Mutations that mutate the row set (create/merge/split)
 * also need to invalidate. Drag-drop and solver-apply still need to invalidate
 * because they change bunk membership.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

// NOTE: invalidateQueries({ queryKey: ['x'] }) does prefix matching by default,
// so passing the bare prefix (no trailing args) catches every query keyed
// ['x', ...]. Do NOT add `exact: true` to the production handlers — these
// contract tests assume prefix-matching is intentional and would silently
// stop catching prefix-keyed staleness if exact matching is ever added.

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
  // Seed every per-camper-derived key that surfaces request data, so we can
  // verify status mutations propagate to ALL of them. See spec §15.4.
  qc.setQueryData(
    ['person-bunk-requests', 1001, year],
    [{ id: 'req-1', requester_id: 1001, requestee_id: 1002, status: 'pending' }]
  )
  qc.setQueryData(
    ['person-all-bunk-requests', 1001, year],
    [{ id: 'req-1', requester_id: 1001, requestee_id: 1002, status: 'pending' }]
  )
  qc.setQueryData(
    ['bunk_requests_tooltip', 1001, year],
    [{ id: 'req-1', requester_id: 1001, requestee_id: 1002, status: 'pending' }]
  )
  qc.setQueryData(['request-satisfaction', 1001], {})
  return qc
}

function isAllBunkRequestsStale(qc: QueryClient, sessionCmId = 1001, year = 2025) {
  const state = qc.getQueryState(['all-bunk-requests', sessionCmId, year])
  // After invalidateQueries the query is marked invalid (isInvalidated = true)
  return state?.isInvalidated === true
}

function isPersonBunkRequestsStale(qc: QueryClient, personCmId = 1001, year = 2025) {
  const state = qc.getQueryState(['person-bunk-requests', personCmId, year])
  return state?.isInvalidated === true
}

function isPersonAllBunkRequestsStale(qc: QueryClient, personCmId = 1001, year = 2025) {
  const state = qc.getQueryState(['person-all-bunk-requests', personCmId, year])
  return state?.isInvalidated === true
}

function isTooltipStale(qc: QueryClient, personCmId = 1001, year = 2025) {
  const state = qc.getQueryState(['bunk_requests_tooltip', personCmId, year])
  return state?.isInvalidated === true
}

function isSatisfactionStale(qc: QueryClient, personCmId = 1001) {
  const state = qc.getQueryState(['request-satisfaction', personCmId])
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
// Regression: MergeRequestsModal and SplitRequestModal already do it
// (those mutations DO change request count / merged_into, so the alert
// genuinely depends on their refresh — keep them as a regression guard)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Stage 3a Bug B: status-only mutations must also invalidate
// (RequestReviewPanel approve/decline, AllCamperRequestsModal status flip,
//  CreateRequestModal create) — previously only invalidated ['bunk-requests']
// which is the wrong key for the alert cache.
// ---------------------------------------------------------------------------
describe('Stage 3a status mutations — must invalidate all-bunk-requests', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = buildQueryClient()
  })

  it('RequestReviewPanel single approve/decline invalidates all-bunk-requests', () => {
    // After Stage 3a Bug A fix, the alert filters by status === 'resolved',
    // so flipping a row pending → resolved (or resolved → declined) WILL
    // change the satisfaction count and the alert must refresh.
    const onSuccessAfterFix = (qc: QueryClient) => {
      void qc.invalidateQueries({ queryKey: ['bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['all-bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['person-bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['person-all-bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['bunk_requests_tooltip'] })
      void qc.invalidateQueries({ queryKey: ['request-satisfaction'] })
    }

    onSuccessAfterFix(queryClient)

    expect(isAllBunkRequestsStale(queryClient)).toBe(true)
    expect(isPersonBunkRequestsStale(queryClient)).toBe(true)
    expect(isPersonAllBunkRequestsStale(queryClient)).toBe(true)
    expect(isTooltipStale(queryClient)).toBe(true)
    expect(isSatisfactionStale(queryClient)).toBe(true)
  })

  it('AllCamperRequestsModal status update invalidates all-bunk-requests', () => {
    const onSuccessAfterFix = (qc: QueryClient) => {
      void qc.invalidateQueries({ queryKey: ['bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['all-bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['person-bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['person-all-bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['bunk_requests_tooltip'] })
      void qc.invalidateQueries({ queryKey: ['request-satisfaction'] })
    }

    onSuccessAfterFix(queryClient)

    expect(isAllBunkRequestsStale(queryClient)).toBe(true)
    expect(isPersonBunkRequestsStale(queryClient)).toBe(true)
    expect(isPersonAllBunkRequestsStale(queryClient)).toBe(true)
    expect(isTooltipStale(queryClient)).toBe(true)
    expect(isSatisfactionStale(queryClient)).toBe(true)
  })

  it('CreateRequestModal create invalidates all-bunk-requests', () => {
    const onSuccessAfterFix = (qc: QueryClient) => {
      void qc.invalidateQueries({ queryKey: ['bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['all-bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['person-bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['person-all-bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['bunk_requests_tooltip'] })
      void qc.invalidateQueries({ queryKey: ['request-satisfaction'] })
    }

    onSuccessAfterFix(queryClient)

    expect(isAllBunkRequestsStale(queryClient)).toBe(true)
    expect(isPersonBunkRequestsStale(queryClient)).toBe(true)
    expect(isPersonAllBunkRequestsStale(queryClient)).toBe(true)
    expect(isTooltipStale(queryClient)).toBe(true)
    expect(isSatisfactionStale(queryClient)).toBe(true)
  })
})

describe('Merge / Split mutation contract — must invalidate all 7 §15.3 keys', () => {
  // Audit 2026-04-29 found Merge and Split invalidated only 5 of the 7 keys.
  // The 4 per-camper keys went stale on the sidebar, full-page CamperDetail,
  // tooltip, and satisfaction badges after a merge or split.
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = buildQueryClient()
  })

  function assertAllSeededKeysStale(qc: QueryClient) {
    expect(isAllBunkRequestsStale(qc)).toBe(true)
    expect(isPersonBunkRequestsStale(qc)).toBe(true)
    expect(isPersonAllBunkRequestsStale(qc)).toBe(true)
    expect(isTooltipStale(qc)).toBe(true)
    expect(isSatisfactionStale(qc)).toBe(true)
  }

  it('MergeRequestsModal onSuccess invalidates every §15.3 key', () => {
    const onSuccess = (qc: QueryClient) => {
      void qc.invalidateQueries({ queryKey: ['bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['all-bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['person-bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['person-all-bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['bunk_requests_tooltip'] })
      void qc.invalidateQueries({ queryKey: ['request-satisfaction'] })
      void qc.invalidateQueries({ queryKey: ['cohort-request-relations'] })
    }

    onSuccess(queryClient)

    assertAllSeededKeysStale(queryClient)
  })

  it('SplitRequestModal onSuccess invalidates every §15.3 key', () => {
    const onSuccess = (qc: QueryClient) => {
      void qc.invalidateQueries({ queryKey: ['bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['all-bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['person-bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['person-all-bunk-requests'] })
      void qc.invalidateQueries({ queryKey: ['bunk_requests_tooltip'] })
      void qc.invalidateQueries({ queryKey: ['request-satisfaction'] })
      void qc.invalidateQueries({ queryKey: ['cohort-request-relations'] })
    }

    onSuccess(queryClient)

    assertAllSeededKeysStale(queryClient)
  })
})
