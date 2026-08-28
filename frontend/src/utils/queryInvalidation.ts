import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from './queryKeys'

/** Invalidate every cache derived from session-scoped bunk requests / assignments. */
export function invalidateAssignmentDerivedQueries(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: queryKeys.socialGraphPrefix() })
  void qc.invalidateQueries({ queryKey: queryKeys.bunkSocialGraphPrefix() })
  void qc.invalidateQueries({ queryKey: queryKeys.satisfactionPrefix() })
  // #1607 / #1608 — post-check report must refresh after any assignment change
  // (drag-drop, solver apply/clear). Prefix catches all sessions + scenarios.
  void qc.invalidateQueries({ queryKey: queryKeys.postCheckPrefix() })
}

/**
 * Invalidate everything the SUMMER BOARD reads out of `bunks`, `bunk_plans` and
 * `bunk_assignments` — the tables `GetRefreshBunkingJobs()` rewrites.
 *
 * kindred#2587: `refreshBunkingMutation` had `onError` and nothing else, and
 * `hooks/session/useSessionData.ts` overrides no caching, so `['bunks', …]` and
 * `['campers', …]` inherit the app default 30 minute `staleTime`. React Query
 * will not refetch behind that, and nothing else on the Refresh Bunking path
 * invalidates those keys — so pressing the button updated the database and left
 * the board on pre-refresh data for up to half an hour.
 *
 * ⚠️ THIS MUST BE CALLED AT THE CUTOVER, NOT ON THE MUTATION RESOLVING.
 * `POST /refresh-bunking` returns `200 {"status":"started"}` immediately while
 * `RunSyncSequence` runs in a goroutine for ~4.7 s. An `onSuccess` invalidation
 * fires within milliseconds, refetches the OLD rows and re-marks them fresh for
 * another thirty minutes — strictly worse than the bug. `useSyncSequenceRun` is
 * what says when the chain actually finished.
 *
 * Kept here rather than beside `invalidateLodgingRegistryQueries` in
 * `queryKeys.ts` so it can compose `invalidateAssignmentDerivedQueries` above;
 * that module cannot import this one without a cycle.
 */
export function invalidateBunkingQueries(qc: QueryClient): void {
  // The board's own two read paths. BY PREFIX: `useSessionBunks` and
  // `useSessionCampers` build inline keys of a different arity from the
  // `bunksForSession` / `campersForSession` factories, and a completion handler
  // knows neither the selected session nor its AG children nor the open
  // scenario, so an exact key would match nothing that is cached.
  void qc.invalidateQueries({ queryKey: queryKeys.bunksPrefix() })
  void qc.invalidateQueries({ queryKey: queryKeys.campersPrefix() })
  // The cohort drill-down's inline "5th grade · Bunk 4" — reads
  // `bunk_assignments` directly.
  void qc.invalidateQueries({ queryKey: queryKeys.cohortBunkAssignmentsPrefix() })
  // The bunk-staff map is keyed on bunk names out of the `bunks` table, which
  // the first job of the chain rewrites.
  void qc.invalidateQueries({ queryKey: queryKeys.bunkStaffPrefix() })
  // Graph borders, satisfaction and the post-check report are all computed from
  // assignments — the same set drag-drop and solver applies already sweep.
  invalidateAssignmentDerivedQueries(qc)
}
