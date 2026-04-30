import { describe, it, expect } from 'vitest'
import {
  parseFilterFromSearchParams,
  serializeFilterToSearchParams,
  normalizeFilter,
  type BunkSummary,
} from './graphFilter'
import type { FilterState } from './graphFilter'

describe('parseFilterFromSearchParams', () => {
  it('returns empty filter when no params present', () => {
    const params = new URLSearchParams()
    expect(parseFilterFromSearchParams(params)).toEqual({
      units: [],
      bunks: [],
      edgeMode: 'strict',
    })
  })

  it('parses units from comma-separated slugs', () => {
    const params = new URLSearchParams('units=galil,eilat')
    const result = parseFilterFromSearchParams(params)
    expect(result.units).toEqual(['Galil', 'Eilat'])
    expect(result.bunks).toEqual([])
    expect(result.edgeMode).toBe('strict')
  })

  it('parses bunks as numeric cm_ids', () => {
    const params = new URLSearchParams('bunks=9,17')
    expect(parseFilterFromSearchParams(params).bunks).toEqual([9, 17])
  })

  it('parses edges=cross to edgeMode cross-scope', () => {
    const params = new URLSearchParams('edges=cross')
    expect(parseFilterFromSearchParams(params).edgeMode).toBe('cross-scope')
  })

  it('treats unknown unit slugs as drops, keeps the rest', () => {
    const params = new URLSearchParams('units=galil,nonexistent,eilat')
    expect(parseFilterFromSearchParams(params).units).toEqual(['Galil', 'Eilat'])
  })

  it('drops malformed bunk ids', () => {
    const params = new URLSearchParams('bunks=9,abc,17')
    expect(parseFilterFromSearchParams(params).bunks).toEqual([9, 17])
  })

  it('handles multi-word unit slugs (Chalutzim 1)', () => {
    const params = new URLSearchParams('units=chalutzim-1,chalutzim-2')
    expect(parseFilterFromSearchParams(params).units).toEqual(['Chalutzim 1', 'Chalutzim 2'])
  })
})

describe('serializeFilterToSearchParams', () => {
  it('omits all keys when filter is empty', () => {
    const base = new URLSearchParams('year=2026')
    const out = serializeFilterToSearchParams({ units: [], bunks: [], edgeMode: 'strict' }, base)
    expect(out.toString()).toBe('year=2026')
  })

  it('encodes units as lowercased slugs', () => {
    const out = serializeFilterToSearchParams(
      { units: ['Galil', 'Chalutzim 1'], bunks: [], edgeMode: 'strict' },
      new URLSearchParams()
    )
    expect(out.get('units')).toBe('galil,chalutzim-1')
  })

  it('encodes bunks as comma-separated cm_ids', () => {
    const out = serializeFilterToSearchParams(
      { units: [], bunks: [9, 17], edgeMode: 'strict' },
      new URLSearchParams()
    )
    expect(out.get('bunks')).toBe('9,17')
  })

  it('emits edges=cross only for cross-scope mode', () => {
    const a = serializeFilterToSearchParams(
      { units: ['Galil'], bunks: [], edgeMode: 'cross-scope' },
      new URLSearchParams()
    )
    expect(a.get('edges')).toBe('cross')
    const b = serializeFilterToSearchParams(
      { units: ['Galil'], bunks: [], edgeMode: 'strict' },
      new URLSearchParams()
    )
    expect(b.get('edges')).toBeNull()
  })

  it('preserves unrelated query params', () => {
    const base = new URLSearchParams('year=2026&scenario=abc')
    const out = serializeFilterToSearchParams(
      { units: ['Galil'], bunks: [9], edgeMode: 'cross-scope' },
      base
    )
    expect(out.get('year')).toBe('2026')
    expect(out.get('scenario')).toBe('abc')
  })

  it('round-trips with parseFilterFromSearchParams', () => {
    const original: FilterState = {
      units: ['Galil', 'Eilat'],
      bunks: [9],
      edgeMode: 'cross-scope',
    }
    const serialized = serializeFilterToSearchParams(original, new URLSearchParams())
    const parsed = parseFilterFromSearchParams(serialized)
    expect(parsed).toEqual(original)
  })
})

const ALL_BUNKS: BunkSummary[] = [
  { cmId: 1, name: 'B-3' }, // Galil
  { cmId: 2, name: 'G-3' }, // Galil
  { cmId: 3, name: 'B-4' }, // Galil
  { cmId: 4, name: 'G-4' }, // Galil
  { cmId: 5, name: 'B-5' }, // Eilat
  { cmId: 6, name: 'G-5' }, // Eilat
  { cmId: 9, name: 'B-9' }, // Chalutzim 1
]

describe('normalizeFilter', () => {
  it('drops bunks already covered by an included unit', () => {
    const result = normalizeFilter({ units: ['Galil'], bunks: [1, 9] }, ALL_BUNKS)
    expect(result.units).toEqual(['Galil'])
    expect(result.bunks).toEqual([9])
  })

  it('keeps bunks whose unit is not included', () => {
    const result = normalizeFilter({ units: ['Galil'], bunks: [9] }, ALL_BUNKS)
    expect(result.bunks).toEqual([9])
  })

  it("drops all of a unit's bunks when the unit is added", () => {
    const result = normalizeFilter({ units: ['Galil'], bunks: [1, 2, 3, 4, 9] }, ALL_BUNKS)
    expect(result.bunks).toEqual([9])
  })

  it('is a no-op when filter is empty', () => {
    expect(normalizeFilter({ units: [], bunks: [] }, ALL_BUNKS)).toEqual({
      units: [],
      bunks: [],
    })
  })

  it('preserves unknown bunk ids (not in roster) as-is', () => {
    const result = normalizeFilter({ units: ['Galil'], bunks: [999] }, ALL_BUNKS)
    expect(result.bunks).toEqual([999])
  })
})

import { buildBunkUnitMap, isNodeInScope, applyFilterToGraph } from './graphFilter'
import type { GraphNode } from '../../types/graph'

const NODE_GALIL: GraphNode = {
  id: 100,
  name: 'Emma Johnson',
  grade: 6,
  bunk_cm_id: 1,
  centrality: 0.5,
  clustering: 0.3,
  community: 0,
}
const NODE_EILAT: GraphNode = {
  id: 101,
  name: 'Liam Garcia',
  grade: 7,
  bunk_cm_id: 5,
  centrality: 0.5,
  clustering: 0.3,
  community: 0,
}
const NODE_NO_BUNK: GraphNode = {
  id: 102,
  name: 'Olivia Chen',
  grade: 8,
  bunk_cm_id: null,
  centrality: 0.5,
  clustering: 0.3,
  community: 0,
}

const BUNK_UNIT_MAP = buildBunkUnitMap([
  { cmId: 1, name: 'B-3' },
  { cmId: 5, name: 'B-5' },
  { cmId: 9, name: 'B-9' },
])

describe('buildBunkUnitMap', () => {
  it('maps bunk_cm_id → unit name', () => {
    expect(BUNK_UNIT_MAP.get(1)).toBe('Galil')
    expect(BUNK_UNIT_MAP.get(5)).toBe('Eilat')
    expect(BUNK_UNIT_MAP.get(9)).toBe('Chalutzim 1')
  })

  it('omits bunks whose name does not map to a unit', () => {
    const map = buildBunkUnitMap([{ cmId: 99, name: 'Unknown-99' }])
    expect(map.has(99)).toBe(false)
  })
})

describe('isNodeInScope', () => {
  it('returns true when filter is empty (full session)', () => {
    const filter = { units: [], bunks: [], edgeMode: 'strict' as const }
    expect(isNodeInScope(NODE_GALIL, filter, BUNK_UNIT_MAP)).toBe(true)
    expect(isNodeInScope(NODE_NO_BUNK, filter, BUNK_UNIT_MAP)).toBe(true)
  })

  it("returns true when node's unit is in scope", () => {
    const filter = { units: ['Galil'], bunks: [], edgeMode: 'strict' as const }
    expect(isNodeInScope(NODE_GALIL, filter, BUNK_UNIT_MAP)).toBe(true)
    expect(isNodeInScope(NODE_EILAT, filter, BUNK_UNIT_MAP)).toBe(false)
  })

  it("returns true when node's bunk is in scope", () => {
    const filter = { units: [], bunks: [5], edgeMode: 'strict' as const }
    expect(isNodeInScope(NODE_EILAT, filter, BUNK_UNIT_MAP)).toBe(true)
    expect(isNodeInScope(NODE_GALIL, filter, BUNK_UNIT_MAP)).toBe(false)
  })

  it('returns false for node without bunk_cm_id when filter is active', () => {
    const filter = { units: ['Galil'], bunks: [], edgeMode: 'strict' as const }
    expect(isNodeInScope(NODE_NO_BUNK, filter, BUNK_UNIT_MAP)).toBe(false)
  })
})

interface MockEle {
  id: string
  classes: Set<string>
  data: Record<string, unknown>
  source?: MockEle
  target?: MockEle
}
function makeNode(id: string, data: Record<string, unknown>): MockEle {
  return { id, classes: new Set(), data: { id, ...data } }
}
function makeEdge(id: string, source: MockEle, target: MockEle): MockEle {
  return {
    id,
    classes: new Set(),
    data: { id, source: source.id, target: target.id },
    source,
    target,
  }
}

function makeMockCy(nodes: MockEle[], edges: MockEle[]) {
  function ele(e: MockEle) {
    return {
      id: () => e.id,
      addClass: (cls: string) => {
        e.classes.add(cls)
        return ele(e)
      },
      removeClass: (cls: string) => {
        e.classes.delete(cls)
        return ele(e)
      },
      data: (k: string) => e.data[k],
      source: () => ele(e.source!),
      target: () => ele(e.target!),
      isNode: () => !e.source,
      isEdge: () => !!e.source,
    }
  }
  return {
    nodes: () => ({
      forEach: (fn: (n: ReturnType<typeof ele>) => void) => nodes.forEach((n) => fn(ele(n))),
      filter: (pred: (n: ReturnType<typeof ele>) => boolean) => nodes.map(ele).filter(pred),
    }),
    edges: () => ({
      forEach: (fn: (e: ReturnType<typeof ele>) => void) => edges.forEach((e) => fn(ele(e))),
    }),
    batch: (fn: () => void) => fn(),
    _nodes: nodes,
    _edges: edges,
  }
}

describe('applyFilterToGraph', () => {
  const bunkUnitMap = new Map<number, string>([
    [1, 'Galil'],
    [2, 'Galil'],
    [5, 'Eilat'],
    [9, 'Chalutzim 1'],
  ])

  it('clears classes when filter is empty', () => {
    const a = makeNode('a', { bunk_cm_id: 1 })
    a.classes.add('scope-hidden')
    const cy = makeMockCy([a], [])
    applyFilterToGraph(cy as never, {
      filter: { units: [], bunks: [], edgeMode: 'strict' },
      selectedNodeId: null,
      bunkUnitMap,
      prefersReducedMotion: false,
    })
    expect(a.classes.has('scope-hidden')).toBe(false)
  })

  it('hides out-of-scope nodes when filter is active', () => {
    const a = makeNode('100', { bunk_cm_id: 1, id: 100 }) // Galil — in scope
    const b = makeNode('200', { bunk_cm_id: 5, id: 200 }) // Eilat — out
    const cy = makeMockCy([a, b], [])
    applyFilterToGraph(cy as never, {
      filter: { units: ['Galil'], bunks: [], edgeMode: 'strict' },
      selectedNodeId: null,
      bunkUnitMap,
      prefersReducedMotion: false,
    })
    expect(a.classes.has('scope-hidden')).toBe(false)
    expect(b.classes.has('scope-hidden')).toBe(true)
  })

  it('hides cross-scope edges in strict mode', () => {
    const a = makeNode('100', { bunk_cm_id: 1, id: 100 })
    const b = makeNode('200', { bunk_cm_id: 5, id: 200 })
    const e = makeEdge('e1', a, b)
    const cy = makeMockCy([a, b], [e])
    applyFilterToGraph(cy as never, {
      filter: { units: ['Galil'], bunks: [], edgeMode: 'strict' },
      selectedNodeId: null,
      bunkUnitMap,
      prefersReducedMotion: false,
    })
    expect(e.classes.has('scope-hidden')).toBe(true)
  })

  it('keeps cross-scope edges and ghosts the partner in cross-scope mode', () => {
    const a = makeNode('100', { bunk_cm_id: 1, id: 100 }) // in
    const b = makeNode('200', { bunk_cm_id: 5, id: 200 }) // out
    const e = makeEdge('e1', a, b)
    const cy = makeMockCy([a, b], [e])
    applyFilterToGraph(cy as never, {
      filter: { units: ['Galil'], bunks: [], edgeMode: 'cross-scope' },
      selectedNodeId: null,
      bunkUnitMap,
      prefersReducedMotion: false,
    })
    expect(e.classes.has('scope-hidden')).toBe(false)
    expect(b.classes.has('scope-ghost')).toBe(true)
    expect(b.classes.has('scope-hidden')).toBe(false)
  })

  it('keeps the selected node visible even when out of scope', () => {
    const a = makeNode('100', { bunk_cm_id: 1, id: 100 })
    const b = makeNode('200', { bunk_cm_id: 5, id: 200 })
    const cy = makeMockCy([a, b], [])
    applyFilterToGraph(cy as never, {
      filter: { units: ['Galil'], bunks: [], edgeMode: 'strict' },
      selectedNodeId: 200,
      bunkUnitMap,
      prefersReducedMotion: false,
    })
    expect(b.classes.has('scope-hidden')).toBe(false)
    expect(b.classes.has('scope-ghost')).toBe(false)
  })
})
