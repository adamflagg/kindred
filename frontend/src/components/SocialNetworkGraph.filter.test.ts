import { describe, it, expect } from 'vitest'
import { applyFilterToGraph, buildBunkUnitMap } from './graph/graphFilter'
import type { Core } from 'cytoscape'

describe('SocialNetworkGraph filter pipeline (logic-level)', () => {
  it('selection survival: out-of-scope selected node stays in inScopeNodeIds', () => {
    const nodes = [
      { id: '100', data: { id: 100, bunk_cm_id: 1 }, classes: new Set<string>() },
      { id: '200', data: { id: 200, bunk_cm_id: 5 }, classes: new Set<string>() },
    ]
    const edges: Array<{
      id: string
      classes: Set<string>
      src: (typeof nodes)[0]
      tgt: (typeof nodes)[0]
    }> = []
    const cy = makeStubCy(nodes, edges)
    const bunkUnitMap = buildBunkUnitMap([
      { cmId: 1, name: 'B-3' },
      { cmId: 5, name: 'B-5' },
    ])
    const result = applyFilterToGraph(cy, {
      filter: { units: ['Galil'], bunks: [], edgeMode: 'strict' },
      selectedNodeId: 200,
      bunkUnitMap,
      prefersReducedMotion: false,
    })
    expect(result.inScopeNodeIds.has('200')).toBe(true)
    expect(nodes[1]!.classes.has('scope-hidden')).toBe(false)
  })
})

function makeStubCy(
  nodes: Array<{ id: string; data: Record<string, unknown>; classes: Set<string> }>,
  edges: Array<{
    id: string
    classes: Set<string>
    src: (typeof nodes)[0]
    tgt: (typeof nodes)[0]
  }>
): Core {
  function nele(n: (typeof nodes)[0]) {
    return {
      id: () => n.id,
      data: (k: string) => n.data[k],
      addClass: (c: string) => {
        n.classes.add(c)
        return nele(n)
      },
      removeClass: (c: string) => {
        n.classes.delete(c)
        return nele(n)
      },
    }
  }
  function eele(e: (typeof edges)[0]) {
    return {
      id: () => e.id,
      addClass: (c: string) => {
        e.classes.add(c)
        return eele(e)
      },
      removeClass: (c: string) => {
        e.classes.delete(c)
        return eele(e)
      },
      source: () => nele(e.src),
      target: () => nele(e.tgt),
    }
  }
  return {
    nodes: () => ({
      forEach: (fn: (n: ReturnType<typeof nele>) => void) => nodes.forEach((n) => fn(nele(n))),
    }),
    edges: () => ({
      forEach: (fn: (e: ReturnType<typeof eele>) => void) => edges.forEach((e) => fn(eele(e))),
    }),
    batch: (fn: () => void) => fn(),
  } as unknown as Core
}
