import type { Bunk, Camper } from '../types/app-types'

/**
 * A camper is "effectively unassigned" if they have no bunk, OR their bunk is
 * not among the session's bunks. The second case is the stranded camper from a
 * bunk-plan reorganization (#1416): the bunk record still exists but has no
 * bunk_plan for this session, so it has no column on the board. Without this
 * check such campers match no column and vanish entirely.
 *
 * `validBunkIds` is built from the session-scoped `bunks` prop — not the
 * area-filtered subset — so a camper in a real bunk that simply belongs to
 * another area is correctly left assigned.
 */
export function isCamperEffectivelyUnassigned(camper: Camper, validBunkIds: Set<string>): boolean {
  return !camper.assigned_bunk || !validBunkIds.has(camper.assigned_bunk)
}

/**
 * Returns the campers that are effectively unassigned for the session.
 *
 * `bunks` and `campers` are fed by independent React Query hooks, so `bunks`
 * can still be `[]` while `campers` has already resolved. With an empty bunk
 * set every `assigned_bunk` would miss `validBunkIds` and the board would flash
 * every assigned camper into the Unassigned pool. While bunks are unloaded we
 * fall back to the plain "no bunk" check; the stranded-camper detection kicks
 * in only once the session's bunks are known.
 */
export function getEffectivelyUnassignedCampers(campers: Camper[], bunks: Bunk[]): Camper[] {
  if (bunks.length === 0) {
    return campers.filter((c) => !c.assigned_bunk)
  }
  const validBunkIds = new Set(bunks.map((b) => b.id))
  return campers.filter((c) => isCamperEffectivelyUnassigned(c, validBunkIds))
}
