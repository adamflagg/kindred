/**
 * kindred#2587: what a completed `Refresh Bunking` must invalidate.
 *
 * The list is load-bearing rather than decorative. Every one of these queries
 * inherits the app default 30 minute `staleTime` (`utils/queryClient.ts`), so a
 * key left off this list keeps serving PRE-REFRESH data for half an hour behind
 * a toast that says the refresh landed.
 *
 * The assertions read the CACHE STATE (`isInvalidated`) rather than spying on
 * `invalidateQueries`, and they build the keys with the real factories and real
 * arguments, so a key-shape change breaks the test at the shape rather than at
 * a string literal that no longer matches anything.
 */
import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { queryKeys } from './queryKeys'
import { invalidateBunkingQueries } from './queryInvalidation'

const YEAR = 2026
const SESSION_CM_ID = 1000001

/** The real keys the summer board reads bunks / plans / assignments through. */
const BOARD_READER_KEYS: Array<[string, readonly unknown[]]> = [
  // useSessionBunks — an inline key, not a factory (hooks/session/useSessionData.ts)
  ['useSessionBunks', ['bunks', '1000001', SESSION_CM_ID, ['ag-1']]],
  // useSessionCampers — carries the bunk assignment for every camper
  ['useSessionCampers', ['campers', '1000001', ['ag-1'], undefined]],
  ['campersForSession', queryKeys.campersForSession('sess-1', [], YEAR)],
  ['bunksForSession', queryKeys.bunksForSession('sess-1', [])],
  ['cohortBunkAssignments', queryKeys.cohortBunkAssignments(null, SESSION_CM_ID, YEAR, [1, 2])],
  ['bunkStaff', queryKeys.bunkStaff(YEAR)],
  // The social graph's bunk picker and label fallback (hooks/useBunkNames.ts).
  // An inline key again, and it reads `bunk_plans` + `bunks` — two of the three
  // tables the chain rewrites. Sweeping the graph's EDGES but not the names it
  // draws them under is the half-invalidation this list exists to prevent.
  ['useBunkNames', ['bunk-names', SESSION_CM_ID, YEAR]],
  // The camper details panel's current-year bunk (hooks/camper/useCamperEnrollment.ts).
  ['enrolledCampers', queryKeys.enrolledCampers(9001, YEAR)],
  // Gates the AG tab on whether the linked AG session has bunk_plans yet — so a
  // refresh that creates them must be what makes the tab appear.
  ['linkedAgSession', queryKeys.linkedAgSession(SESSION_CM_ID, YEAR)],
  // Three more inline `bunk_plans` readers. Their names all START with a word
  // other than `bunks`, so `bunksPrefix()` reaches none of them — which is
  // exactly why they were missed the first time this list was written.
  ['allBunksWithPlans', ['all-bunks-with-plans', YEAR]],
  ['sessionBunks (BunkSocialGraphModal)', ['session-bunks', SESSION_CM_ID, YEAR]],
  ['sessionBunkPlanCounts', ['session-bunk-plan-counts', YEAR, SESSION_CM_ID]],
  // Derived from assignments — the same set `invalidateAssignmentDerivedQueries`
  // already covers for drag-drop and solver applies.
  ['socialGraph', queryKeys.socialGraph(SESSION_CM_ID, YEAR)],
  ['bunkSocialGraph', queryKeys.bunkSocialGraph(7, SESSION_CM_ID, YEAR)],
  ['postCheck', queryKeys.postCheck(SESSION_CM_ID, YEAR, undefined)],
]

/** Untouched by bunks / bunk_plans / bunk_assignments — must NOT be swept. */
const UNRELATED_KEYS: Array<[string, readonly unknown[]]> = [
  ['weekendRoster', queryKeys.weekendRoster(YEAR, 900, '')],
  ['lodgingUnits', queryKeys.lodgingUnits(YEAR)],
  ['users', queryKeys.users()],
]

describe('invalidateBunkingQueries', () => {
  it('invalidates every summer board reader of bunks, plans and assignments', () => {
    const qc = new QueryClient()
    for (const [, key] of [...BOARD_READER_KEYS, ...UNRELATED_KEYS]) {
      qc.setQueryData(key, 'seeded')
    }

    invalidateBunkingQueries(qc)

    for (const [name, key] of BOARD_READER_KEYS) {
      expect(qc.getQueryState(key)?.isInvalidated, `${name} was not invalidated`).toBe(true)
    }
  })

  it('leaves the weekend and admin surfaces alone', () => {
    const qc = new QueryClient()
    for (const [, key] of [...BOARD_READER_KEYS, ...UNRELATED_KEYS]) {
      qc.setQueryData(key, 'seeded')
    }

    invalidateBunkingQueries(qc)

    for (const [name, key] of UNRELATED_KEYS) {
      expect(qc.getQueryState(key)?.isInvalidated, `${name} should not be invalidated`).toBe(false)
    }
  })

  it('does not sweep the bunk-requests count, which the chain never writes', () => {
    const qc = new QueryClient()
    const key = queryKeys.bunkRequestsCount('1000001', YEAR)
    qc.setQueryData(key, 3)

    invalidateBunkingQueries(qc)

    expect(qc.getQueryState(key)?.isInvalidated).toBe(false)
  })
})
