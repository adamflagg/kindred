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

  // NOT a monotonicity claim: on real data the multi-cluster count rises from
  // 8 to 9 between 1x and 2x before falling. This pins one concrete spread.
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
