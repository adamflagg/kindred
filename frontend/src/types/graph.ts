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
  // Backend may still emit 'partial' for older cached graphs; frontend treats it as 'satisfied'.
  satisfaction_status?: 'satisfied' | 'partial' | 'isolated' | 'no_requests'
  // Stage 2 parent-paramount split. parent_satisfaction_status drives the border
  // color (parent paramount); staff_satisfaction_status flows through but is not
  // currently rendered on the graph.
  parent_satisfaction_status?: 'satisfied' | 'isolated' | 'no_requests'
  staff_satisfaction_status?: 'satisfied' | 'isolated' | 'no_requests'
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
  type: string
  reciprocal: boolean
  request_type?: string // 'bunk_with' | 'not_bunk_with' for type='request' edges
  confidence?: number // AI confidence score for request edges
  priority?: number // Priority level for request edges
  metadata?: Record<string, unknown> // Additional edge metadata (e.g., location for classmate edges)
  // Legacy fields that may still be referenced
  edge_type?: string
  is_reciprocal?: boolean
}

export interface GraphMetrics {
  density: number
  average_clustering: number
  number_of_components: number
  average_degree: number
  [key: string]: number
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
}
