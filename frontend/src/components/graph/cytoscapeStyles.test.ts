/**
 * Tests for Cytoscape styles and graph data transformations
 */
import { describe, it, expect } from 'vitest'
import type { NodeSingular } from 'cytoscape'
import {
  getCytoscapeStyles,
  createGraphElements,
  type GraphNodeData,
  type GraphEdgeData,
} from './cytoscapeStyles'
import { EDGE_COLORS, STATUS_COLORS } from './constants'
import { expectDefined } from '../../test/testUtils'

describe('getCytoscapeStyles', () => {
  it('returns an array of style definitions', () => {
    const styles = getCytoscapeStyles({ showLabels: true })
    expect(Array.isArray(styles)).toBe(true)
    expect(styles.length).toBeGreaterThan(0)
  })

  it('includes node style selector', () => {
    const styles = getCytoscapeStyles({ showLabels: true })
    const nodeStyle = styles.find((s) => s.selector === 'node:childless')
    expect(nodeStyle).toBeDefined()
  })

  it('includes edge style selector', () => {
    const styles = getCytoscapeStyles({ showLabels: true })
    const edgeStyle = styles.find((s) => s.selector === 'edge')
    expect(edgeStyle).toBeDefined()
  })

  it('includes faded class selector', () => {
    const styles = getCytoscapeStyles({ showLabels: true })
    const fadedStyle = styles.find((s) => s.selector === '.faded')
    expect(fadedStyle).toBeDefined()
  })

  it('includes bunk parent node selector', () => {
    const styles = getCytoscapeStyles({ showLabels: true })
    const parentStyle = styles.find((s) => s.selector === 'node[isBunkParent]')
    expect(parentStyle).toBeDefined()
  })
})

describe('createGraphElements', () => {
  const mockNodes: GraphNodeData[] = [
    {
      id: 1,
      name: 'Alice',
      grade: 5,
      centrality: 0.5,
      clustering: 0.3,
      satisfaction_status: 'satisfied',
      bunk_cm_id: 100,
      community: 1,
    },
    {
      id: 2,
      name: 'Bob',
      grade: 6,
      centrality: 0.3,
      clustering: 0.2,
      satisfaction_status: 'partial',
      bunk_cm_id: 100,
      community: 1,
    },
    {
      id: 3,
      name: 'Charlie',
      grade: 5,
      centrality: 0.2,
      clustering: 0.1,
      satisfaction_status: 'unsatisfied',
      bunk_cm_id: undefined,
      community: 2,
    },
  ]

  const mockEdges: GraphEdgeData[] = [
    {
      source: 1,
      target: 2,
      type: 'request',
      priority: 1,
      confidence: 0.9,
      reciprocal: true,
    },
    {
      source: 2,
      target: 3,
      type: 'historical',
      priority: 2,
      confidence: 0.7,
      reciprocal: false,
    },
  ]

  const mockBunksData: Record<number, string> = {
    100: 'Cabin A',
  }

  it('creates parent nodes for bunks', () => {
    const { parentNodes } = createGraphElements(mockNodes, mockEdges, mockBunksData, {
      request: true,
      historical: true,
      sibling: true,
      school: true,
    })
    const bunkParent = expectDefined(
      parentNodes.find((p) => p.data.id === 'bunk-100'),
      'bunk parent'
    )
    expect(bunkParent.data.label).toBe('Cabin A')
  })

  // Layout-level unit-side compounds were tried (parent: unit-{name}-{side}
  // on each bunk) but fcose crashes — `addNodeToGrid → Cannot read properties
  // of undefined` — on the doubly-nested compound topology this produces with
  // a real session's mix of unit-parented bunks, AG bunks, and orphan
  // campers. Visual unit boundaries are still drawn by bubbleRenderer keyed
  // off bunk names, so unit grouping remains visible without breaking layout.
  it('does not emit unit-side compound parents (fcose-incompatible)', () => {
    const camper = (id: number, bunkId: number): GraphNodeData => ({
      id,
      name: `c${id}`,
      grade: 5,
      centrality: 0.5,
      clustering: 0,
      satisfaction_status: 'satisfied',
      bunk_cm_id: bunkId,
      community: 1,
    })
    const { parentNodes } = createGraphElements(
      [camper(1, 100), camper(2, 101), camper(3, 102), camper(4, 103)],
      [],
      { 100: 'B-1', 101: 'B-2', 102: 'G-1', 103: 'G-2' },
      { request: true, historical: true, sibling: true, school: true }
    )
    expect(parentNodes.every((p) => p.data.isBunkParent)).toBe(true)
    expect(parentNodes.every((p) => p.data.id.startsWith('bunk-'))).toBe(true)
  })

  it('creates camper nodes with correct data', () => {
    const { nodes } = createGraphElements(mockNodes, mockEdges, mockBunksData, {
      request: true,
      historical: true,
      sibling: true,
      school: true,
    })
    expect(nodes).toHaveLength(3)

    const alice = expectDefined(
      nodes.find((n) => n.data.id === '1'),
      'alice node'
    )
    expect(alice.data.name).toBe('Alice')
    expect(alice.data.grade).toBe(5)
    expect(alice.data.parent).toBe('bunk-100')
  })

  it('assigns parent to nodes with bunk_cm_id', () => {
    const { nodes } = createGraphElements(mockNodes, mockEdges, mockBunksData, {
      request: true,
      historical: true,
      sibling: true,
      school: true,
    })

    const alice = expectDefined(
      nodes.find((n) => n.data.id === '1'),
      'alice'
    )
    const charlie = expectDefined(
      nodes.find((n) => n.data.id === '3'),
      'charlie'
    )

    expect(alice.data.parent).toBe('bunk-100')
    expect(charlie.data.parent).toBeUndefined()
  })

  it('filters edges based on showEdges settings', () => {
    const { edges } = createGraphElements(mockNodes, mockEdges, mockBunksData, {
      request: true,
      historical: false,
      sibling: true,
      school: true,
    })

    expect(edges).toHaveLength(1)
    const edge = expectDefined(edges[0], 'first edge')
    expect(edge.data.edge_type).toBe('request')
  })

  it('includes all edges when all types are enabled', () => {
    const { edges } = createGraphElements(mockNodes, mockEdges, mockBunksData, {
      request: true,
      historical: true,
      sibling: true,
      school: true,
    })

    expect(edges).toHaveLength(2)
  })

  it('creates edges with correct data mapping', () => {
    const { edges } = createGraphElements(mockNodes, mockEdges, mockBunksData, {
      request: true,
      historical: true,
      sibling: true,
      school: true,
    })

    const requestEdge = expectDefined(
      edges.find((e) => e.data.edge_type === 'request'),
      'request edge'
    )
    expect(requestEdge.data.source).toBe('1')
    expect(requestEdge.data.target).toBe('2')
    expect(requestEdge.data.confidence).toBe(0.9)
    expect(requestEdge.data.is_reciprocal).toBe(true)
  })

  it('flags multi only on mixed-type pairs (different request_types still counts)', () => {
    // After the same-type-collapse change, two edges of the same request_type
    // collapse to one is_reciprocal edge. Multi only fires when types differ.
    const edges: GraphEdgeData[] = [
      {
        source: 1,
        target: 2,
        type: 'request',
        priority: 1,
        confidence: 0.9,
        reciprocal: false,
        request_type: 'bunk_with',
      },
      {
        source: 2,
        target: 1,
        type: 'request',
        priority: 1,
        confidence: 0.9,
        reciprocal: false,
        request_type: 'not_bunk_with',
      },
    ]
    const { edges: out } = createGraphElements(mockNodes, edges, mockBunksData, {
      request: true,
      sibling: true,
    })
    expect(out).toHaveLength(2)
    expect(out.every((e) => e.data.multi === true)).toBe(true)
  })

  it('collapses a same-type reciprocal bunk_with pair into one edge tagged is_reciprocal', () => {
    const edges: GraphEdgeData[] = [
      {
        source: 1,
        target: 2,
        type: 'request',
        priority: 1,
        confidence: 0.9,
        reciprocal: true,
        request_type: 'bunk_with',
      },
      {
        source: 2,
        target: 1,
        type: 'request',
        priority: 1,
        confidence: 0.9,
        reciprocal: true,
        request_type: 'bunk_with',
      },
    ]
    const { edges: out } = createGraphElements(mockNodes, edges, mockBunksData, {
      request: true,
      sibling: true,
    })
    expect(out).toHaveLength(1)
    const edge = expectDefined(out[0], 'collapsed edge')
    expect(edge.data.is_reciprocal).toBe(true)
    expect(edge.data.multi).toBeUndefined()
    expect(edge.data.request_type).toBe('bunk_with')
  })

  it('collapses a same-type reciprocal not_bunk_with pair', () => {
    const edges: GraphEdgeData[] = [
      {
        source: 1,
        target: 2,
        type: 'request',
        priority: 1,
        confidence: 0.9,
        reciprocal: true,
        request_type: 'not_bunk_with',
      },
      {
        source: 2,
        target: 1,
        type: 'request',
        priority: 1,
        confidence: 0.9,
        reciprocal: true,
        request_type: 'not_bunk_with',
      },
    ]
    const { edges: out } = createGraphElements(mockNodes, edges, mockBunksData, {
      request: true,
      sibling: true,
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.data.is_reciprocal).toBe(true)
    expect(out[0]?.data.request_type).toBe('not_bunk_with')
  })

  it('filters out sibling edges defensively even if the API still emits them', () => {
    const edges: GraphEdgeData[] = [
      { source: 1, target: 2, type: 'sibling', priority: 0, confidence: 1, reciprocal: false },
      {
        source: 1,
        target: 2,
        type: 'request',
        priority: 1,
        confidence: 0.9,
        reciprocal: false,
        request_type: 'bunk_with',
      },
    ]
    const { edges: out } = createGraphElements(mockNodes, edges, mockBunksData, {
      request: true,
      sibling: true,
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.data.edge_type).toBe('request')
  })

  it('keeps a single one-way edge unflagged (is_reciprocal falsy, no multi)', () => {
    // Cytoscape's edge[?is_reciprocal] selector matches truthy values; either
    // false or undefined skips the bold-solid override. We forward the
    // original edge.reciprocal value (false here) for any downstream
    // consumer that read it before.
    const edges: GraphEdgeData[] = [
      {
        source: 1,
        target: 2,
        type: 'request',
        priority: 1,
        confidence: 0.9,
        reciprocal: false,
        request_type: 'bunk_with',
      },
    ]
    const { edges: out } = createGraphElements(mockNodes, edges, mockBunksData, {
      request: true,
      sibling: true,
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.data.is_reciprocal).toBeFalsy()
    expect(out[0]?.data.multi).toBeUndefined()
  })

  it('passes request_type from edge data to EdgeElement so styles can color negative requests differently', () => {
    const edges: GraphEdgeData[] = [
      {
        source: 1,
        target: 2,
        type: 'request',
        priority: 1,
        confidence: 0.9,
        reciprocal: false,
        request_type: 'not_bunk_with',
      },
      {
        source: 2,
        target: 3,
        type: 'request',
        priority: 1,
        confidence: 0.9,
        reciprocal: true,
        request_type: 'bunk_with',
      },
    ]
    const { edges: out } = createGraphElements(mockNodes, edges, mockBunksData, {
      request: true,
      historical: true,
      sibling: true,
      school: true,
    })
    expect(out).toHaveLength(2)
    const negative = expectDefined(
      out.find((e) => e.data.source === '1' && e.data.target === '2'),
      'negative edge'
    )
    expect(negative.data.request_type).toBe('not_bunk_with')
    const positive = expectDefined(
      out.find((e) => e.data.source === '2' && e.data.target === '3'),
      'positive edge'
    )
    expect(positive.data.request_type).toBe('bunk_with')
  })

  it('forwards parent/staff satisfaction status onto camper nodes', () => {
    const nodesWithSplits: GraphNodeData[] = [
      {
        id: 1,
        name: 'Alice',
        grade: 5,
        centrality: 0.5,
        clustering: 0.3,
        satisfaction_status: 'satisfied',
        parent_satisfaction_status: 'satisfied',
        staff_satisfaction_status: 'unsatisfied',
        bunk_cm_id: 100,
        community: 1,
      },
    ]
    const { nodes } = createGraphElements(nodesWithSplits, [], mockBunksData, {
      request: true,
      historical: true,
      sibling: true,
      school: true,
    })
    const alice = expectDefined(
      nodes.find((n) => n.data.id === '1'),
      'alice'
    )
    expect(alice.data.parent_satisfaction_status).toBe('satisfied')
    expect(alice.data.staff_satisfaction_status).toBe('unsatisfied')
  })
})

describe('EDGE_COLORS constant', () => {
  it('keeps bunk_with (positive) requests blue', () => {
    expect(EDGE_COLORS['request']).toBe('#3498db')
  })

  it('uses red for not_bunk_with (negative) requests', () => {
    expect(EDGE_COLORS['not_bunk_with']).toBe('#e74c3c')
  })
})

describe('edge curve rendering', () => {
  it('renders single relationships as straight dashed lines (regular weight, single arrow)', () => {
    const styles = getCytoscapeStyles({ showLabels: true })
    const edgeStyle = styles.find((s) => s.selector === 'edge')
    expect(edgeStyle).toBeDefined()
    const styleObj = edgeStyle?.style as unknown as Record<string, unknown>
    expect(styleObj['curve-style']).toBe('straight')
    expect(styleObj['line-style']).toBe('dashed')
    expect(styleObj['width']).toBe(2)
    expect(styleObj['target-arrow-shape']).toBe('triangle')
    // No source arrowhead at the base — that's reserved for is_reciprocal.
    expect(styleObj['source-arrow-shape']).toBeUndefined()
  })

  it('overrides edge[?is_reciprocal] to bold solid with a source arrow', () => {
    const styles = getCytoscapeStyles({ showLabels: true })
    const reciprocalStyle = styles.find((s) => s.selector === 'edge[?is_reciprocal]')
    expect(reciprocalStyle).toBeDefined()
    const styleObj = reciprocalStyle?.style as unknown as Record<string, unknown>
    expect(styleObj['width']).toBe(4)
    expect(styleObj['line-style']).toBe('solid')
    expect(styleObj['source-arrow-shape']).toBe('triangle')
  })

  it('overrides curve-style to unbundled-bezier on edges flagged with multi', () => {
    const styles = getCytoscapeStyles({ showLabels: true })
    const multiStyle = styles.find((s) => s.selector === 'edge[?multi]')
    expect(multiStyle).toBeDefined()
    const styleObj = multiStyle?.style as unknown as Record<string, unknown>
    expect(styleObj['curve-style']).toBe('unbundled-bezier')
  })

  it('source-arrow-color on edge[?is_reciprocal] resolves like the line color', () => {
    // The reciprocal source arrow must match the line color (same
    // resolveEdgeColor function), otherwise a recip not_bunk_with would
    // render with a blue source arrow.
    const styles = getCytoscapeStyles({ showLabels: true })
    const reciprocalStyle = styles.find((s) => s.selector === 'edge[?is_reciprocal]')
    expect(reciprocalStyle).toBeDefined()
    const styleObj = reciprocalStyle?.style as unknown as Record<string, unknown>
    const sourceColor = styleObj['source-arrow-color']
    expect(typeof sourceColor).toBe('function')
    const fakeEdge = {
      data: (key: string) =>
        key === 'edge_type' ? 'request' : key === 'request_type' ? 'not_bunk_with' : null,
    }
    const color = (sourceColor as (e: unknown) => string)(fakeEdge)
    expect(color).toBe('#e74c3c')
  })

  it('colors not_bunk_with request edges using EDGE_COLORS["not_bunk_with"]', () => {
    // The base edge selector uses a function for line-color that consults
    // request_type — verified by checking that edges with request_type
    // 'not_bunk_with' resolve to the negative color, not the positive one.
    const styles = getCytoscapeStyles({ showLabels: true })
    const edgeStyle = styles.find((s) => s.selector === 'edge')
    expect(edgeStyle).toBeDefined()
    const styleObj = edgeStyle?.style as unknown as Record<string, unknown>
    const lineColor = styleObj['line-color']
    expect(typeof lineColor).toBe('function')

    const fakeEdge = {
      data: (key: string) =>
        key === 'edge_type' ? 'request' : key === 'request_type' ? 'not_bunk_with' : null,
    }
    const color = (lineColor as (e: unknown) => string)(fakeEdge)
    expect(color).toBe('#e74c3c')
  })
})

describe('parent-paramount node border', () => {
  function makeFakeNode(
    overrides: Partial<{
      parent_satisfaction_status: string
      staff_satisfaction_status: string
      satisfaction_status: string
    }>
  ) {
    const data: Record<string, unknown> = { ...overrides }
    return {
      data: (key: string) => data[key],
    } as unknown as NodeSingular
  }

  it('reads parent_satisfaction_status for primary border color', () => {
    const styles = getCytoscapeStyles({ showLabels: true })
    const nodeStyle = expectDefined(
      styles.find((s) => s.selector === 'node:childless'),
      'node:childless style'
    )
    const borderFn = (nodeStyle.style as { 'border-color': (e: NodeSingular) => string })[
      'border-color'
    ]
    const node = makeFakeNode({
      parent_satisfaction_status: 'unsatisfied',
      staff_satisfaction_status: 'satisfied',
    })
    expect(borderFn(node)).toBe(STATUS_COLORS['unsatisfied'])
  })

  it('falls back to legacy satisfaction_status when parent_satisfaction_status is absent', () => {
    const styles = getCytoscapeStyles({ showLabels: true })
    const nodeStyle = expectDefined(
      styles.find((s) => s.selector === 'node:childless'),
      'node:childless style'
    )
    const borderFn = (nodeStyle.style as { 'border-color': (e: NodeSingular) => string })[
      'border-color'
    ]
    const node = makeFakeNode({ satisfaction_status: 'satisfied' })
    expect(borderFn(node)).toBe(STATUS_COLORS['satisfied'])
  })

  it('does NOT render staff state on the node (Stage 2 scope decision)', () => {
    const styles = getCytoscapeStyles({ showLabels: true })
    const nodeStyle = expectDefined(
      styles.find((s) => s.selector === 'node:childless'),
      'node:childless style'
    )
    const borderFn = (nodeStyle.style as { 'border-color': (e: NodeSingular) => string })[
      'border-color'
    ]
    const a = makeFakeNode({
      parent_satisfaction_status: 'satisfied',
      staff_satisfaction_status: 'unsatisfied',
    })
    const b = makeFakeNode({
      parent_satisfaction_status: 'satisfied',
      staff_satisfaction_status: 'satisfied',
    })
    expect(borderFn(a)).toBe(borderFn(b))
  })
})
