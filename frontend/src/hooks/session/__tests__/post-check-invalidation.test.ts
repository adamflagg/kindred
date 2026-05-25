/**
 * Contract tests: post-check (validator report) cache invalidation after
 * manual mutations.
 *
 * Bug: #1607 / #1608 — The "Check Bunking" validator report and the
 * adjusted "requests met" count do not refresh after a staffer manually
 * places/moves a camper (drag) or changes a request disposition
 * (approve/decline). They only update after a full page refresh or after
 * running the solver.
 *
 * Root cause: `postCheck` React Query entries have `staleTime: 5 min` and
 * are never invalidated by the drag-drop (`useCamperMovement`) or
 * disposition-change (`invalidateRequestQueries`) mutation paths — only the
 * solver-apply path would invalidate them if it added the key (it currently
 * does not).
 *
 * Fix: add `queryKeys.postCheckPrefix()` invalidation to:
 *   - `invalidateAssignmentDerivedQueries` (covers drag-drop + solver apply/clear)
 *   - `invalidateRequestQueries` (covers approve/decline/merge/split)
 *
 * This file is a sibling contract to alert-invalidation.test.ts and
 * graph-invalidation.test.ts. Adding a new consumer of `postCheck` requires
 * updating this file AND the production call-sites.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidateRequestQueries, queryKeys } from '../../../utils/queryKeys'
import { invalidateAssignmentDerivedQueries } from '../../../utils/queryInvalidation'

const SESSION_CM_ID = 1001
const SCENARIO_ID = 'scenario-abc'
const YEAR = 2025

/**
 * Build a QueryClient pre-seeded with postCheck cache entries so we can
 * verify whether invalidation marks them stale.
 *
 * Two variants are seeded:
 *  - production mode (no scenario)
 *  - scenario mode
 */
function buildQcWithPostCheckCache() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  })
  // Production mode (no scenario)
  qc.setQueryData(queryKeys.postCheck(SESSION_CM_ID, YEAR, undefined), {
    statistics: {
      total_campers: 100,
      assigned_campers: 90,
      satisfied_requests: 45,
      total_requests: 50,
      request_satisfaction_rate: 0.9,
    },
    issues: [],
    validated_at: '2025-01-01T00:00:00Z',
  })
  // Scenario mode
  qc.setQueryData(queryKeys.postCheck(SESSION_CM_ID, YEAR, SCENARIO_ID), {
    statistics: {
      total_campers: 100,
      assigned_campers: 88,
      satisfied_requests: 40,
      total_requests: 50,
      request_satisfaction_rate: 0.8,
    },
    issues: [],
    validated_at: '2025-01-01T00:00:00Z',
  })
  return qc
}

function isPostCheckStale(
  qc: QueryClient,
  sessionCmId = SESSION_CM_ID,
  year = YEAR,
  scenarioId: string | undefined = undefined
) {
  const state = qc.getQueryState(queryKeys.postCheck(sessionCmId, year, scenarioId))
  return state?.isInvalidated === true
}

function isPostCheckScenarioStale(
  qc: QueryClient,
  sessionCmId = SESSION_CM_ID,
  year = YEAR,
  scenarioId: string = SCENARIO_ID
) {
  const state = qc.getQueryState(queryKeys.postCheck(sessionCmId, year, scenarioId))
  return state?.isInvalidated === true
}

// ---------------------------------------------------------------------------
// Path 1: drag-drop (useCamperMovement.onSuccess) via invalidateAssignmentDerivedQueries
// ---------------------------------------------------------------------------
describe('useCamperMovement — onSuccess must invalidate postCheck via invalidateAssignmentDerivedQueries', () => {
  let qc: QueryClient

  beforeEach(() => {
    qc = buildQcWithPostCheckCache()
  })

  it('marks postCheck (production) stale after a successful camper move', () => {
    // Mirror the current onSuccess shape in useCamperMovement.ts.
    // invalidateAssignmentDerivedQueries is called from both code paths (null
    // and non-null response).
    const onSuccess = (client: QueryClient, selectedSession: string) => {
      void client.invalidateQueries({ queryKey: ['campers', selectedSession] })
      void client.invalidateQueries({ queryKey: queryKeys.bunkRequestStatus() })
      void client.invalidateQueries({ queryKey: queryKeys.allBunkRequestsPrefix() })
      invalidateAssignmentDerivedQueries(client)
    }

    onSuccess(qc, String(SESSION_CM_ID))

    expect(isPostCheckStale(qc)).toBe(true)
  })

  it('marks postCheck (scenario) stale after a successful camper move', () => {
    const onSuccess = (client: QueryClient, selectedSession: string) => {
      void client.invalidateQueries({ queryKey: ['campers', selectedSession] })
      void client.invalidateQueries({ queryKey: queryKeys.bunkRequestStatus() })
      void client.invalidateQueries({ queryKey: queryKeys.allBunkRequestsPrefix() })
      invalidateAssignmentDerivedQueries(client)
    }

    onSuccess(qc, String(SESSION_CM_ID))

    expect(isPostCheckScenarioStale(qc)).toBe(true)
  })

  it('marks postCheck stale even when the move response signals no change (null response path)', () => {
    // useCamperMovement has two onSuccess code paths — null response (unassign)
    // and non-null response (assign/move). Both must invalidate postCheck.
    const onSuccessNull = (client: QueryClient, selectedSession: string) => {
      void client.invalidateQueries({ queryKey: ['campers', selectedSession] })
      void client.invalidateQueries({ queryKey: queryKeys.bunkRequestStatus() })
      void client.invalidateQueries({ queryKey: queryKeys.allBunkRequestsPrefix() })
      invalidateAssignmentDerivedQueries(client)
    }

    onSuccessNull(qc, String(SESSION_CM_ID))

    expect(isPostCheckStale(qc)).toBe(true)
    expect(isPostCheckScenarioStale(qc)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Path 2: solver apply (useSolverOperations) via invalidateAssignmentDerivedQueries
// ---------------------------------------------------------------------------
describe('useSolverOperations — apply path must invalidate postCheck via invalidateAssignmentDerivedQueries', () => {
  let qc: QueryClient

  beforeEach(() => {
    qc = buildQcWithPostCheckCache()
  })

  it('marks postCheck stale after solver results are applied (auto-apply path)', async () => {
    const applyResults = async (client: QueryClient, selectedSession: string) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['campers', selectedSession] }),
        client.invalidateQueries({ queryKey: ['bunks', selectedSession] }),
        client.invalidateQueries({ queryKey: queryKeys.bunkRequestStatus() }),
        client.invalidateQueries({ queryKey: ['all-sessions'] }),
        client.invalidateQueries({ queryKey: queryKeys.allBunkRequestsPrefix() }),
      ])
      invalidateAssignmentDerivedQueries(client)
    }

    await applyResults(qc, String(SESSION_CM_ID))

    expect(isPostCheckStale(qc)).toBe(true)
    expect(isPostCheckScenarioStale(qc)).toBe(true)
  })

  it('marks postCheck stale after handleClearAssignments', async () => {
    const clearAssignments = async (client: QueryClient, selectedSession: string) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['campers', selectedSession] }),
        client.invalidateQueries({ queryKey: ['bunks', selectedSession] }),
      ])
      invalidateAssignmentDerivedQueries(client)
    }

    await clearAssignments(qc, String(SESSION_CM_ID))

    expect(isPostCheckStale(qc)).toBe(true)
    expect(isPostCheckScenarioStale(qc)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Path 3: request disposition changes (RequestReviewPanel, AllCamperRequestsModal)
//         via invalidateRequestQueries
// ---------------------------------------------------------------------------
describe('invalidateRequestQueries — must also invalidate postCheck', () => {
  let qc: QueryClient

  beforeEach(() => {
    qc = buildQcWithPostCheckCache()
  })

  it('marks postCheck (production) stale after approve/decline', () => {
    invalidateRequestQueries(qc)

    expect(isPostCheckStale(qc)).toBe(true)
  })

  it('marks postCheck (scenario) stale after approve/decline', () => {
    invalidateRequestQueries(qc)

    expect(isPostCheckScenarioStale(qc)).toBe(true)
  })

  it('marks postCheck stale after bulk approve/decline', () => {
    // bulkUpdateMutation also calls invalidateRequestQueries
    invalidateRequestQueries(qc)

    expect(isPostCheckStale(qc)).toBe(true)
    expect(isPostCheckScenarioStale(qc)).toBe(true)
  })

  it('marks postCheck stale after merge/split request mutations', () => {
    // MergeRequestsModal and SplitRequestModal also call invalidateRequestQueries
    invalidateRequestQueries(qc)

    expect(isPostCheckStale(qc)).toBe(true)
    expect(isPostCheckScenarioStale(qc)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Regression: prefix match covers all session/scenario combinations
// ---------------------------------------------------------------------------
describe('postCheckPrefix — prefix invalidation covers both scenarios', () => {
  let qc: QueryClient

  beforeEach(() => {
    qc = buildQcWithPostCheckCache()
  })

  it('prefix-invalidating postCheckPrefix marks all postCheck entries stale', () => {
    void qc.invalidateQueries({ queryKey: queryKeys.postCheckPrefix() })

    expect(isPostCheckStale(qc, SESSION_CM_ID, YEAR, undefined)).toBe(true)
    expect(isPostCheckScenarioStale(qc, SESSION_CM_ID, YEAR, SCENARIO_ID)).toBe(true)
  })

  it('prefix invalidation is session-agnostic (catches a different session cm_id too)', () => {
    const OTHER_SESSION = 2002
    qc.setQueryData(queryKeys.postCheck(OTHER_SESSION, YEAR, undefined), { issues: [] })

    void qc.invalidateQueries({ queryKey: queryKeys.postCheckPrefix() })

    const otherState = qc.getQueryState(queryKeys.postCheck(OTHER_SESSION, YEAR, undefined))
    expect(otherState?.isInvalidated).toBe(true)
  })
})
