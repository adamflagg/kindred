/**
 * Cytoscape styles and graph data transformations
 * Extracted from SocialNetworkGraph.tsx
 */
import type { NodeSingular, EdgeSingular, StylesheetStyle } from 'cytoscape'
import { GRADE_COLORS, EDGE_COLORS, STATUS_COLORS } from './constants'
import { formatGradeOrdinal } from '../../utils/gradeUtils'

/** Input node data from API */
export interface GraphNodeData {
  id: number
  name: string
  grade: number
  centrality: number
  clustering: number
  satisfaction_status: string
  parent_satisfaction_status?: string
  staff_satisfaction_status?: string
  bunk_cm_id: number | undefined
  community: number
}

/** Input edge data from API */
export interface GraphEdgeData {
  source: number
  target: number
  type: string
  priority: number
  confidence: number
  reciprocal: boolean
  /** For type='request' edges: 'bunk_with' or 'not_bunk_with'. */
  request_type?: string
}

/** Edge visibility settings */
export interface ShowEdgesSettings {
  request: boolean
  sibling: boolean
  [key: string]: boolean
}

/** Options for getCytoscapeStyles */
export interface CytoscapeStyleOptions {
  showLabels: boolean
}

/**
 * Map a Cytoscape edge to its color. The negative bunk request
 * ('not_bunk_with') ships from the API with edge_type='request' — same as
 * the positive 'bunk_with' — so we have to consult request_type to pick
 * the right hue.
 */
function resolveEdgeColor(ele: { data: (key: string) => unknown }): string {
  const edgeType = ele.data('edge_type') as string
  if (edgeType === 'request') {
    const requestType = ele.data('request_type') as string | null | undefined
    if (requestType === 'not_bunk_with') return EDGE_COLORS['not_bunk_with'] ?? '#95a5a6'
  }
  return EDGE_COLORS[edgeType] ?? '#95a5a6'
}

/**
 * Get Cytoscape stylesheet for the social network graph
 */
export function getCytoscapeStyles({ showLabels }: CytoscapeStyleOptions): StylesheetStyle[] {
  return [
    // Camper nodes (exclude parent compound nodes)
    {
      selector: 'node:childless',
      style: {
        'background-color': (ele: NodeSingular) => {
          const grade = ele.data('grade')
          return grade ? (GRADE_COLORS[grade] ?? '#95a5a6') : '#95a5a6'
        },
        width: (ele: NodeSingular) => {
          const centrality = ele.data('centrality') ?? 0
          return 10 + centrality * 40 // 10-50px range
        },
        height: (ele: NodeSingular) => {
          const centrality = ele.data('centrality') ?? 0
          return 10 + centrality * 40 // 10-50px range
        },
        label: showLabels ? 'data(label)' : '',
        // Responsive font size: larger base for mobile readability
        'font-size': '12px',
        color: '#f5f5f5',
        'text-outline-width': 2,
        'text-outline-color': '#1a1a1a',
        'text-valign': 'bottom',
        'text-margin-y': 6,
        'text-max-width': '80px',
        'text-wrap': 'wrap',
        'border-width': 3,
        'border-color': (ele: NodeSingular) => {
          // Parent-paramount: parent requests drive the primary border color.
          // Falls back to legacy satisfaction_status for any consumer (e.g. older
          // cached scenarios) that hasn't been migrated to the per-source split.
          // Staff state is intentionally NOT rendered on the graph at this stage
          // (Stage 2 scope decision); the field still flows through for future use.
          const status = ele.data('parent_satisfaction_status') ?? ele.data('satisfaction_status')
          return STATUS_COLORS[status] ?? STATUS_COLORS['default'] ?? '#2c3e50'
        },
        'overlay-padding': '6px',
      },
    },
    {
      selector: 'node:childless:selected',
      style: {
        'border-width': 4,
        'border-color': '#e74c3c',
        'overlay-color': '#e74c3c',
        'overlay-opacity': 0.2,
      },
    },
    {
      selector: 'edge',
      style: {
        width: 2,
        'line-color': (ele: EdgeSingular) => resolveEdgeColor(ele),
        'line-style': 'dashed',
        'target-arrow-shape': 'triangle',
        'target-arrow-color': (ele: EdgeSingular) => resolveEdgeColor(ele),
        // Default: a single one-way request renders as a dashed straight
        // arrow. Same-type reciprocal pairs are collapsed upstream in
        // createGraphElements and tagged is_reciprocal — they're picked up
        // by the rule below for bold solid + source arrowhead. Mixed-type
        // pairs (true conflict) keep multi:true and inherit dashed straight
        // here, then get curved by the multi rule.
        'curve-style': 'straight',
        'overlay-padding': '2px',
      },
    },
    {
      selector: 'edge[?is_reciprocal]',
      style: {
        // Bold solid double-headed line for collapsed mutual-request pairs.
        // line-color and target-arrow-color inherit from the base 'edge'
        // rule; source-arrow-color must mirror them so a recip not_bunk_with
        // doesn't render with a blue source arrow.
        width: 4,
        'line-style': 'solid',
        'source-arrow-shape': 'triangle',
        'source-arrow-color': (ele: EdgeSingular) => resolveEdgeColor(ele),
      },
    },
    {
      selector: 'edge[?multi]',
      style: {
        // Splay each edge of a true-conflict pair onto its own curve. Width
        // and line-style inherit from the base rule (regular dashed) — these
        // are still one-way requests, just visually separated so both
        // colors read.
        'curve-style': 'unbundled-bezier',
        'control-point-distances': [40],
        'control-point-weights': [0.5],
      },
    },
    {
      selector: 'edge.hidden',
      style: {
        display: 'none',
      },
    },
    {
      selector: 'edge[type = "bundled"]',
      style: {
        width: 3,
        'line-style': 'solid',
        'line-dash-pattern': [6, 3],
      },
    },
    {
      selector: '.faded',
      style: {
        opacity: 0.1,
        events: 'no',
      },
    },
    {
      selector: '.hide-label',
      style: {
        label: '',
      },
    },
    {
      selector: '.highlighted',
      style: {
        'z-index': 999,
        'font-weight': 'bold',
        'font-size': '14px',
        // Dark outline keeps the label readable on both light and dark backgrounds.
        // White outline (#fff) washed out names on light canvas backgrounds (#37).
        'text-outline-width': 2,
        'text-outline-color': '#1a1a1a',
        color: '#f5f5f5',
      },
    },
    {
      selector: '.bunk-label',
      style: {
        shape: 'rectangle',
        width: 1,
        height: 1,
        'background-opacity': 0,
        'border-width': 0,
        label: 'data(label)',
        'font-size': '18px',
        'font-weight': 'bold',
        color: '#333',
        'text-outline-width': 3,
        'text-outline-color': '#fff',
        'text-valign': 'center',
        'text-halign': 'center',
        events: 'no',
      },
    },
    // Compound parent nodes for bunk grouping (invisible - used for layout only)
    {
      selector: 'node[isBunkParent]',
      style: {
        'background-opacity': 0,
        'border-width': 0,
        label: '',
        padding: '20px',
        'min-width': '60px',
        'min-height': '60px',
        events: 'no',
      },
    },
  ]
}

/** Cytoscape element for parent (bunk) compound node */
export interface ParentNodeElement {
  data: {
    id: string
    label: string
    isBunkParent?: boolean
    bunk_cm_id?: number
  }
}

/** Cytoscape element for camper node */
export interface CamperNodeElement {
  data: {
    id: string
    label: string
    name: string
    grade: number
    centrality: number
    clustering: number
    satisfaction_status: string
    parent_satisfaction_status: string | undefined
    staff_satisfaction_status: string | undefined
    bunk_cm_id: number | undefined
    community: number
    parent: string | undefined
  }
}

/** Cytoscape element for edge */
export interface EdgeElement {
  data: {
    id: string
    source: string
    target: string
    edge_type: string
    priority: number
    confidence: number
    is_reciprocal: boolean
    request_type?: string
    /** True when this pair of campers has 2+ relationships (any combination
     *  of bunk_with, not_bunk_with, sibling). Drives the curved-bezier style. */
    multi?: boolean
  }
}

/** Result of createGraphElements */
export interface GraphElements {
  parentNodes: ParentNodeElement[]
  nodes: CamperNodeElement[]
  edges: EdgeElement[]
}

/**
 * Create Cytoscape elements from graph data
 */
export function createGraphElements(
  nodeData: GraphNodeData[],
  edgeData: GraphEdgeData[],
  bunksData: Record<number, string> | null | undefined,
  showEdges: ShowEdgesSettings
): GraphElements {
  // Group nodes by bunk
  const bunkGroups: Record<number, GraphNodeData[]> = {}

  nodeData.forEach((node) => {
    if (node.bunk_cm_id) {
      const bunkId = node.bunk_cm_id
      bunkGroups[bunkId] ??= []
      bunkGroups[bunkId].push(node)
    }
  })

  // Create a flat compound parent for each bunk. We do NOT nest bunks inside
  // unit-side compounds at the layout level: fcose crashes
  // (`addNodeToGrid → Cannot read properties of undefined`) on doubly-nested
  // compound graphs with this dataset. The visual unit bubble is drawn by
  // bubbleRenderer keyed off bunk names, so unit grouping is still visible
  // even though it's not a layout constraint.
  const parentNodes: ParentNodeElement[] = Object.keys(bunkGroups).map((bunkIdStr) => {
    const bunkId = parseInt(bunkIdStr, 10)
    const bunkName = bunksData?.[bunkId] ?? `Bunk ${bunkId}`
    return {
      data: {
        id: `bunk-${bunkId}`,
        label: bunkName,
        isBunkParent: true,
        bunk_cm_id: bunkId,
      },
    }
  })

  // Create camper nodes with parent property for compound grouping
  const nodes: CamperNodeElement[] = nodeData.map((node) => ({
    data: {
      id: node.id.toString(),
      label: `${node.name} (${formatGradeOrdinal(node.grade)})`,
      name: node.name,
      grade: node.grade,
      centrality: node.centrality,
      clustering: node.clustering,
      satisfaction_status: node.satisfaction_status,
      parent_satisfaction_status: node.parent_satisfaction_status,
      staff_satisfaction_status: node.staff_satisfaction_status,
      bunk_cm_id: node.bunk_cm_id,
      community: node.community,
      parent: node.bunk_cm_id ? `bunk-${node.bunk_cm_id}` : undefined,
    },
  }))

  // Filter and create edges based on visibility settings.
  // Sibling edges are stripped client-side as a defensive measure — the
  // sibling edge type is being removed end-to-end (see follow-up issue);
  // this filter unblocks the visual change while the API is updated.
  const visibleEdges = edgeData.filter((edge) => {
    if (edge.type === 'sibling') return false
    const edgeType = edge.type as keyof ShowEdgesSettings
    return showEdges[edgeType] !== false
  })

  // Group edges by unordered pair so we can detect same-type reciprocal pairs
  // (collapse to one bold double-headed line) vs mixed-type pairs (keep two
  // curved edges as today).
  const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`)
  const pairBuckets = new Map<string, GraphEdgeData[]>()
  visibleEdges.forEach((e) => {
    const k = pairKey(e.source, e.target)
    const bucket = pairBuckets.get(k) ?? []
    bucket.push(e)
    pairBuckets.set(k, bucket)
  })

  // Helper: are two edges the "same kind" — same edge_type and same
  // request_type? Used to decide whether a 2-edge pair collapses or splays.
  const sameKind = (a: GraphEdgeData, b: GraphEdgeData) =>
    a.type === b.type && (a.request_type ?? null) === (b.request_type ?? null)

  const edges: EdgeElement[] = []
  let edgeIndex = 0

  pairBuckets.forEach((bucket) => {
    if (bucket.length === 2 && sameKind(bucket[0]!, bucket[1]!)) {
      // Same-type reciprocal pair — emit one edge with is_reciprocal: true.
      // Source/target come from the first edge; arrowheads are symmetric in
      // the stylesheet so the choice does not affect rendering.
      const e = bucket[0]!
      edges.push({
        data: {
          id: `edge-${edgeIndex++}`,
          source: e.source.toString(),
          target: e.target.toString(),
          edge_type: e.type,
          priority: e.priority,
          confidence: e.confidence,
          is_reciprocal: true,
          ...(e.request_type ? { request_type: e.request_type } : {}),
        },
      })
      return
    }

    // Otherwise, emit each edge separately. Pairs with 2+ edges get the
    // multi flag so the stylesheet curves them (true conflicts).
    const isMulti = bucket.length >= 2
    bucket.forEach((edge) => {
      edges.push({
        data: {
          id: `edge-${edgeIndex++}`,
          source: edge.source.toString(),
          target: edge.target.toString(),
          edge_type: edge.type,
          priority: edge.priority,
          confidence: edge.confidence,
          is_reciprocal: edge.reciprocal,
          ...(edge.request_type ? { request_type: edge.request_type } : {}),
          ...(isMulti ? { multi: true } : {}),
        },
      })
    })
  })

  return { parentNodes, nodes, edges }
}
