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

/** Minimal camper shape used by computeImpactedCabins. */
export interface MovedCamper {
  personCmId: number
}

/** A single moved entry from the comparison result. */
export interface MovedEntry {
  camper: MovedCamper
  fromBunk: { id: string; name: string }
  toBunk: { id: string; name: string }
}

/** A chip representing a single impacted cabin. */
export interface ImpactedCabinChip {
  name: string
  count: number
}

/**
 * Compute the list of impacted cabin chips from the "moved" entries.
 *
 * Each cabin that appears as either a From or a To is represented once.
 * The count is the number of distinct campers (by personCmId) whose move
 * touched that cabin — each camper counted once per cabin even if the move
 * makes them both leave AND arrive at that cabin (which can't happen for a
 * single move, but does happen when a cabin is both the from-bunk of one
 * camper and the to-bunk of another camper in the same list).
 *
 * Returned in ascending alphabetical order.
 *
 * @param visibleCabinNames  When provided (e.g. a gender-area filter is active in
 *   split view), only chips for cabins present in this set are returned. Chips for
 *   cabins outside the visible set are silently dropped, preventing dead chips that
 *   would scroll to nothing.  When omitted (or `undefined`), all cabins are included.
 */
export function computeImpactedCabins(
  moved: readonly MovedEntry[],
  visibleCabinNames?: ReadonlySet<string>
): ImpactedCabinChip[] {
  // Map from cabin name → set of personCmIds who touched that cabin
  const cabinCampers = new Map<string, Set<number>>()

  for (const entry of moved) {
    const { fromBunk, toBunk, camper } = entry

    const addToCabin = (cabin: string, id: number) => {
      const set = cabinCampers.get(cabin) ?? new Set<number>()
      set.add(id)
      cabinCampers.set(cabin, set)
    }
    addToCabin(fromBunk.name, camper.personCmId)
    addToCabin(toBunk.name, camper.personCmId)
  }

  return Array.from(cabinCampers.entries())
    .filter(([name]) => visibleCabinNames === undefined || visibleCabinNames.has(name))
    .map(([name, campers]) => ({ name, count: campers.size }))
    .sort((a, b) => a.name.localeCompare(b.name))
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
  return campers.slice().sort(compareCamperByName)
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
