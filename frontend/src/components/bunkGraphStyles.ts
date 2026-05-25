/**
 * Bunk-graph styling helpers.
 *
 * Extracted from BunkSocialGraphModal so the connection-color, grade-color
 * and first-year badge logic can be unit-tested without booting cytoscape.
 */

import type { EdgeSingular, ElementDefinition, NodeSingular, StylesheetStyle } from 'cytoscape'
import { resolveEdgeColor } from './graph/cytoscapeStyles'
import { formatGradeOrdinal } from '../utils/gradeUtils'
import { getSessionShorthand } from '../utils/sessionDisplay'

export const BUNK_NODE_COLORS = {
  // Binary connection state — anything > 0 reads as "has connections".
  noConnections: '#ef4444', // red-500
  hasConnections: '#22c55e', // green-500
  // Light → mid → dark grade ramp. Strong luminance contrast so younger vs
  // older reads at a glance even on small screens; replaces the old blue/red
  // pair which was hard to distinguish from the connection colors.
  gradeLight: '#7dd3fc', // sky-300
  gradeMid: '#6366f1', // indigo-500
  gradeDark: '#312e81', // indigo-900
} as const

/** Outer ring drawn around first-year campers — must pop against every grade
 *  fill above and against red/green node fills. Amber gives the strongest
 *  contrast across the palette. */
export const FIRST_YEAR_RING_COLOR = '#fbbf24' // amber-400

/** Border thickness used for the first-year ring. The default border is 0;
 *  bumping this to 6 makes the ring the entire "first-year" signal — no
 *  inner badge needed, and Cytoscape keeps it perfectly centered at every
 *  zoom level since the ring IS the geometry. */
export const FIRST_YEAR_RING_WIDTH = 6

/** Binary node coloring: red when isolated, green otherwise. The earlier
 *  yellow "few connections" tier was dropped because it fought with the
 *  amber first-year ring and added a third state without much signal. */
export function getNodeColor(degree: number): string {
  return degree === 0 ? BUNK_NODE_COLORS.noConnections : BUNK_NODE_COLORS.hasConnections
}

/** Map each grade present in a bunk to a color from the light/dark ramp.
 *  Younger grades get the lighter end of the scale. */
export function getBunkGradeColors(grades: readonly number[]): Record<number, string> {
  const sorted = grades.toSorted((a, b) => a - b)
  const result: Record<number, string> = {}
  sorted.forEach((grade, index) => {
    if (index === 0) {
      result[grade] = BUNK_NODE_COLORS.gradeLight
    } else if (index === sorted.length - 1) {
      result[grade] = BUNK_NODE_COLORS.gradeDark
    } else {
      result[grade] = BUNK_NODE_COLORS.gradeMid
    }
  })
  return result
}

/** A single camper node as built by the bunk-graph API (`build_bunk_graph`). */
export interface BunkGraphNodeInput {
  id: number
  name: string
  grade: number | null
  centrality?: number
  clustering?: number
  community?: number | null
  first_year?: boolean
  last_year_session?: string | null
  last_year_bunk?: string | null
}

/** A single in-scope edge from the bunk-graph API. */
export interface BunkGraphEdgeInput {
  source: number
  target: number
  weight: number
  edge_type: string
  reciprocal: boolean
  confidence?: number
  request_type?: string | null
}

/** A cross-scope (boundary) edge — one endpoint outside the bunk. */
export interface BunkGraphCrossScopeEdgeInput {
  source: number
  target: number
  edge_type: 'request'
  weight: number
  request_type: string | null
  confidence: number | null
  reciprocal: boolean
  cross_scope: true
}

/** Input bundle for {@link buildBunkGraphElements}. Mirrors `BunkGraphData`. */
export interface BunkGraphElementsInput {
  nodes: readonly BunkGraphNodeInput[]
  edges: readonly BunkGraphEdgeInput[]
  cross_scope_nodes?: readonly BunkGraphNodeInput[]
  cross_scope_edges?: readonly BunkGraphCrossScopeEdgeInput[]
}

/**
 * Build the Cytoscape element definitions for the per-bunk social graph
 * (BunkSocialGraphModal). Extracted from the modal's init effect so the
 * shipped element-building logic — including cross-scope ghost nodes/edges —
 * is unit-testable without booting cytoscape (#1606/#1610 follow-up).
 *
 * When `showCrossScopeEdges` is true and the input carries `cross_scope_nodes`
 * / `cross_scope_edges`, ghost nodes (out-of-bunk endpoints) and boundary
 * edges are appended, tagged `cross_scope: true` so the `node[?cross_scope]`
 * / `edge[?cross_scope]` selectors ghost them.
 *
 * `rng` is injectable so tests get deterministic positions; production uses
 * `Math.random` to spread nodes vertically and scatter ghost nodes.
 */
export function buildBunkGraphElements(
  data: BunkGraphElementsInput,
  showCrossScopeEdges: boolean,
  rng: () => number = Math.random
): ElementDefinition[] {
  const elements: ElementDefinition[] = []

  // Calculate node degrees from in-scope edges first.
  const nodeDegrees: Record<string, number> = {}
  data.edges.forEach((edge) => {
    const sourceId = `node-${edge.source}`
    const targetId = `node-${edge.target}`
    nodeDegrees[sourceId] = (nodeDegrees[sourceId] ?? 0) + 1
    nodeDegrees[targetId] = (nodeDegrees[targetId] ?? 0) + 1
  })

  // Light → mid → dark grade ramp (younger to older).
  const grades = [...new Set(data.nodes.map((n) => n.grade).filter((g) => g !== null))] as number[]
  const gradeColors = getBunkGradeColors(grades)

  // Track ids already added so cross-scope ghosts don't duplicate in-scope nodes.
  const seenNodeIds = new Set<string>()

  data.nodes.forEach((node, index) => {
    const nodeId = `node-${node.id}`
    seenNodeIds.add(nodeId)
    const degree = nodeDegrees[nodeId] ?? 0

    const verticalOffset = (rng() - 0.5) * 300

    const nodeClasses: string[] = []
    if (degree === 0) nodeClasses.push('isolated')
    if (node.first_year) nodeClasses.push('first-year')

    elements.push({
      group: 'nodes',
      data: {
        ...node,
        id: nodeId,
        label: `${node.name} (${formatGradeOrdinal(node.grade)})${
          node.last_year_bunk && node.last_year_session
            ? `\n${getSessionShorthand(node.last_year_session)}: ${node.last_year_bunk}`
            : ''
        }`,
        fullName: node.name,
        degree,
        gradeColor: node.grade ? gradeColors[node.grade] : '#666666',
        firstYear: node.first_year ?? false,
      },
      position: { x: index * 100, y: verticalOffset },
      classes: nodeClasses.join(' '),
    })
  })

  // Backend already collapses mutual same-type pairs into a single edge tagged
  // reciprocal=true; the edge[?reciprocal] selector renders those bold/solid.
  let edgeIndex = 0
  data.edges.forEach((edge) => {
    elements.push({
      group: 'edges',
      data: {
        ...edge,
        id: `edge-${edgeIndex++}`,
        source: `node-${edge.source}`,
        target: `node-${edge.target}`,
        edge_type: edge.edge_type,
      },
    })
  })

  // Cross-scope ghost elements (#1606, #1610).
  if (showCrossScopeEdges && data.cross_scope_nodes && data.cross_scope_edges) {
    data.cross_scope_nodes.forEach((node) => {
      const nodeId = `node-${node.id}`
      // Skip if already present (defensive — a bunk's campers are in-scope).
      if (seenNodeIds.has(nodeId)) return
      seenNodeIds.add(nodeId)

      elements.push({
        group: 'nodes',
        data: {
          id: nodeId,
          label: `${node.name} (${formatGradeOrdinal(node.grade)})`,
          fullName: node.name,
          degree: 0,
          gradeColor: '#666666',
          firstYear: false,
          cross_scope: true,
        },
        position: { x: rng() * 400, y: rng() * 300 },
        classes: '',
      })
    })

    data.cross_scope_edges.forEach((edge) => {
      elements.push({
        group: 'edges',
        data: {
          id: `cross-edge-${edgeIndex++}`,
          source: `node-${edge.source}`,
          target: `node-${edge.target}`,
          edge_type: edge.edge_type,
          request_type: edge.request_type,
          confidence: edge.confidence,
          reciprocal: edge.reciprocal,
          cross_scope: true,
        },
      })
    })
  }

  return elements
}

/**
 * Cytoscape stylesheet for the per-bunk graph (BunkSocialGraphModal).
 *
 * Edge color/arrow resolution routes through `resolveEdgeColor` from the
 * shared graph module so `not_bunk_with` requests render red on the bunk
 * graph the same way they do on the session graph. Previously a local
 * single-entry `EDGE_COLORS` map keyed on `edge_type` alone collapsed both
 * positive and negative requests to the same blue (#1545).
 */
export function getBunkCytoscapeStyles(): StylesheetStyle[] {
  return [
    {
      selector: 'node',
      style: {
        'background-color': (ele: NodeSingular) => getNodeColor(ele.degree(false)),
        width: 40,
        height: 40,
        label: 'data(label)',
        'font-size': '14px',
        'font-weight': 600,
        'text-valign': 'bottom',
        'text-margin-y': 8,
        'text-wrap': 'wrap',
        'text-max-width': '120px',
        // gradeColor is set per-node in the element data builder so each
        // camper's label picks up the light → dark ramp from getBunkGradeColors.
        color: 'data(gradeColor)',
        'text-outline-width': 2,
        'text-outline-color': '#ffffff',
        'overlay-padding': '6px',
      },
    },
    {
      selector: 'node.isolated',
      style: {
        // Isolated nodes don't need special border styling.
      },
    },
    {
      selector: 'node.first-year',
      style: {
        // The amber ring is the entire first-year signal — making it
        // thicker than the default node border keeps the marker centered
        // by geometry (no SVG badge to drift at fractional zooms).
        'border-width': FIRST_YEAR_RING_WIDTH,
        'border-color': FIRST_YEAR_RING_COLOR,
        'border-style': 'solid',
      },
    },
    {
      selector: 'edge',
      style: {
        // Default is a dashed one-way request arrow. The backend
        // (build_bunk_graph) already collapses mutual pairs into a single
        // edge tagged reciprocal — those pick up the bold solid
        // double-headed style from the edge[?reciprocal] selector below.
        // Mirrors the session-level treatment in graph/cytoscapeStyles.ts.
        width: 2,
        'line-style': 'dashed',
        'line-color': (ele: EdgeSingular) => resolveEdgeColor(ele),
        'target-arrow-shape': (ele: EdgeSingular) => {
          const edgeType = ele.data('edge_type')
          return edgeType === 'request' ? 'triangle' : 'none'
        },
        'target-arrow-color': (ele: EdgeSingular) => resolveEdgeColor(ele),
        'line-opacity': (ele: EdgeSingular) => {
          const confidence = (ele.data('confidence') as number | undefined) ?? 0.5
          return Math.max(0.3, Math.min(0.9, confidence))
        },
        'curve-style': 'straight',
        'control-point-step-size': 40,
        'overlay-padding': '3px',
      },
    },
    {
      selector: 'edge[?reciprocal]',
      style: {
        // Bold solid double-headed line for backend-collapsed mutual pairs.
        // line-color and target-arrow-color inherit from the base 'edge'
        // rule; source-arrow-color must mirror them so a recip not_bunk_with
        // doesn't render with a blue source arrow.
        width: 4,
        'line-style': 'solid',
        'source-arrow-shape': 'triangle',
        'source-arrow-color': (ele: EdgeSingular) => resolveEdgeColor(ele),
      },
    },
    // Cross-scope ghost rendering — mirrors the session-graph stylesheet in
    // graph/cytoscapeStyles.ts so the visual contract is identical on both surfaces.
    {
      selector: 'edge[?cross_scope]',
      style: {
        opacity: 0.35,
        events: 'no',
        'line-style': 'dashed',
      },
    },
    {
      // Ghost campers (out-of-scope endpoints of cross-scope edges). Body is
      // faded so they read as secondary; events stay on so the detail panel
      // can be opened on click — same as the session graph treatment.
      selector: 'node[?cross_scope]',
      style: {
        'background-opacity': 0.55,
        'z-index': 100,
      },
    },
  ]
}
