/**
 * Contract tests: social-graph cache invalidation after request mutations.
 *
 * Issue #1040 — The social-graph React Query cache is never invalidated by
 * mutation paths (drag-drop, solver apply, approve/decline). As a result the
 * node-border colors on the Social Network Graph stay stale until the user
 * navigates away and back.
 *
 * Fix: add ['social-graph'] and ['bunk-social-graph'] prefix invalidation to:
 *   - invalidateRequestQueries (catches RequestReviewPanel + Merge/Split modal
 *     paths which already call that helper)
 *   - useCamperMovement onSuccess (drag-drop)
 *   - useSolverOperations auto-apply + legacy-confirm blocks
 *
 * This file is a sibling contract to alert-invalidation.test.ts — adding a
 * new social-graph consumer key requires updating both this file and the
 * production call-sites.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidateRequestQueries, queryKeys } from '../../../utils/queryKeys'
import { invalidateAssignmentDerivedQueries } from '../../../utils/queryInvalidation'

const SESSION_CM_ID = 1001
const BUNK_CM_ID = 5001
const SCENARIO_ID = 'scenario-abc'
const YEAR = 2025
// Mirrors the scoped-graph filter signature emitted by useScopedGraphData
// (units, bunks, cross). Empty values represent the "no filter active" case
// — i.e. the same data SocialNetworkGraph caches when no filter is applied.
const SCOPED_FILTER_UNITS = ''
const SCOPED_FILTER_BUNKS = ''
const SCOPED_FILTER_CROSS = false

/**
 * Build a QueryClient pre-seeded with the social-graph cache entries so we
 * can assert they become stale after invalidation.
 *
 * Three keys are seeded:
 *  - session-level social graph for an active scenario
 *  - session-level social graph for production (null scenario)
 *  - bunk-level subgraph for an active scenario
 *  - bunk-level subgraph for production (null scenario)
 *  - the scoped session graph emitted by useScopedGraphData (the actual hook
 *    used by SocialNetworkGraph.tsx — without invalidating this key the
 *    rendered graph stays stale; see Finding #1)
 */
function buildQcWithGraphCache() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  })
  // Session-level graph (the node-border colours that are reported stale in #1040)
  qc.setQueryData(queryKeys.socialGraph(SESSION_CM_ID, YEAR, SCENARIO_ID), {
    nodes: [],
    edges: [],
  })
  qc.setQueryData(queryKeys.socialGraph(SESSION_CM_ID, YEAR, null), { nodes: [], edges: [] })
  // Bunk-level subgraph (same issue, same fix)
  qc.setQueryData(queryKeys.bunkSocialGraph(BUNK_CM_ID, SESSION_CM_ID, YEAR, SCENARIO_ID), {
    nodes: [],
    edges: [],
  })
  qc.setQueryData(queryKeys.bunkSocialGraph(BUNK_CM_ID, SESSION_CM_ID, YEAR, null), {
    nodes: [],
    edges: [],
  })
  // Scoped session-level graph keyed by useScopedGraphData — this is what
  // SocialNetworkGraph.tsx actually renders. The invalidation prefix MUST
  // prefix-match this key, otherwise the live graph never refreshes.
  qc.setQueryData(
    queryKeys.scopedSocialGraph(
      SESSION_CM_ID,
      YEAR,
      SCENARIO_ID,
      SCOPED_FILTER_UNITS,
      SCOPED_FILTER_BUNKS,
      SCOPED_FILTER_CROSS
    ),
    { nodes: [], edges: [] }
  )
  qc.setQueryData(
    queryKeys.scopedSocialGraph(
      SESSION_CM_ID,
      YEAR,
      null,
      SCOPED_FILTER_UNITS,
      SCOPED_FILTER_BUNKS,
      SCOPED_FILTER_CROSS
    ),
    { nodes: [], edges: [] }
  )
  return qc
}

function isSocialGraphStale(
  qc: QueryClient,
  sessionCmId = SESSION_CM_ID,
  year = YEAR,
  scenarioId: string | null = SCENARIO_ID
) {
  const state = qc.getQueryState(queryKeys.socialGraph(sessionCmId, year, scenarioId))
  return state?.isInvalidated === true
}

function isBunkSocialGraphStale(
  qc: QueryClient,
  bunkCmId = BUNK_CM_ID,
  sessionCmId = SESSION_CM_ID,
  year = YEAR,
  scenarioId: string | null = SCENARIO_ID
) {
  const state = qc.getQueryState(queryKeys.bunkSocialGraph(bunkCmId, sessionCmId, year, scenarioId))
  return state?.isInvalidated === true
}

function isScopedSocialGraphStale(
  qc: QueryClient,
  sessionCmId = SESSION_CM_ID,
  year = YEAR,
  scenarioId: string | null = SCENARIO_ID
) {
  const state = qc.getQueryState(
    queryKeys.scopedSocialGraph(
      sessionCmId,
      year,
      scenarioId,
      SCOPED_FILTER_UNITS,
      SCOPED_FILTER_BUNKS,
      SCOPED_FILTER_CROSS
    )
  )
  return state?.isInvalidated === true
}

// ---------------------------------------------------------------------------
// Path 1: invalidateRequestQueries helper (called by RequestReviewPanel,
//         MergeRequestsModal, SplitRequestModal)
// ---------------------------------------------------------------------------
describe('invalidateRequestQueries — must also invalidate social-graph', () => {
  let qc: QueryClient

  beforeEach(() => {
    qc = buildQcWithGraphCache()
  })

  it('marks social-graph stale after invalidateRequestQueries', () => {
    invalidateRequestQueries(qc)

    expect(isSocialGraphStale(qc)).toBe(true)
  })

  it('marks social-graph (null scenario) stale after invalidateRequestQueries', () => {
    invalidateRequestQueries(qc)

    expect(isSocialGraphStale(qc, SESSION_CM_ID, YEAR, null)).toBe(true)
  })

  it('marks bunk-social-graph stale after invalidateRequestQueries', () => {
    invalidateRequestQueries(qc)

    expect(isBunkSocialGraphStale(qc)).toBe(true)
  })

  it('marks bunk-social-graph (null scenario) stale after invalidateRequestQueries', () => {
    // Finding #4 — null-scenario bunk-social-graph is its own cache slot;
    // without an explicit assertion the prefix-match coverage is unverified.
    invalidateRequestQueries(qc)

    expect(isBunkSocialGraphStale(qc, BUNK_CM_ID, SESSION_CM_ID, YEAR, null)).toBe(true)
  })

  it('marks scoped social-graph stale after invalidateRequestQueries (Finding #1)', () => {
    // SocialNetworkGraph.tsx uses useScopedGraphData. Without prefix-match
    // coverage of the scoped key, the rendered graph stays stale — defeating
    // the purpose of the entire invalidation chain.
    invalidateRequestQueries(qc)

    expect(isScopedSocialGraphStale(qc)).toBe(true)
  })

  it('marks scoped social-graph (null scenario) stale after invalidateRequestQueries', () => {
    invalidateRequestQueries(qc)

    expect(isScopedSocialGraphStale(qc, SESSION_CM_ID, YEAR, null)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Path 2: drag-drop (useCamperMovement onSuccess)
// ---------------------------------------------------------------------------
describe('useCamperMovement — onSuccess must invalidate social-graph', () => {
  let qc: QueryClient

  beforeEach(() => {
    qc = buildQcWithGraphCache()
  })

  it('marks social-graph stale after a successful camper move', () => {
    // Mirror the current onSuccess shape in useCamperMovement.ts.
    const onSuccess = (client: QueryClient, selectedSession: string) => {
      void client.invalidateQueries({ queryKey: ['campers', selectedSession] })
      void client.invalidateQueries({ queryKey: queryKeys.bunkRequestStatus() })
      void client.invalidateQueries({ queryKey: queryKeys.allBunkRequestsPrefix() })
      invalidateAssignmentDerivedQueries(client)
    }

    onSuccess(qc, String(SESSION_CM_ID))

    expect(isSocialGraphStale(qc)).toBe(true)
    expect(isBunkSocialGraphStale(qc)).toBe(true)
    // Finding #1 — the rendered graph uses useScopedGraphData; assert it too.
    expect(isScopedSocialGraphStale(qc)).toBe(true)
  })

  it('marks social-graph stale even when the move response signals no change', () => {
    const onSuccessNoChange = (client: QueryClient, selectedSession: string) => {
      void client.invalidateQueries({ queryKey: ['campers', selectedSession] })
      void client.invalidateQueries({ queryKey: queryKeys.bunkRequestStatus() })
      void client.invalidateQueries({ queryKey: queryKeys.allBunkRequestsPrefix() })
      invalidateAssignmentDerivedQueries(client)
    }

    onSuccessNoChange(qc, String(SESSION_CM_ID))

    expect(isSocialGraphStale(qc)).toBe(true)
    expect(isScopedSocialGraphStale(qc)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Path 3: solver run completion (useSolverOperations auto-apply + confirm paths)
// ---------------------------------------------------------------------------
describe('useSolverOperations — apply path must invalidate social-graph', () => {
  let qc: QueryClient

  beforeEach(() => {
    qc = buildQcWithGraphCache()
  })

  it('marks social-graph stale after solver results are applied (auto-apply path)', async () => {
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

    expect(isSocialGraphStale(qc)).toBe(true)
    expect(isBunkSocialGraphStale(qc)).toBe(true)
    expect(isScopedSocialGraphStale(qc)).toBe(true)
  })

  it('marks social-graph stale after solver results are applied (legacy-confirm path)', async () => {
    const applyLegacy = async (client: QueryClient, selectedSession: string) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['campers', selectedSession] }),
        client.invalidateQueries({ queryKey: ['bunks', selectedSession] }),
        client.invalidateQueries({ queryKey: queryKeys.bunkRequestStatus() }),
        client.invalidateQueries({ queryKey: ['all-sessions'] }),
        client.invalidateQueries({ queryKey: queryKeys.allBunkRequestsPrefix() }),
      ])
      invalidateAssignmentDerivedQueries(client)
    }

    await applyLegacy(qc, String(SESSION_CM_ID))

    expect(isSocialGraphStale(qc)).toBe(true)
    expect(isBunkSocialGraphStale(qc)).toBe(true)
    expect(isScopedSocialGraphStale(qc)).toBe(true)
  })

  it('marks social-graph stale after handleClearAssignments (Finding #2)', async () => {
    // useSolverOperations.handleClearAssignments invalidates campers/bunks
    // plus graph + satisfaction via the shared helper.
    const clearAssignments = async (client: QueryClient, selectedSession: string) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['campers', selectedSession] }),
        client.invalidateQueries({ queryKey: ['bunks', selectedSession] }),
      ])
      invalidateAssignmentDerivedQueries(client)
    }

    await clearAssignments(qc, String(SESSION_CM_ID))

    expect(isSocialGraphStale(qc)).toBe(true)
    expect(isBunkSocialGraphStale(qc)).toBe(true)
    expect(isScopedSocialGraphStale(qc)).toBe(true)
  })
})
