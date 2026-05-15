/**
 * Types for social network graph data
 */

export interface GraphNode {
  id: number
  name: string
  grade: number | null
  bunk_cm_id: number | null
  centrality: number
  clustering: number
  community: number | null
  satisfaction_status?: 'satisfied' | 'unsatisfied' | 'no_requests'
  // Stage 2 parent-paramount split. Both fields drive 3b's parent/staff edge
  // filter checkbox; in 3a, only parent_satisfaction_status is rendered as the
  // node border color.
  parent_satisfaction_status?: 'satisfied' | 'unsatisfied' | 'no_requests'
  staff_satisfaction_status?: 'satisfied' | 'unsatisfied' | 'no_requests'
  // Legacy fields that may still be referenced
  age?: number
  sex?: string
  degree_centrality?: number
  betweenness_centrality?: number
  isolated?: boolean
}

export interface GraphEdge {
  source: number
  target: number
  weight: number
  /** Edge type. Always 'request' — the API only emits request edges. */
  edge_type: string
  reciprocal: boolean
  request_type?: string // 'bunk_with' | 'not_bunk_with' for edge_type='request' edges
  confidence?: number // AI confidence score for request edges
  metadata?: Record<string, unknown> // Additional edge metadata
  // Legacy fields that may still be referenced
  is_reciprocal?: boolean
}

export interface GraphMetrics {
  density: number
  average_clustering: number
  number_of_components: number
  average_degree: number
  [key: string]: number
}

/** Shape of a cross-scope edge as serialized by the Python CrossScopeEdge
 *  Pydantic model. Pydantic emits `null` for absent Optional fields (not
 *  `undefined`), so nullable required fields are typed `T | null`. */
export interface CrossScopeEdge {
  source: number
  target: number
  edge_type: string
  weight: number
  request_type: string | null
  confidence: number | null
  reciprocal: boolean
  cross_scope: true
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  metrics: GraphMetrics
  // Session-level only. The bunk-graph endpoint (BunkGraphResponse) does not
  // emit this field, and the same GraphCacheService stores both shapes.
  communities?: Record<number, number[]>
  warnings?: string[]
  layout_positions?: Record<number, [number, number]>
  edge_type_counts?: Record<string, number>
  /** Edges crossing the scope boundary when ?cross_scope=true. Frontend
   *  renders these as ghosted to show context without polluting the layout.
   *  Shape mirrors the Python CrossScopeEdge Pydantic model. */
  cross_scope_edges?: CrossScopeEdge[]
  /** Out-of-scope endpoints of cross_scope_edges. Frontend renders these as
   *  ghosted-but-clickable nodes so users can click through to a potential
   *  connection, while the layout still treats the in-scope set as the focus. */
  cross_scope_nodes?: GraphNode[]
}
