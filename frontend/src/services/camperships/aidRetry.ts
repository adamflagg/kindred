/**
 * Camperships' read retry: a server answer is never retried, 5xx included. These reads build the
 * whole priced season, and when the server is slow because it is overloaded a retry only queues
 * another full build behind the one that timed out (a 2026-10-12 smoke test saw one timed-out
 * Rounds & budget read come back three more times). Decision 30's refusals (404, 422) and a lapsed
 * sign-in (401) are server answers too, so they answer at once as before.
 *
 * A dropped connection, which never reached the server, gets one retry. It arrives in two shapes:
 * `fetch` rejects with a TypeError that has no `status`, and the PocketBase SDK (the direct
 * `camp_sessions` reads) wraps the same failure in a ClientResponseError with `status: 0`. So no
 * status, or status 0, counts as the network.
 *
 * This departs from the app's `retry: 3` (utils/queryClient.ts) on purpose (CLAUDE.md "Family Camp
 * Models Summer": a divergence states its reason); whether the whole app should follow is #3175.
 * Every read under `queryKeys.aidPrefix()` inherits it through `setQueryDefaults`; a Camperships
 * hook keyed under a shared prefix passes it itself.
 */
export function aidRetry(failureCount: number, error: Error): boolean {
  const status: unknown = 'status' in error ? error.status : undefined
  const dropped = status === undefined || status === null || status === 0
  return dropped && failureCount < 1
}
