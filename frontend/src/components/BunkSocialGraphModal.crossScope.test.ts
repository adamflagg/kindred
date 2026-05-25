/**
 * Tests for cross-border edge toggle on the individual bunk graph (Feature B — #1606, #1610).
 *
 * Verifies that the bunk graph modal surface reuses the existing cross-scope
 * infra (createGraphElements) to include/exclude cross-scope edges and ghost
 * nodes when the "requests outside of current bunk" checkbox is toggled.
 *
 * Tests the pure predicate / data path — not the cytoscape rendering.
 */
import { describe, it, expect } from 'vitest'
import { createGraphElements } from './graph/cytoscapeStyles'
import type { GraphNodeData, GraphEdgeData, CrossScopeEdgeData } from './graph/cytoscapeStyles'

// Minimal in-scope bunk members (fictional names per CLAUDE.md)
const IN_SCOPE_NODES: GraphNodeData[] = [
  {
    id: 10,
    name: 'Emma Johnson',
    grade: 5,
    centrality: 0.5,
    clustering: 0.3,
    satisfaction_status: 'satisfied',
    bunk_cm_id: 200,
    community: 1,
    first_year: false,
  },
  {
    id: 11,
    name: 'Liam Garcia',
    grade: 5,
    centrality: 0.4,
    clustering: 0.2,
    satisfaction_status: 'no_requests',
    bunk_cm_id: 200,
    community: 1,
    first_year: false,
  },
]

// In-scope edge (both endpoints in bunk 200)
const IN_SCOPE_EDGE: GraphEdgeData = {
  source: 10,
  target: 11,
  edge_type: 'request',
  weight: 1,
  reciprocal: false,
  request_type: 'bunk_with',
  confidence: 0.9,
  metadata: {},
  cross_scope: false,
}

// Out-of-scope node (in a different bunk — bunk 999)
const GHOST_NODE: GraphNodeData = {
  id: 99,
  name: 'Olivia Chen',
  grade: 5,
  centrality: 0.1,
  clustering: 0.0,
  satisfaction_status: 'no_requests',
  bunk_cm_id: 999,
  community: null,
  first_year: false,
}

// Cross-scope edge: Emma (in scope) → Olivia (out of scope)
const CROSS_EDGE: CrossScopeEdgeData = {
  source: 10,
  target: 99,
  edge_type: 'request',
  weight: 1,
  request_type: 'bunk_with',
  confidence: 0.8,
  reciprocal: false,
  cross_scope: true,
}

const BUNKS_DATA = { 200: 'B-5', 999: 'B-7' }
const SHOW_EDGES = { request: true } as const

describe('cross-scope edge infra — bunk graph reuse (#1606, #1610)', () => {
  it('without cross-scope data, only in-scope edge is emitted', () => {
    const { edges, nodes } = createGraphElements(
      IN_SCOPE_NODES,
      [IN_SCOPE_EDGE],
      BUNKS_DATA,
      SHOW_EDGES
    )
    expect(edges).toHaveLength(1)
    expect(edges[0]?.data.cross_scope).toBeFalsy()
    // Ghost node should not appear
    const ghostCamper = nodes.find((n) => n.data.id === '99')
    expect(ghostCamper).toBeUndefined()
  })

  it('with cross-scope data threaded through, cross-scope edge is emitted tagged cross_scope=true', () => {
    const { edges } = createGraphElements(
      IN_SCOPE_NODES,
      [IN_SCOPE_EDGE],
      BUNKS_DATA,
      SHOW_EDGES,
      [CROSS_EDGE],
      [GHOST_NODE]
    )
    expect(edges).toHaveLength(2)
    const crossEdge = edges.find((e) => e.data.target === '99')
    expect(crossEdge).toBeDefined()
    expect(crossEdge?.data.cross_scope).toBe(true)
    expect(crossEdge?.data.edge_type).toBe('request')
  })

  it('ghost node is present and tagged cross_scope=true when cross-scope data provided', () => {
    const { nodes } = createGraphElements(
      IN_SCOPE_NODES,
      [IN_SCOPE_EDGE],
      BUNKS_DATA,
      SHOW_EDGES,
      [CROSS_EDGE],
      [GHOST_NODE]
    )
    const ghostCamper = nodes.find((n) => n.data.id === '99')
    expect(ghostCamper).toBeDefined()
    expect(ghostCamper?.data.cross_scope).toBe(true)
    expect(ghostCamper?.data.name).toBe('Olivia Chen')
  })

  it('ghost bunk parent compound is created and tagged cross_scope when only ghost campers are in it', () => {
    const { parentNodes } = createGraphElements(
      IN_SCOPE_NODES,
      [IN_SCOPE_EDGE],
      BUNKS_DATA,
      SHOW_EDGES,
      [CROSS_EDGE],
      [GHOST_NODE]
    )
    const ghostParent = parentNodes.find((p) => p.data.id === 'bunk-999')
    expect(ghostParent).toBeDefined()
    expect(ghostParent?.data.cross_scope).toBe(true)
  })

  it('omitting cross-scope args (toggle OFF) produces same result as not providing them at all', () => {
    // When the toggle is off, the modal passes undefined for cross-scope args —
    // verifies the toggle=off code path doesn't accidentally show ghost data.
    const withoutArgs = createGraphElements(IN_SCOPE_NODES, [IN_SCOPE_EDGE], BUNKS_DATA, SHOW_EDGES)
    const withUndefined = createGraphElements(
      IN_SCOPE_NODES,
      [IN_SCOPE_EDGE],
      BUNKS_DATA,
      SHOW_EDGES,
      undefined,
      undefined
    )
    expect(withoutArgs.edges).toHaveLength(1)
    expect(withUndefined.edges).toHaveLength(1)
    expect(withoutArgs.edges[0]?.data.cross_scope).toBeFalsy()
    expect(withUndefined.edges[0]?.data.cross_scope).toBeFalsy()
  })

  it('cross-scope edges respect showEdges — when request edges hidden, cross-scope request edges also hidden', () => {
    // Mirrors the cytoscapeStyles.test.ts "#1556" test: showEdges filter must
    // apply to both in-scope and cross-scope passes.
    const { edges } = createGraphElements(
      IN_SCOPE_NODES,
      [IN_SCOPE_EDGE],
      BUNKS_DATA,
      { request: false },
      [CROSS_EDGE],
      [GHOST_NODE]
    )
    expect(edges).toHaveLength(0)
  })
})
