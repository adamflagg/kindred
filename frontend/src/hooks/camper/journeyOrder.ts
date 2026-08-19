/**
 * How a camper's journey is ordered, in ONE place.
 *
 * Its own module, and that is not tidiness. It lived in `fetchCamperJourney`
 * first, and `useCamperHistory` — which merges that fetcher's prior-year rows
 * with the current year's and re-sorts the union — imports it. But
 * `useCamperHistory`'s tests MOCK `./fetchCamperJourney` wholesale, so the
 * comparator came back `undefined` there and the merge fell through to its
 * current-year-only fallback. A module nobody mocks is what makes one
 * comparator genuinely shared.
 */

/**
 * Year descending, then CHRONOLOGICAL WITHIN THE YEAR — across programs, not
 * within each one (owner, 2026-08-18).
 *
 * Both journey paths sorted on the year alone, so within a year the rows kept
 * whatever order their source produced, which groups by program. A camper who
 * went to Family Camp 1 in May, two summer sessions in June and July, and
 * Family Camp 6 in September read as "2a, 3a, FC1, FC6" — summer first and
 * both family weekends after it, which is not the order anything happened in.
 *
 * ⚠️ THE DEFECT WAS VISIBLE ONLY ON THE CURRENT YEAR, and that is what made it
 * look like a current-year problem. Prior-year rows arrive chronological by
 * luck of the fetch order, so a year-only sort preserved them; the current
 * year's are built per-camper and grouped by program, so the same sort
 * preserved that instead. One comparator over both is the fix.
 *
 * A row without a `startDate` sorts LAST within its year rather than first: an
 * empty string compares below every real date, which would float an undated
 * row to the top of its year where it reads as the first thing that happened.
 */
export function byYearThenChronological(
  a: { year: number; startDate?: string },
  b: { year: number; startDate?: string }
): number {
  if (a.year !== b.year) return b.year - a.year
  const left = a.startDate ?? ''
  const right = b.startDate ?? ''
  if (left === right) return 0
  if (left === '') return 1
  if (right === '') return -1
  return left.localeCompare(right)
}
