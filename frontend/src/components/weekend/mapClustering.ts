/**
 * Single-link proximity clustering in SCREEN space.
 *
 * Generic and geometry-only on purpose: it knows nothing about units, and
 * needs no relation to work. `parent_unit` — the obvious way to group rooms
 * into their building — is absent from the roster payload and read nowhere in
 * `api/`, so grouping is done by where things actually are.
 *
 * Because the radius is in SCREEN pixels, zooming in dissolves clusters: no
 * separate expand state, and the same code answers "what overlaps" at every
 * zoom. Measured on the real registry at a 1000px canvas: 8 multi-room
 * clusters at 1x, 9 at 2x, 5 at 3x, 3 at 4x, 2 at 6x, 1 at 8x, none at 12x.
 * It RISES before it falls — single-link chaining splits one blob into several
 * still-multi-member clusters — so this is not a monotonic property.
 *
 * Single link rather than centroid link because a terrace of rooms is one
 * building: each room is close to its neighbour and the ends may be far apart.
 * The partition is therefore the connected components of the radius graph,
 * which is order-invariant — see the merge in the loop, and the ordering test.
 */

/** An item with a screen position. */
export interface Placed<T> {
  item: T
  x: number
  y: number
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
    const near = (member: Placed<T>) =>
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
