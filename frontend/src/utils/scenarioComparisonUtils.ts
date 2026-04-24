/**
 * Helpers for the scenario comparison page (ScenarioComparisonPage.tsx).
 *
 * Kept as pure, dependency-free functions so they can be unit tested without
 * mocking PocketBase, React Query, auth, or the router.
 */

// ---------------------------------------------------------------------------
// Locked-group diff types
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

/** Pair of matching groups from left and right scenarios. */
export interface MatchedGroupPair {
  left: LockGroupSummary
  right: LockGroupSummary
}

/** Result of diffing locked groups across two scenarios. */
export interface GroupDiffResult {
  /** Total group count from the left scenario. */
  leftCount: number
  /** Total group count from the right scenario. */
  rightCount: number
  /** Groups whose member CM_ID sets are exactly equal on both sides. */
  identical: MatchedGroupPair[]
  /** Left-scenario groups that share NO members with any right-scenario group. */
  uniqueL: LockGroupSummary[]
  /** Right-scenario groups that share NO members with any left-scenario group. */
  uniqueR: LockGroupSummary[]
  /** Groups that share at least one member but differ (partial overlap). */
  modified: MatchedGroupPair[]
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

// ---------------------------------------------------------------------------
// diffGroups
// ---------------------------------------------------------------------------

/**
 * Classify locked groups from two scenarios into identical, uniqueL, uniqueR,
 * and modified buckets.
 *
 * Matching is done by CM_ID member sets:
 * - **identical**: same exact set of member CM IDs on both sides.
 * - **uniqueL / uniqueR**: no overlap at all with any group on the other side.
 * - **modified**: at least one shared member, but the sets differ.
 *
 * Each left group is matched to at most one right group (the one with the
 * greatest overlap, preferring exact matches). Unmatched right groups become
 * uniqueR.
 *
 * Pure function — no side effects, no I/O.
 */
export function diffGroups(
  leftGroups: readonly LockGroupSummary[],
  rightGroups: readonly LockGroupSummary[]
): GroupDiffResult {
  const result: GroupDiffResult = {
    leftCount: leftGroups.length,
    rightCount: rightGroups.length,
    identical: [],
    uniqueL: [],
    uniqueR: [],
    modified: [],
  }

  // Build a set of CM IDs for each right group (for O(1) membership tests).
  const rightSets: Array<Set<number>> = rightGroups.map((g) => new Set(g.memberCmIds))

  // Track which right groups have been claimed by a left group.
  const rightClaimed = new Set<number>()

  for (const leftGrp of leftGroups) {
    const leftSet = new Set(leftGrp.memberCmIds)

    // Empty groups can never overlap with anything — treat as unique-left.
    // This also prevents `overlap === leftSet.size` (0 === 0) from falsely
    // marking two empty groups as identical.
    if (leftSet.size === 0) {
      result.uniqueL.push(leftGrp)
      continue
    }

    // Find the best matching right group: prefer exact match, then most overlap.
    let bestIdx = -1
    let bestOverlap = 0
    let bestIsExact = false

    for (const [i, rSet] of rightSets.entries()) {
      if (rightClaimed.has(i)) continue

      // Count intersection
      let overlap = 0
      for (const id of leftSet) {
        if (rSet.has(id)) overlap++
      }
      if (overlap === 0) continue

      const isExact = overlap === leftSet.size && overlap === rSet.size

      if (bestIdx === -1 || (isExact && !bestIsExact) || (!bestIsExact && overlap > bestOverlap)) {
        bestIdx = i
        bestOverlap = overlap
        bestIsExact = isExact
      }
    }

    if (bestIdx === -1) {
      // No right group shares any member — unique to left.
      result.uniqueL.push(leftGrp)
    } else {
      // bestIdx is always a valid index: it was set from rightSets.entries().
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const rightGrp = rightGroups[bestIdx]!
      if (bestIsExact) {
        result.identical.push({ left: leftGrp, right: rightGrp })
      } else {
        result.modified.push({ left: leftGrp, right: rightGrp })
      }
      rightClaimed.add(bestIdx)
    }
  }

  // Any unclaimed right groups are unique to right.
  for (const [i, rightGrp] of rightGroups.entries()) {
    if (!rightClaimed.has(i)) {
      result.uniqueR.push(rightGrp)
    }
  }

  return result
}
