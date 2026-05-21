/**
 * Types for social network graph data
 *
 * These shapes are fetched once and cached in `GraphCacheService`, then read by
 * multiple subscribers (graph components, the layout worker, the bubble
 * renderer). `readonly` makes the shared-cache contract explicit at the type
 * level: a stray in-place mutation (`.push`/`.sort`/field reassignment) on the
 * cached instance would corrupt every consumer, so the compiler forbids it.
 * Defensive copies (`[...nodes]`, `.map(...)`) are unaffected.
 */

export interface GraphNode {
  readonly id: number
  readonly name: string
  readonly grade: number | null
  readonly bunk_cm_id: number | null
  readonly centrality: number
  readonly clustering: number
  readonly community: number | null
  readonly satisfaction_status?: 'satisfied' | 'unsatisfied' | 'no_requests'
  // Stage 2 parent-paramount split. Both fields drive 3b's parent/staff edge
  // filter checkbox; in 3a, only parent_satisfaction_status is rendered as the
  // node border color.
  readonly parent_satisfaction_status?: 'satisfied' | 'unsatisfied' | 'no_requests'
  readonly staff_satisfaction_status?: 'satisfied' | 'unsatisfied' | 'no_requests'
  // Legacy fields that may still be referenced
  readonly age?: number
  readonly sex?: string
  readonly degree_centrality?: number
  readonly betweenness_centrality?: number
  readonly isolated?: boolean
}

export interface GraphEdge {
  readonly source: number
  readonly target: number
  readonly weight: number
  /** Edge type. Always 'request' — the API only emits request edges. */
  readonly edge_type: string
  readonly reciprocal: boolean
  readonly request_type?: string // 'bunk_with' | 'not_bunk_with' for edge_type='request' edges
  readonly confidence?: number // AI confidence score for request edges
  readonly metadata?: Record<string, unknown> // Additional edge metadata
  // Legacy fields that may still be referenced
  readonly is_reciprocal?: boolean
}

export interface GraphMetrics {
  readonly density: number
  readonly average_clustering: number
  readonly number_of_components: number
  readonly average_degree: number
  readonly [key: string]: number
}

/** Shape of a cross-scope edge as serialized by the Python CrossScopeEdge
 *  Pydantic model. Pydantic emits `null` for absent Optional fields (not
 *  `undefined`), so nullable required fields are typed `T | null`. */
export interface CrossScopeEdge {
  readonly source: number
  readonly target: number
  readonly edge_type: string
  readonly weight: number
  readonly request_type: string | null
  readonly confidence: number | null
  readonly reciprocal: boolean
  readonly cross_scope: true
}

export interface GraphData {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  readonly metrics: GraphMetrics
  // Session-level only. The bunk-graph endpoint (BunkGraphResponse) does not
  // emit this field, and the same GraphCacheService stores both shapes.
  readonly communities?: Record<number, readonly number[]>
  readonly warnings?: readonly string[]
  readonly layout_positions?: Record<number, readonly [number, number]>
  readonly edge_type_counts?: Record<string, number>
  /** Edges crossing the scope boundary when ?cross_scope=true. Frontend
   *  renders these as ghosted to show context without polluting the layout.
   *  Shape mirrors the Python CrossScopeEdge Pydantic model. */
  readonly cross_scope_edges?: readonly CrossScopeEdge[]
  /** Out-of-scope endpoints of cross_scope_edges. Frontend renders these as
   *  ghosted-but-clickable nodes so users can click through to a potential
   *  connection, while the layout still treats the in-scope set as the focus. */
  readonly cross_scope_nodes?: readonly GraphNode[]
}
