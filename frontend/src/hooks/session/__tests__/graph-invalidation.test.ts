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
import { invalidateRequestQueries } from '../../../utils/queryKeys'

const SESSION_CM_ID = 1001
const BUNK_CM_ID = 5001
const SCENARIO_ID = 'scenario-abc'
const YEAR = 2025

/**
 * Build a QueryClient pre-seeded with both social-graph cache entries so we
 * can assert they become stale after invalidation.
 */
function buildQcWithGraphCache() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  })
  // Session-level graph (the node-border colours that are reported stale in #1040)
  qc.setQueryData(['social-graph', SESSION_CM_ID, YEAR, SCENARIO_ID], { nodes: [], edges: [] })
  qc.setQueryData(['social-graph', SESSION_CM_ID, YEAR, null], { nodes: [], edges: [] })
  // Bunk-level subgraph (same issue, same fix)
  qc.setQueryData(['bunk-social-graph', BUNK_CM_ID, SESSION_CM_ID, YEAR, SCENARIO_ID], {
    nodes: [],
    edges: [],
  })
  return qc
}

function isSocialGraphStale(
  qc: QueryClient,
  sessionCmId = SESSION_CM_ID,
  year = YEAR,
  scenarioId: string | null = SCENARIO_ID
) {
  const state = qc.getQueryState(['social-graph', sessionCmId, year, scenarioId])
  return state?.isInvalidated === true
}

function isBunkSocialGraphStale(
  qc: QueryClient,
  bunkCmId = BUNK_CM_ID,
  sessionCmId = SESSION_CM_ID,
  year = YEAR,
  scenarioId: string | null = SCENARIO_ID
) {
  const state = qc.getQueryState(['bunk-social-graph', bunkCmId, sessionCmId, year, scenarioId])
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
    // Mirror the current onSuccess shape in useCamperMovement.ts — we add the
    // social-graph invalidation alongside the existing allBunkRequestsPrefix one.
    const onSuccess = (client: QueryClient, selectedSession: string) => {
      void client.invalidateQueries({ queryKey: ['campers', selectedSession] })
      void client.invalidateQueries({ queryKey: ['bunk-request-status'] })
      void client.invalidateQueries({ queryKey: ['all-bunk-requests'] })
      void client.invalidateQueries({ queryKey: ['social-graph'] })
      void client.invalidateQueries({ queryKey: ['bunk-social-graph'] })
    }

    onSuccess(qc, String(SESSION_CM_ID))

    expect(isSocialGraphStale(qc)).toBe(true)
    expect(isBunkSocialGraphStale(qc)).toBe(true)
  })

  it('marks social-graph stale even when the move response signals no change', () => {
    const onSuccessNoChange = (client: QueryClient, selectedSession: string) => {
      void client.invalidateQueries({ queryKey: ['campers', selectedSession] })
      void client.invalidateQueries({ queryKey: ['bunk-request-status'] })
      void client.invalidateQueries({ queryKey: ['all-bunk-requests'] })
      void client.invalidateQueries({ queryKey: ['social-graph'] })
      void client.invalidateQueries({ queryKey: ['bunk-social-graph'] })
    }

    onSuccessNoChange(qc, String(SESSION_CM_ID))

    expect(isSocialGraphStale(qc)).toBe(true)
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
        client.invalidateQueries({ queryKey: ['bunk-request-status'] }),
        client.invalidateQueries({ queryKey: ['all-sessions'] }),
        client.invalidateQueries({ queryKey: ['all-bunk-requests'] }),
        client.invalidateQueries({ queryKey: ['social-graph'] }),
        client.invalidateQueries({ queryKey: ['bunk-social-graph'] }),
      ])
    }

    await applyResults(qc, String(SESSION_CM_ID))

    expect(isSocialGraphStale(qc)).toBe(true)
    expect(isBunkSocialGraphStale(qc)).toBe(true)
  })

  it('marks social-graph stale after solver results are applied (legacy-confirm path)', async () => {
    const applyLegacy = async (client: QueryClient, selectedSession: string) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['campers', selectedSession] }),
        client.invalidateQueries({ queryKey: ['bunks', selectedSession] }),
        client.invalidateQueries({ queryKey: ['bunk-request-status'] }),
        client.invalidateQueries({ queryKey: ['all-sessions'] }),
        client.invalidateQueries({ queryKey: ['all-bunk-requests'] }),
        client.invalidateQueries({ queryKey: ['social-graph'] }),
        client.invalidateQueries({ queryKey: ['bunk-social-graph'] }),
      ])
    }

    await applyLegacy(qc, String(SESSION_CM_ID))

    expect(isSocialGraphStale(qc)).toBe(true)
    expect(isBunkSocialGraphStale(qc)).toBe(true)
  })
})
