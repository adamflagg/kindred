/**
 * Helpers for the scenario comparison page (ScenarioComparisonPage.tsx).
 *
 * Kept as pure, dependency-free functions so they can be unit tested without
 * mocking PocketBase, React Query, auth, or the router.
 */

/** Minimal shape needed to sort campers by name. */
export interface SortableCamper {
  firstName: string
  lastName: string
}

/** Minimal bunk shape used to decide which area-filter buttons to render. */
export interface BunkWithGender {
  name: string
  gender: string
}

/** Area-filter values rendered as toggle buttons on the comparison page. */
export type BunkArea = 'all' | 'boys' | 'girls' | 'ag'

/**
 * Sort campers alphabetically by last name, then first name.
 * Locale-aware and case-insensitive — matches the convention used elsewhere
 * in the app (see DrillDownModal, ManualResolutionModal).
 *
 * Returns a new array; does not mutate the input.
 */
export function sortCampersByName<T extends SortableCamper>(campers: readonly T[]): T[] {
  return campers.slice().sort((a, b) => {
    const lastCmp = a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' })
    if (lastCmp !== 0) return lastCmp
    return a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' })
  })
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
