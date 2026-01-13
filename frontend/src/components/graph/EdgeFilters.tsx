/**
 * EdgeFilters component
 * Extracted from SocialNetworkGraph.tsx - handles edge type filtering
 */

import { Filter } from 'lucide-react';
import { EDGE_COLORS, EDGE_LABELS } from './constants';

export interface EdgeFiltersProps {
  /** Current edge visibility state */
  showEdges: Record<string, boolean>;
  /** Callback when edge filter changes */
  onEdgeFilterChange: (filters: Record<string, boolean>) => void;
  /** Whether bunk bubbles are visible */
  showBubbles: boolean;
  /** Toggle bunk bubble visibility */
  onToggleBubbles: (show: boolean) => void;
}

/**
 * Get display label for an edge type
 */
// eslint-disable-next-line react-refresh/only-export-components -- Utility function for edge label display
export function getEdgeLabel(type: string): string {
  return EDGE_LABELS[type] || type;
}

export default function EdgeFilters({
  showEdges,
  onEdgeFilterChange,
  showBubbles,
  onToggleBubbles,
}: EdgeFiltersProps) {
  const handleEdgeToggle = (type: string, enabled: boolean) => {
    onEdgeFilterChange({ ...showEdges, [type]: enabled });
  };

  return (
    <div className="mt-4 flex items-center gap-4">
      <span className="text-sm text-muted-foreground flex items-center gap-2">
        <Filter className="w-4 h-4" />
        Show edges:
      </span>

      {Object.entries(showEdges).map(([type, enabled]) => (
        <label key={type} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => handleEdgeToggle(type, e.target.checked)}
            className="rounded"
          />
          <span className="flex items-center gap-1">
            <span
              className="w-3 h-0.5"
              style={{ backgroundColor: EDGE_COLORS[type] }}
            />
            {getEdgeLabel(type)}
          </span>
        </label>
      ))}

      {/* Bunk Bubbles Toggle */}
      <label className="flex items-center gap-2 text-sm ml-4">
        <input
          type="checkbox"
          checked={showBubbles}
          onChange={(e) => onToggleBubbles(e.target.checked)}
          className="rounded"
        />
        <span>Show Bunk Bubbles</span>
      </label>
    </div>
  );
}
