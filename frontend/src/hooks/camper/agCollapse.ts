/**
 * Pure AG collapse/relabel helpers for current-year enrollment lists.
 *
 * AG is a sub-track of a main session, never shown as its own attendance:
 *  - collapseAgEnrollments drops an AG row when its parent main is also enrolled
 *    that year (mirrors fetchCamperJourney's enrolledByYear collapse).
 *  - buildAgParentPairs lists the (year, parent cm_id) lookups needed to relabel
 *    surviving AG-only rows to their parent main.
 *
 * Both guard against the `parentId` sentinel: `parent_id` (and `sessionCmId`)
 * default to 0 when absent, so a non-positive parentId never identifies a real
 * parent. Those AG rows are kept as-is and never trigger a lookup. Without the
 * guard a cm_id-less session (sessionCmId 0) would seed 0 into the enrolled set
 * and silently collapse an unrelated parentless AG row.
 */

/** Minimal enrollment shape needed for AG collapse/relabel. */
export interface AgCollapsibleEnrollment {
  sessionType: string
  sessionCmId: number
  parentId: number
}

export function collapseAgEnrollments<T extends AgCollapsibleEnrollment>(enrollments: T[]): T[] {
  const enrolledCmIds = new Set(enrollments.map((e) => e.sessionCmId))
  return enrollments.filter(
    (e) => !(e.sessionType === 'ag' && e.parentId > 0 && enrolledCmIds.has(e.parentId))
  )
}

export function buildAgParentPairs<T extends AgCollapsibleEnrollment>(
  enrollments: T[],
  year: number
): Array<{ year: number; cmId: number }> {
  return enrollments
    .filter((e) => e.sessionType === 'ag' && e.parentId > 0)
    .map((e) => ({ year, cmId: e.parentId }))
}
