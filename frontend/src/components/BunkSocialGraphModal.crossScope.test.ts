/**
 * Tests for cross-border edge toggle on the individual bunk graph (Feature B — #1606, #1610).
 *
 * Exercises `buildBunkGraphElements` — the SAME element-building code the
 * BunkSocialGraphModal init effect uses to populate cytoscape. Previously this
 * suite drove `createGraphElements` (the SESSION graph builder), which the bunk
 * modal never calls, so the shipped per-bunk cross-scope rendering was untested
 * (Finding 5). The modal now delegates to `buildBunkGraphElements`, so asserting
 * against it covers the real code path.
 *
 * Tests the pure data path — not the cytoscape rendering itself.
 */
import { describe, it, expect } from 'vitest'
import {
  buildBunkGraphElements,
  type BunkGraphCrossScopeEdgeInput,
  type BunkGraphEdgeInput,
  type BunkGraphElementsInput,
  type BunkGraphNodeInput,
} from './bunkGraphStyles'

// Deterministic RNG so positions don't vary between runs.
const FIXED_RNG = () => 0.5

// In-scope bunk members (fictional names per CLAUDE.md)
const IN_SCOPE_NODES: BunkGraphNodeInput[] = [
  {
    id: 10,
    name: 'Emma Johnson',
    grade: 5,
    centrality: 0.5,
    clustering: 0.3,
    community: 1,
    first_year: false,
  },
  {
    id: 11,
    name: 'Liam Garcia',
    grade: 5,
    centrality: 0.4,
    clustering: 0.2,
    community: 1,
    first_year: false,
  },
]

// In-scope edge (both endpoints in this bunk)
const IN_SCOPE_EDGE: BunkGraphEdgeInput = {
  source: 10,
  target: 11,
  edge_type: 'request',
  weight: 1,
  reciprocal: false,
  request_type: 'bunk_with',
  confidence: 0.9,
}

// Out-of-scope ghost node (a camper in a different bunk)
const GHOST_NODE: BunkGraphNodeInput = {
  id: 99,
  name: 'Olivia Chen',
  grade: 5,
  centrality: 0.1,
  clustering: 0.0,
  community: null,
  first_year: false,
}

// Cross-scope edge: Emma (in scope) → Olivia (out of scope)
const CROSS_EDGE: BunkGraphCrossScopeEdgeInput = {
  source: 10,
  target: 99,
  edge_type: 'request',
  weight: 1,
  request_type: 'bunk_with',
  confidence: 0.8,
  reciprocal: false,
  cross_scope: true,
}

function makeInput(extra: Partial<BunkGraphElementsInput> = {}): BunkGraphElementsInput {
  return { nodes: IN_SCOPE_NODES, edges: [IN_SCOPE_EDGE], ...extra }
}

const edgesOf = (els: ReturnType<typeof buildBunkGraphElements>) =>
  els.filter((e) => e.group === 'edges')
const nodesOf = (els: ReturnType<typeof buildBunkGraphElements>) =>
  els.filter((e) => e.group === 'nodes')

describe('buildBunkGraphElements — bunk graph cross-scope rendering (#1606, #1610)', () => {
  it('with cross-scope toggle OFF, only in-scope nodes/edges are emitted', () => {
    const els = buildBunkGraphElements(makeInput(), false, FIXED_RNG)
    const edges = edgesOf(els)
    const nodes = nodesOf(els)

    expect(edges).toHaveLength(1)
    expect(edges[0]?.data['cross_scope']).toBeFalsy()
    // No ghost node for the out-of-bunk camper.
    expect(nodes.find((n) => n.data.id === 'node-99')).toBeUndefined()
    // The two in-bunk campers are present.
    expect(nodes.find((n) => n.data.id === 'node-10')).toBeDefined()
    expect(nodes.find((n) => n.data.id === 'node-11')).toBeDefined()
  })

  it('with toggle ON and cross-scope data, the boundary edge is emitted tagged cross_scope=true', () => {
    const els = buildBunkGraphElements(
      makeInput({ cross_scope_edges: [CROSS_EDGE], cross_scope_nodes: [GHOST_NODE] }),
      true,
      FIXED_RNG
    )
    const edges = edgesOf(els)
    expect(edges).toHaveLength(2)

    const crossEdge = edges.find((e) => e.data.target === 'node-99')
    expect(crossEdge).toBeDefined()
    expect(crossEdge?.data['cross_scope']).toBe(true)
    expect(crossEdge?.data['edge_type']).toBe('request')
    expect(crossEdge?.data['request_type']).toBe('bunk_with')
  })

  it('with toggle ON, the ghost node is emitted tagged cross_scope=true', () => {
    const els = buildBunkGraphElements(
      makeInput({ cross_scope_edges: [CROSS_EDGE], cross_scope_nodes: [GHOST_NODE] }),
      true,
      FIXED_RNG
    )
    const ghost = nodesOf(els).find((n) => n.data.id === 'node-99')
    expect(ghost).toBeDefined()
    expect(ghost?.data['cross_scope']).toBe(true)
    expect(ghost?.data['fullName']).toBe('Olivia Chen')
  })

  it('ghost node label shows the camper name AND their current bunk assignment', () => {
    const ghostWithBunk: BunkGraphNodeInput = { ...GHOST_NODE, bunk_name: 'B-3' }
    const els = buildBunkGraphElements(
      makeInput({ cross_scope_edges: [CROSS_EDGE], cross_scope_nodes: [ghostWithBunk] }),
      true,
      FIXED_RNG
    )
    const ghost = nodesOf(els).find((n) => n.data.id === 'node-99')
    const label = String(ghost?.data['label'] ?? '')
    expect(label).toContain('Olivia Chen')
    expect(label).toContain('B-3')
  })

  it('ghost node label omits the bunk line when no bunk name is present', () => {
    const els = buildBunkGraphElements(
      makeInput({ cross_scope_edges: [CROSS_EDGE], cross_scope_nodes: [GHOST_NODE] }),
      true,
      FIXED_RNG
    )
    const ghost = nodesOf(els).find((n) => n.data.id === 'node-99')
    const label = String(ghost?.data['label'] ?? '')
    expect(label).toContain('Olivia Chen')
    // No trailing arrow/bunk separator when bunk_name is absent.
    expect(label).not.toContain('→')
  })

  it('toggle ON but NO cross-scope data present → no ghost elements (matches modal guard)', () => {
    // The modal only appends ghost elements when both cross_scope_nodes AND
    // cross_scope_edges are present. With neither, the result is the in-scope-only graph.
    const els = buildBunkGraphElements(makeInput(), true, FIXED_RNG)
    expect(edgesOf(els)).toHaveLength(1)
    expect(nodesOf(els).find((n) => n.data.id === 'node-99')).toBeUndefined()
  })

  it('toggle OFF ignores cross-scope data even when supplied', () => {
    const els = buildBunkGraphElements(
      makeInput({ cross_scope_edges: [CROSS_EDGE], cross_scope_nodes: [GHOST_NODE] }),
      false,
      FIXED_RNG
    )
    expect(edgesOf(els)).toHaveLength(1)
    expect(nodesOf(els).find((n) => n.data.id === 'node-99')).toBeUndefined()
  })

  it('does not duplicate a ghost node that is already an in-scope member', () => {
    // Defensive: if the same camper appears both in-scope and as a ghost, only
    // the in-scope node is kept (the modal guards against double-adding).
    const dupGhost: BunkGraphNodeInput = { ...GHOST_NODE, id: 10, name: 'Emma Johnson' }
    const dupEdge: BunkGraphCrossScopeEdgeInput = { ...CROSS_EDGE, target: 10 }
    const els = buildBunkGraphElements(
      makeInput({ cross_scope_edges: [dupEdge], cross_scope_nodes: [dupGhost] }),
      true,
      FIXED_RNG
    )
    const node10s = nodesOf(els).filter((n) => n.data.id === 'node-10')
    expect(node10s).toHaveLength(1)
    // The retained node is the real in-scope one (not ghost-tagged).
    expect(node10s[0]?.data['cross_scope']).toBeFalsy()
  })

  it('first-year campers get the first-year class; isolated campers get the isolated class', () => {
    const firstYearNode: BunkGraphNodeInput = { ...IN_SCOPE_NODES[0]!, id: 20, first_year: true }
    const isolatedNode: BunkGraphNodeInput = { ...IN_SCOPE_NODES[0]!, id: 21 }
    const els = buildBunkGraphElements(
      { nodes: [firstYearNode, isolatedNode], edges: [] },
      false,
      FIXED_RNG
    )
    const fy = nodesOf(els).find((n) => n.data.id === 'node-20')
    const iso = nodesOf(els).find((n) => n.data.id === 'node-21')
    expect(fy?.classes).toContain('first-year')
    expect(iso?.classes).toContain('isolated')
  })
})
