/**
 * When CampMinder was last read for ONE family-camp weekend, or undefined when
 * that cannot be answered (kindred#2601, kindred#2617).
 *
 * ONE READ, BOTH SURFACES — the nav's "Housing synced" line and the Refresh
 * Housing modal. They sit inches apart on the same screen, so a divergence here
 * is immediately self-contradicting: one going quiet while the other claims two
 * minutes is worse than either alone. Both now read the same field off the same
 * weekend object, so there is no second calculation left to drift.
 *
 * ## Why this is a field read and not a calculation any more
 *
 * It used to resolve the question in the browser, off the sync-status payload:
 * "is the last run of `household_custom_values_family_camp` one that covered
 * this weekend?". That payload keeps ONE SLOT PER JOB, so it can only ever
 * describe the LAST run — and once a press scoped to weekend A lands, the
 * nightly cron run that did cover weekend B is gone from it. B was older by an
 * amount nothing in that payload could name, so B went silent.
 *
 * `/api/lodging/sessions` answers it from `sync_runs` history instead: the most
 * recent successful run of that job that was unscoped OR scoped to this
 * weekend. That is a question about runs the payload no longer holds, so it
 * cannot be asked here, and the rule's tests live beside the query.
 *
 * ## Why "" is a real answer
 *
 * WITHHOLD RATHER THAN BORROW. A weekend whose only runs belong to other
 * weekends has no attributable time, and a neighbour's is not an approximation
 * of it. Adult weekends are always "": they are not in the family-camp cohort,
 * so the job never read their answers at all.
 *
 * The coercion is load-bearing rather than tidiness — `new Date('')` is an
 * Invalid Date, which `formatDistanceToNow` renders as "Invalid Date ago". It is
 * spelled out rather than written `?? undefined` for the same reason: `??` falls
 * through on absence and NOT on `""`, so it would hand exactly that string on.
 */
export function weekendHousingSyncedAt(
  session: { housing_synced_at?: string } | undefined
): string | undefined {
  const syncedAt = session?.housing_synced_at
  return syncedAt === undefined || syncedAt === '' ? undefined : syncedAt
}
