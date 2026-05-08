/**
 * Cytoscape styles and graph data transformations
 * Extracted from SocialNetworkGraph.tsx
 */
import type { NodeSingular, EdgeSingular, StylesheetStyle } from 'cytoscape'
import { GRADE_COLORS, EDGE_COLORS, STATUS_COLORS } from './constants'
import { formatGradeOrdinal } from '../../utils/gradeUtils'
import type {
  ApiSocialGraphNode,
  ApiSocialGraphEdge,
  ApiCrossScopeEdge,
} from '../../types/api-types'

/**
 * Input node data from API.
 * Type alias for the generated `ApiSocialGraphNode` — eliminates hand-mirroring.
 * Generated from `api/schemas/social_graph.py:SocialGraphNode` via @hey-api/openapi-ts.
 */
export type GraphNodeData = ApiSocialGraphNode

/**
 * Input edge data from API.
 * Type alias for the generated `ApiSocialGraphEdge` — eliminates hand-mirroring.
 * Generated from `api/schemas/social_graph.py:SocialGraphEdge` via @hey-api/openapi-ts.
 */
export type GraphEdgeData = ApiSocialGraphEdge

/** Edge visibility settings */
export interface ShowEdgesSettings {
  request: boolean
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
      selector: '.scope-hidden',
      style: {
        opacity: 0,
        events: 'no',
        'transition-property': 'opacity',
        'transition-duration': 180,
        'transition-timing-function': 'ease-out',
      },
    },
    {
      selector: '.scope-ghost',
      style: {
        opacity: 0.35,
        events: 'no',
        'transition-property': 'opacity',
        'transition-duration': 180,
        'transition-timing-function': 'ease-out',
      },
    },
    {
      // Edges spanning the active scope boundary (one endpoint outside the
      // selected units/bunks). Rendered ghosted so they're visible as context
      // without competing with the in-scope graph.
      selector: 'edge[?cross_scope]',
      style: {
        opacity: 0.35,
        events: 'no',
        'line-style': 'dashed',
      },
    },
    {
      // Out-of-scope endpoints rendered as ghosted nodes. Body opacity is
      // reduced so they read as secondary; the high z-index keeps node +
      // name visible above any unit/bunk bubble strokes that pass through
      // them. Border + text styling inherits from the base node selector
      // so ghosts read identically to non-ghosts at the type level. Events
      // stay on (default 'yes') so users can click through to the camper
      // detail panel for potential connections.
      selector: 'node[?cross_scope]:childless',
      style: {
        'background-opacity': 0.55,
        'z-index': 100,
      },
    },
    {
      // Bunk parent compounds whose only members are ghost campers. Faded
      // so they recede behind the in-scope bunks visually, but z-index is
      // still bumped above default so the dashed border draws on top of
      // any cross-cutting unit bubble strokes.
      selector: 'node[?cross_scope]:parent',
      style: {
        opacity: 0.7,
        'z-index': 50,
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
    /** Set on parent compounds whose only members are out-of-scope ghost campers. */
    cross_scope?: boolean
  }
}

/** Cytoscape element for camper node */
export interface CamperNodeElement {
  data: {
    id: string
    label: string
    name: string
    grade: number | null | undefined
    centrality: number
    clustering: number
    satisfaction_status: string | null | undefined
    parent_satisfaction_status: string | null | undefined
    staff_satisfaction_status: string | null | undefined
    /** Set on out-of-scope endpoints of cross-scope edges. Renders ghosted
     *  but stays clickable so the user can open the detail panel. */
    cross_scope?: boolean
    bunk_cm_id: number | null | undefined
    community: number | null | undefined
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
    priority?: number
    confidence?: number
    is_reciprocal?: boolean
    request_type?: string
    /** True when a pair has two opposing-direction request edges of mixed
     *  request_type (bunk_with vs not_bunk_with). Drives the curved bezier. */
    multi?: boolean
    /** True for edges that cross the active scope boundary. Picked up by the
     *  `edge[?cross_scope]` selector to render them ghosted. */
    cross_scope?: boolean
  }
}

/**
 * Edge straddling the active scope (one endpoint in scope, one outside).
 * Returned as a distinct list by the API so we can ghost them visually
 * without polluting the layout's edge weight.
 * Type alias for the generated `ApiCrossScopeEdge` — eliminates hand-mirroring.
 * Generated from `bunking/graph/scope_filter.py:CrossScopeEdge` via @hey-api/openapi-ts.
 */
export type CrossScopeEdgeData = ApiCrossScopeEdge

/** Result of createGraphElements */
export interface GraphElements {
  parentNodes: ParentNodeElement[]
  nodes: CamperNodeElement[]
  edges: EdgeElement[]
}

/**
 * Create Cytoscape elements from graph data.
 *
 * `crossScopeEdges` and `crossScopeNodes` (both optional) are returned
 * separately by the server when `?cross_scope=true`. The nodes are the
 * out-of-scope endpoints of those edges — they're appended as normal camper
 * nodes (compound-grouped under their bunk) but tagged `cross_scope: true`
 * so the `node[?cross_scope]` selector ghosts them visually. They stay
 * clickable so users can open the detail panel for potential connections.
 *
 * Edges are tagged the same way so `edge[?cross_scope]` can ghost them, and
 * they participate in pair-counts so a same-pair in-scope + cross-scope
 * combination still renders as a multi-curve.
 */
export function createGraphElements(
  nodeData: GraphNodeData[],
  edgeData: GraphEdgeData[],
  bunksData: Record<number, string> | null | undefined,
  showEdges: ShowEdgesSettings,
  crossScopeEdges?: CrossScopeEdgeData[],
  crossScopeNodes?: GraphNodeData[]
): GraphElements {
  // Group nodes by bunk. In-scope bunks always exist, even when a cross-scope
  // ghost camper happens to share a bunk_cm_id with an in-scope camper (rare
  // but possible) — the in-scope side wins so the parent compound isn't
  // mistakenly tagged cross_scope.
  const bunkGroups: Record<number, GraphNodeData[]> = {}
  const crossScopeBunkIds = new Set<number>()

  nodeData.forEach((node) => {
    if (node.bunk_cm_id) {
      const bunkId = node.bunk_cm_id
      bunkGroups[bunkId] ??= []
      bunkGroups[bunkId].push(node)
    }
  })

  const ghostNodes = crossScopeNodes ?? []
  ghostNodes.forEach((node) => {
    if (node.bunk_cm_id && !bunkGroups[node.bunk_cm_id]) {
      // No in-scope camper in this bunk — register it as a ghost bunk so the
      // ghost camper still gets a parent compound (otherwise fcose floats it
      // free of any unit bubble and the layout looks broken).
      crossScopeBunkIds.add(node.bunk_cm_id)
      bunkGroups[node.bunk_cm_id] = []
    }
    if (node.bunk_cm_id) {
      bunkGroups[node.bunk_cm_id]!.push(node)
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
        ...(crossScopeBunkIds.has(bunkId) ? { cross_scope: true } : {}),
      },
    }
  })

  // Create camper nodes with parent property for compound grouping
  const ghostIds = new Set(ghostNodes.map((n) => n.id))
  const nodes: CamperNodeElement[] = [...nodeData, ...ghostNodes].map((node) => ({
    data: {
      id: node.id.toString(),
      label: `${node.name} (${formatGradeOrdinal(node.grade)})`,
      name: node.name,
      grade: node.grade,
      // centrality/clustering are computed graph metrics — the Pydantic model
      // declares defaults (0.0) so they're not in OpenAPI's required[] list,
      // and codegen emits them as optional. The server always populates them,
      // so 0 is a safe fallback that matches the schema default.
      centrality: node.centrality ?? 0,
      clustering: node.clustering ?? 0,
      satisfaction_status: node.satisfaction_status,
      parent_satisfaction_status: node.parent_satisfaction_status,
      staff_satisfaction_status: node.staff_satisfaction_status,
      bunk_cm_id: node.bunk_cm_id,
      community: node.community,
      parent: node.bunk_cm_id ? `bunk-${node.bunk_cm_id}` : undefined,
      ...(ghostIds.has(node.id) ? { cross_scope: true } : {}),
    },
  }))

  // Filter and create edges based on visibility settings.
  // The API only emits 'request' edges; this filter respects per-type
  // visibility toggles in case the type union is widened in the future.
  const visibleEdges = edgeData.filter((edge) => {
    const setting = showEdges[edge.edge_type as keyof ShowEdgesSettings]
    return setting !== false
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
  // Works on both GraphEdgeData and CrossScopeEdgeData (the relevant fields
  // are identically named on both shapes).
  const sameKind = (a: GraphEdgeData | CrossScopeEdgeData, b: GraphEdgeData | CrossScopeEdgeData) =>
    a.edge_type === b.edge_type && (a.request_type ?? null) === (b.request_type ?? null)

  const edges: EdgeElement[] = []
  let edgeIndex = 0

  const buildEdge = (
    e: GraphEdgeData,
    flags: { is_reciprocal: boolean; multi?: boolean }
  ): EdgeElement => ({
    data: {
      id: `edge-${edgeIndex++}`,
      source: e.source.toString(),
      target: e.target.toString(),
      edge_type: e.edge_type,
      // priority and confidence are nullable in the generated types (null → undefined)
      ...(e.priority != null ? { priority: e.priority } : {}),
      ...(e.confidence != null ? { confidence: e.confidence } : {}),
      is_reciprocal: flags.is_reciprocal,
      ...(e.request_type ? { request_type: e.request_type } : {}),
      ...(flags.multi ? { multi: true } : {}),
    },
  })

  // Cross-scope edges run through the same bucket → collapse → multi algorithm
  // as in-scope edges, just tagged `cross_scope: true` so the cytoscape
  // stylesheet ghosts them. Buckets are homogeneous: an edge between A and B
  // is either entirely in-scope (both endpoints in scope) or entirely
  // cross-scope (one endpoint outside scope), never mixed on the same pair.
  const buildCrossEdge = (
    e: CrossScopeEdgeData,
    flags: { is_reciprocal: boolean; multi?: boolean }
  ): EdgeElement => ({
    data: {
      id: `cross-edge-${edgeIndex++}`,
      source: e.source.toString(),
      target: e.target.toString(),
      edge_type: e.edge_type,
      ...(e.priority != null ? { priority: e.priority } : {}),
      ...(e.confidence != null ? { confidence: e.confidence } : {}),
      is_reciprocal: flags.is_reciprocal,
      ...(e.request_type ? { request_type: e.request_type } : {}),
      ...(flags.multi ? { multi: true } : {}),
      cross_scope: true,
    },
  })

  pairBuckets.forEach((bucket) => {
    if (bucket.length === 2) {
      // Only collapse when the two edges genuinely point opposite directions —
      // guards against backend duplicates (e.g., two A→B edges) being misread
      // as a mutual pair.
      const [first, second] = bucket as [GraphEdgeData, GraphEdgeData]
      if (
        first.source === second.target &&
        first.target === second.source &&
        sameKind(first, second)
      ) {
        edges.push(buildEdge(first, { is_reciprocal: true }))
        return
      }
    }

    // Otherwise, emit each edge separately. Pairs with 2+ edges get the
    // multi flag so the stylesheet curves them (true conflicts).
    const isMulti = bucket.length >= 2
    bucket.forEach((edge) => {
      edges.push(buildEdge(edge, { is_reciprocal: edge.reciprocal ?? false, multi: isMulti }))
    })
  })

  // Same algorithm, parallel pass over cross-scope edges. The buckets are
  // disjoint from pairBuckets by construction (an edge can't be both in-scope
  // and cross-scope on the same pair), so we don't need to coordinate counts
  // between the two passes.
  const crossEdges = crossScopeEdges ?? []
  const crossPairBuckets = new Map<string, CrossScopeEdgeData[]>()
  crossEdges.forEach((e) => {
    const k = pairKey(e.source, e.target)
    const bucket = crossPairBuckets.get(k) ?? []
    bucket.push(e)
    crossPairBuckets.set(k, bucket)
  })

  crossPairBuckets.forEach((bucket) => {
    if (bucket.length === 2) {
      const [first, second] = bucket as [CrossScopeEdgeData, CrossScopeEdgeData]
      if (
        first.source === second.target &&
        first.target === second.source &&
        sameKind(first, second)
      ) {
        edges.push(buildCrossEdge(first, { is_reciprocal: true }))
        return
      }
    }
    const isMulti = bucket.length >= 2
    bucket.forEach((edge) => {
      edges.push(buildCrossEdge(edge, { is_reciprocal: edge.reciprocal ?? false, multi: isMulti }))
    })
  })

  return { parentNodes, nodes, edges }
}
