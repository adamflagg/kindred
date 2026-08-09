/**
 * A container unit's whole-house capacity, derived from its rooms — READ-ONLY.
 *
 * MIRRORS `_effective_sleeps` in `api/services/lodging_roster_service.py`
 * (owner ruling, kindred#2041; the admin affordance, kindred#2079). A third
 * mirror, `effectiveSleeps` in `frontend/src/components/weekend/rosterAttention.ts`,
 * implements the same arithmetic for the weekend roster's "unmeasured" chip
 * — this file could not import it directly: it is an unexported helper
 * inside a file this campaign was fenced off from touching (concurrent
 * sibling PRs owned `frontend/src/components/weekend/**` the night this
 * landed), so this is a THIRD copy by necessity, not by choice. If the
 * arithmetic changes in one place, change it in all three.
 *
 * NEVER WRITES `sleeps`. A container's own stored value is a DELTA — real
 * common-area furniture (a landing futon, in the one measured production
 * case) that no room row records — ADDED to the room sum, never replaced by
 * it. Writing Σ(rooms) into that field would make every consumer report
 * 2 × Σ(rooms). `ownDelta` is a parameter rather than a read off `units` so
 * a caller can feed the value staff are actively typing: the figure reacts
 * as they edit the field it sits beside, without this module reaching into
 * form state to do it.
 */
import type { LodgingUnitRecord } from '../../../types/lodging'
import { descendantIds } from './unitTree'

/**
 * Every ACTIVE leaf unit under `containerId`, walked past any intermediate
 * container — never just its immediate children. `descendantIds` already
 * recurses past every intermediate container; filtering its result down to
 * non-container, active rows is the leaf walk `leaf_codes_under` performs
 * server-side. A retired leaf is excluded outright: it adds no beds and
 * must not block a total either, in `derivedWholeHouseSleeps` below.
 *
 * Exported (not folded into `derivedWholeHouseSleeps`) so a caller can tell
 * "no rooms recorded yet" apart from "a room is unmeasured" — the admin form
 * uses that to decide whether showing a derived figure says anything a
 * childless container's own delta doesn't already say.
 */
export function activeLeavesUnder(
  containerId: string,
  units: LodgingUnitRecord[]
): LodgingUnitRecord[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  return [...descendantIds(containerId, units)]
    .map((id) => byId.get(id))
    .filter(
      (candidate): candidate is LodgingUnitRecord =>
        candidate !== undefined && !candidate.is_container && candidate.is_active
    )
}

/**
 * `ownDelta + Σ(active leaves under containerId)`. The registry is three
 * levels deep in production and every "derives to nothing" case under the
 * old immediate-children logic was a grandparent whose own children are
 * containers with `sleeps = 0`; the leaf walk in `activeLeavesUnder`
 * resolves those, which is the whole reason it recurses.
 *
 * Returns `null` — refuses to show a figure — when any active leaf beneath
 * the container has an unmeasured `sleeps` (PocketBase's only spelling of
 * "unmeasured" is `0`; it cannot store `NULL` in a number column). A
 * partial sum would understate capacity silently, which is worse than
 * showing nothing.
 *
 * Also returns `null` for the degenerate case — no own delta and no rooms —
 * where summing would otherwise produce 0, i.e. the confident claim "this
 * house sleeps nobody" rather than "nobody has measured this house yet".
 */
export function derivedWholeHouseSleeps(
  containerId: string,
  ownDelta: number,
  units: LodgingUnitRecord[]
): number | null {
  const leaves = activeLeavesUnder(containerId, units)

  if (leaves.some((leaf) => leaf.sleeps === 0)) return null
  if (ownDelta === 0 && leaves.length === 0) return null

  return ownDelta + leaves.reduce((total, leaf) => total + leaf.sleeps, 0)
}
