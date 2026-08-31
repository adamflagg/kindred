/**
 * Single-link proximity clustering in SCREEN space, WITHIN A BUILDING.
 *
 * Geometry-only for its distance test, but no longer geometry-alone for its
 * partition: a `group` on each placing is a barrier nothing crosses. That is
 * kindred#2440's Q3, ruled 2026-08-24 — two different buildings a few pixels
 * apart must never be drawn as one mark, and on the production registry
 * proximity alone merged four such pairs at rest. Zoom is what resolves the
 * overlap that leaves behind; the mark count is not the thing being minimised.
 *
 * ⚠️ Grouping is the CALLER's word, not this module's. `LodgingMap` passes
 * `MapUnit.buildingCode`, which `mapModel` resolves through `buildingKey` —
 * the grain kindred#2008 ruled. Deriving a second answer here is how the
 * product ends up with two different "buildings". An ABSENT group means one
 * shared building, so a caller with nothing to say keeps pure geometry.
 *
 * WHAT THE RADIUS STILL DECIDES, now that it decides less. Since #2440 the
 * rooms of one building resolve to ONE point, so they are coincident and
 * cluster at every zoom — the fusion survives zoom, which is the change #2440
 * actually makes. The radius therefore only separates same-group marks in the
 * one case where the resolution falls back: a building nobody has positioned,
 * whose rooms keep their own scattered points. Unreachable on the 2026
 * registry (118 of 118 positioned) and kept because it is what makes the
 * fallback safe rather than lucky.
 *
 * ⛔ The old header claimed `parent_unit` "is absent from the roster payload
 * and read nowhere in `api/`", and used that to justify grouping by position.
 * It was stale when #2440 was filed: the payload carries `parent_code`
 * (`api/schemas/lodging.py`, populated in `lodging_roster_service.py`), and
 * the relation was already on the client. The relation is now what groups.
 *
 * Single link rather than centroid link because a terrace of rooms is one
 * building: each room is close to its neighbour and the ends may be far apart.
 * The partition is therefore the connected components of the radius graph,
 * which is order-invariant — see the merge in the loop, and the ordering test.
 */

/** An item with a screen position, and the building it belongs to. */
export interface Placed<T> {
  item: T
  x: number
  y: number
  /**
   * Marks carrying different groups NEVER merge, however close they sit.
   *
   * Optional because this module stays usable as plain geometry: `undefined`
   * equals `undefined`, so a caller that names no building gets one shared
   * building and the pre-#2440 behaviour exactly.
   */
  group?: string
}

export interface Cluster<T> {
  members: Array<Placed<T>>
  /** Mean of the members' positions. */
  x: number
  y: number
}

/** A pin is 16px plus its halo, so anything closer than this is one blob. */
export const CLUSTER_RADIUS_PX = 18

export function clusterByProximity<T>(
  items: Array<Placed<T>>,
  radiusPx: number = CLUSTER_RADIUS_PX
): Array<Cluster<T>> {
  const groups: Array<Array<Placed<T>>> = []

  for (const candidate of items) {
    // The building test comes FIRST, and it is a barrier rather than a
    // tie-break: no distance, not even zero, merges two buildings. Testing
    // only the group of each member is sound because every group in `groups`
    // is homogeneous by induction — a member only ever joins a group it
    // matched, so the invariant holds from the first insertion.
    const near = (member: Placed<T>) =>
      member.group === candidate.group &&
      Math.hypot(member.x - candidate.x, member.y - candidate.y) <= radiusPx
    const touched = groups.filter((group) => group.some(near))

    const target = touched[0]
    if (target === undefined) {
      groups.push([candidate])
      continue
    }

    // Merge EVERY group the candidate touches, not just the first. A candidate
    // can BRIDGE two existing groups, and joining only the first match makes
    // the result depend on the order items arrive in: the same three points
    // partition three different ways. The payload's unit order is a database
    // query result and is not guaranteed stable, so that would show up as a
    // building silently regrouping between loads.
    target.push(candidate)
    for (const other of touched.slice(1)) {
      target.push(...other)
      groups.splice(groups.indexOf(other), 1)
    }
  }

  return groups.map((members) => ({
    members,
    x: members.reduce((sum, member) => sum + member.x, 0) / members.length,
    y: members.reduce((sum, member) => sum + member.y, 0) / members.length,
  }))
}
