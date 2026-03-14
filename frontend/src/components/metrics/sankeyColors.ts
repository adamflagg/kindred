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
export function buildCmIdColorMap(nodes: Array<{ cmId: number | null }>): Map<number, string> {
  const map = new Map<number, string>()
  let colorIdx = 0
  for (const node of nodes) {
    if (node.cmId != null && !map.has(node.cmId)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- modulo of non-empty constant array always produces valid index
      map.set(node.cmId, SESSION_COLORS[colorIdx % SESSION_COLORS.length]!)
      colorIdx++
    }
  }
  return map
}

/**
 * Resolve the display color for a node or node-like object.
 *
 * Recharts Sankey passes `payload.source` and `payload.target` as full node
 * objects (not numeric indices), so this accepts any object with a `cmId`.
 */
export function resolveNodeColor(
  node: { cmId?: number | null },
  cmIdColorMap: Map<number, string>
): string {
  if (node.cmId == null) return DID_NOT_RETURN_COLOR
  return cmIdColorMap.get(node.cmId) ?? DID_NOT_RETURN_COLOR
}
