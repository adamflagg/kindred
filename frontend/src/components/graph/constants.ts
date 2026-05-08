/**
 * Graph visualization constants
 * Extracted from SocialNetworkGraph.tsx
 */

// Grade color scheme - using a rainbow gradient
export const GRADE_COLORS: Record<number, string> = {
  1: '#e74c3c', // Red
  2: '#e67e22', // Orange
  3: '#f39c12', // Yellow-Orange
  4: '#f1c40f', // Yellow
  5: '#2ecc71', // Green
  6: '#27ae60', // Dark Green
  7: '#16a085', // Teal
  8: '#3498db', // Blue
  9: '#2980b9', // Dark Blue
  10: '#9b59b6', // Purple
  11: '#8e44ad', // Dark Purple
  12: '#34495e', // Dark Gray
}

// Edge type colors
//
// `request` is the positive bunk-with edge (blue). `not_bunk_with` is the
// negative request keyed off `request_type` since the API ships both as
// type='request' (the negative edge differs only by request_type).
export const EDGE_COLORS: Record<string, string> = {
  request: '#3498db',
  not_bunk_with: '#e74c3c',
  bundled: '#9b59b6',
}

// Node satisfaction status colors (for borders).
// - green: ≥1 request satisfied
// - red:   has requests, 0 satisfied
// - gray:  no requests at all (nothing to satisfy — neutral)
// `partial` from the backend is collapsed into `satisfied` (any satisfied request → green).
export const STATUS_COLORS: Record<string, string> = {
  satisfied: '#27ae60', // Green
  partial: '#27ae60', // Green (collapsed: any satisfied → green)
  unsatisfied: '#e74c3c', // Red
  no_requests: '#94a3b8', // Gray (slate-400) — nothing to satisfy
  default: '#2c3e50', // Gray (fallback for unknown values)
}

// Edge type display labels
export const EDGE_LABELS: Record<string, string> = {
  request: 'Requests',
}

/**
 * Get display label for an edge type
 */
export function getEdgeLabel(type: string): string {
  return EDGE_LABELS[type] ?? type
}

// Zoom settings
export const ZOOM_SETTINGS = {
  inMultiplier: 1.2,
  outMultiplier: 0.8,
  min: 0.1,
  max: 10,
} as const

/**
 * Density threshold for hiding labels at a given zoom level. Lower zoom →
 * higher threshold (hide more aggressively); higher zoom → lower threshold
 * (show more labels).
 */
export function labelDensityThreshold(zoom: number): number {
  if (zoom < 0.5) return 0.8
  if (zoom < 0.7) return 0.6
  return 0.4
}
