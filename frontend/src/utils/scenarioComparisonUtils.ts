/**
 * Helpers for the scenario comparison page (ScenarioComparisonPage.tsx).
 *
 * Kept as pure, dependency-free functions so they can be unit tested without
 * mocking PocketBase, React Query, auth, or the router.
 */

// ---------------------------------------------------------------------------
// Locked-group types
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a locked group needed for diffing across scenarios.
 * `memberCmIds` is the set of CampMinder person IDs that belong to this group.
 */
export interface LockGroupSummary {
  id: string
  name: string
  color: string
  memberCmIds: number[]
}

/** Minimal shape needed to sort campers by name. */
export interface SortableCamper {
  firstName: string
  lastName: string
}

/** Minimal bunk shape used to decide which area-filter buttons to render. */
export interface BunkWithGender {
  gender: string
}

/** Area-filter values rendered as toggle buttons on the comparison page. */
export type BunkArea = 'all' | 'boys' | 'girls' | 'ag'

/**
 * Compare two campers by name (first name, then last name).
 * Locale-aware and case-insensitive. Returns negative / 0 / positive,
 * suitable for use directly as an Array.sort comparator.
 */
export function compareCamperByName(a: SortableCamper, b: SortableCamper): number {
  const firstCmp = a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' })
  if (firstCmp !== 0) return firstCmp
  return a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' })
}

/**
 * Sort campers alphabetically by first name, then last name.
 * Locale-aware and case-insensitive — staff scan by first name when
 * reconciling cabin rosters.
 *
 * Returns a new array; does not mutate the input.
 */
export function sortCampersByName<T extends SortableCamper>(campers: readonly T[]): T[] {
  return campers.toSorted(compareCamperByName)
}

/**
 * Given the bunks present in the comparison scope, return the list of area
 * filter options that should actually be rendered.
 *
 * - "all" is always included.
 * - "boys" / "girls" / "ag" appear only when at least one bunk of that gender
 *   exists in the scope. This hides filters that would produce an empty view.
 *
 * AG bunks are identified by `gender === "Mixed"` (see session-types.md:
 * AG bunks are co-ed and distinguished by gender="Mixed" and an "AG-" name prefix).
 */
export function getAvailableBunkAreas(bunks: readonly BunkWithGender[]): BunkArea[] {
  const result: BunkArea[] = ['all']
  if (bunks.some((b) => b.gender === 'M')) result.push('boys')
  if (bunks.some((b) => b.gender === 'F')) result.push('girls')
  if (bunks.some((b) => b.gender === 'Mixed')) result.push('ag')
  return result
}
