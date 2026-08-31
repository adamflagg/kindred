import { describe, expect, it } from 'vitest'

import { CLUSTER_RADIUS_PX, clusterByProximity, type Placed } from './mapClustering'

function at(name: string, x: number, y: number): Placed<string> {
  return { item: name, x, y }
}

describe('clusterByProximity', () => {
  it('leaves a lone point as a cluster of one', () => {
    const clusters = clusterByProximity([at('a', 10, 10)])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.members.map((m) => m.item)).toEqual(['a'])
  })

  it('merges points inside the radius', () => {
    const clusters = clusterByProximity([at('a', 100, 100), at('b', 105, 100)])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.members).toHaveLength(2)
  })

  it('keeps points outside the radius apart', () => {
    const clusters = clusterByProximity([at('a', 100, 100), at('b', 400, 400)])
    expect(clusters).toHaveLength(2)
  })

  it('places a cluster at the mean of its members', () => {
    const clusters = clusterByProximity([at('a', 100, 200), at('b', 110, 210)])
    expect(clusters[0]?.x).toBeCloseTo(105, 6)
    expect(clusters[0]?.y).toBeCloseTo(205, 6)
  })

  it('chains through a neighbour, because a row of rooms is one building', () => {
    // a-b and b-c are each inside the radius; a-c is not. Single-link is what
    // makes a terrace of rooms read as one structure.
    const clusters = clusterByProximity([at('a', 0, 0), at('b', 15, 0), at('c', 30, 0)])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.members).toHaveLength(3)
  })

  // NOT a monotonicity claim. A fragmenting component can yield several
  // still-multi-member components, so the count is not guaranteed to fall at
  // every step. This pins one concrete spread instead.
  it('dissolves clusters as positions spread, which is what zoom does', () => {
    const tight = [at('a', 100, 100), at('b', 108, 100), at('c', 400, 400)]
    const spread = tight.map((p) => at(p.item, p.x * 8, p.y * 8))
    const multi = (cs: ReturnType<typeof clusterByProximity<string>>) =>
      cs.filter((c) => c.members.length > 1).length
    expect(multi(clusterByProximity(tight))).toBe(1)
    expect(multi(clusterByProximity(spread))).toBe(0)
  })

  it('is independent of input order, because a bridge can arrive last', () => {
    // A---C---B, with A-C and C-B inside the radius but A-B outside. C bridges
    // them, so all three are one cluster whatever order they arrive in.
    // A greedy pass that joins only the FIRST matching group gets two of these
    // three orderings wrong — same points, different answer — which in
    // production means a building regrouping itself between payloads.
    const A = at('a', 0, 0)
    const C = at('c', 15, 0)
    const B = at('b', 30, 0)
    const partition = (items: Array<Placed<string>>) =>
      clusterByProximity(items)
        .map((cluster) =>
          cluster.members
            .map((m) => m.item)
            .sort()
            .join('')
        )
        .sort()
    expect(partition([A, C, B])).toEqual(['abc'])
    expect(partition([A, B, C])).toEqual(['abc'])
    expect(partition([B, A, C])).toEqual(['abc'])
  })

  it('is deterministic, so a hue and a popup do not jump between renders', () => {
    const input = [at('a', 0, 0), at('b', 10, 0), at('c', 500, 500)]
    const once = clusterByProximity(input).map((c) => c.members.map((m) => m.item))
    const twice = clusterByProximity(input).map((c) => c.members.map((m) => m.item))
    expect(once).toEqual(twice)
  })

  it('honours an explicit radius', () => {
    const points = [at('a', 0, 0), at('b', CLUSTER_RADIUS_PX * 3, 0)]
    expect(clusterByProximity(points)).toHaveLength(2)
    expect(clusterByProximity(points, CLUSTER_RADIUS_PX * 4)).toHaveLength(1)
  })
})

/**
 * kindred#2440 — the map is a view of BUILDINGS.
 *
 * Q3, ruled 2026-08-24: two different buildings that sit a few pixels apart
 * must never be drawn as one mark. Proximity alone used to decide that, and on
 * the production registry it merged four pairs of genuinely different
 * buildings at rest. The group key is the barrier.
 */
describe('clusterByProximity — the building barrier (kindred#2440)', () => {
  function inBuilding(name: string, x: number, y: number, group: string): Placed<string> {
    return { item: name, x, y, group }
  }

  it('never merges two different buildings, however close they sit', () => {
    // One pixel apart — far inside the radius, and merged before #2440.
    const clusters = clusterByProximity([
      inBuilding('a', 100, 100, 'oak'),
      inBuilding('b', 101, 100, 'elm'),
    ])
    expect(clusters).toHaveLength(2)
  })

  it('holds one building together at any zoom, because its rooms are coincident', () => {
    // Radius 0 stands in for infinite zoom: the rooms of one building resolve
    // to ONE point (mapModel's building pin), so nothing can pull them apart.
    const clusters = clusterByProximity(
      [inBuilding('a', 100, 100, 'oak'), inBuilding('b', 100, 100, 'oak')],
      0
    )
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.members).toHaveLength(2)
  })

  it('still chains within one building, so a terrace stays one mark', () => {
    const clusters = clusterByProximity([
      inBuilding('a', 0, 0, 'oak'),
      inBuilding('b', 15, 0, 'oak'),
      inBuilding('c', 30, 0, 'oak'),
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.members).toHaveLength(3)
  })

  it('does not let one building bridge two others', () => {
    // a---c---b in space, but c belongs to a third building. Without the
    // barrier single-link chaining fuses all three into one mark.
    const clusters = clusterByProximity([
      inBuilding('a', 0, 0, 'oak'),
      inBuilding('c', 15, 0, 'elm'),
      inBuilding('b', 30, 0, 'ash'),
    ])
    expect(clusters).toHaveLength(3)
  })

  it('is still order-independent once buildings are in play', () => {
    const A = inBuilding('a', 0, 0, 'oak')
    const C = inBuilding('c', 15, 0, 'oak')
    const B = inBuilding('b', 30, 0, 'elm')
    const partition = (items: Array<Placed<string>>) =>
      clusterByProximity(items)
        .map((cluster) =>
          cluster.members
            .map((m) => m.item)
            .sort()
            .join('')
        )
        .sort()
    expect(partition([A, C, B])).toEqual(['ac', 'b'])
    expect(partition([B, A, C])).toEqual(['ac', 'b'])
    expect(partition([C, B, A])).toEqual(['ac', 'b'])
  })

  it('treats an absent group as one shared building, so geometry still decides', () => {
    // The generic contract the eight tests above rest on: no group, no barrier.
    const clusters = clusterByProximity([
      { item: 'a', x: 100, y: 100 },
      { item: 'b', x: 105, y: 100 },
    ])
    expect(clusters).toHaveLength(1)
  })
})
