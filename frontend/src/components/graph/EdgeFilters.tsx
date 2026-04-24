/**
 * EdgeFilters — edge visibility utilities
 *
 * The edge-filter UI (checkboxes, "Show edges:" label) has been removed.
 * Request and sibling edges are now always-on. The bunks/units toggles
 * have moved to the graph header top row in SocialNetworkGraph.
 *
 * This file is retained for the `getEdgeLabel` utility and the
 * `EdgeFiltersProps` / `showEdges` type surface used by the parent.
 */

import { EDGE_LABELS } from './constants'

export interface EdgeFiltersProps {
  /** Current edge visibility state (always-on; kept for prop compatibility) */
  showEdges: Record<string, boolean>
  /** Callback when edge filter changes (kept for prop compatibility) */
  onEdgeFilterChange: (filters: Record<string, boolean>) => void
  /** Whether bunk bubbles are visible */
  showBubbles: boolean
  /** Toggle bunk bubble visibility */
  onToggleBubbles: (show: boolean) => void
  /** Whether unit grouping is visible */
  showUnits?: boolean
  /** Toggle unit grouping visibility */
  onToggleUnits?: (show: boolean) => void
}

/**
 * Get display label for an edge type
 */
// eslint-disable-next-line react-refresh/only-export-components -- Utility function for edge label display
export function getEdgeLabel(type: string): string {
  return EDGE_LABELS[type] ?? type
}

/**
 * EdgeFilters renders nothing — the filter UI has been removed.
 * Request and sibling edges are hardcoded visible; bunks/units toggles
 * live in the graph header top row.
 */
export default function EdgeFilters(_props: EdgeFiltersProps) {
  return null
}
