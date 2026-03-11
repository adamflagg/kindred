/**
 * Color utilities for SessionFlowSankey.
 *
 * Extracted to a separate file so the component file only exports React
 * components (required by react-refresh/only-export-components).
 */

// Unified palette: each cm_id gets one color regardless of source/target side
export const SESSION_COLORS = [
  '#059669',
  '#2563eb',
  '#7c3aed',
  '#d97706',
  '#dc2626',
  '#0891b2',
  '#c026d3',
  '#65a30d',
]

export const DID_NOT_RETURN_COLOR = '#9ca3af'

/** Build a map from CampMinder session ID to a palette color. */
export function buildCmIdColorMap(
  _nodes: Array<{ cmId: number | null }>,
): Map<number, string> {
  // TODO: implement
  return new Map()
}

/** Resolve the display color for a node (or node-like object from Recharts). */
export function resolveNodeColor(
  _node: { cmId?: number | null },
  _cmIdColorMap: Map<number, string>,
): string {
  // TODO: implement
  return DID_NOT_RETURN_COLOR
}
