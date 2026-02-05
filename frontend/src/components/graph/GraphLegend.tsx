/**
 * GraphLegend component
 * Extracted from SocialNetworkGraph.tsx - displays legend for graph elements
 */

import { formatGradeOrdinal } from '../../utils/gradeUtils'
import { EDGE_COLORS, GRADE_COLORS, CONFIDENCE_LEVELS } from './constants'

export interface GraphLegendProps {
  /** Optional custom edge colors (defaults to EDGE_COLORS) */
  edgeColors?: Record<string, string>
  /** Optional custom grade colors (defaults to GRADE_COLORS) */
  gradeColors?: Record<number, string>
}

export default function GraphLegend({
  edgeColors = EDGE_COLORS,
  gradeColors = GRADE_COLORS,
}: GraphLegendProps) {
  return (
    <div className="bg-card/95 border-border shadow-lodge-sm absolute right-4 bottom-4 space-y-2 rounded-xl border p-3 text-xs backdrop-blur-sm">
      {/* Edge Types */}
      <div>
        <div className="mb-1 font-medium">Edge Types</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-4" style={{ backgroundColor: edgeColors['request'] }} />
            <span>Bunk Request</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-4" style={{ backgroundColor: edgeColors['historical'] }} />
            <span>Historical</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-4" style={{ backgroundColor: edgeColors['sibling'] }} />
            <span>Sibling</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-4" style={{ backgroundColor: edgeColors['school'] }} />
            <span>Classmates</span>
          </div>
        </div>
      </div>

      {/* Node Status */}
      <div>
        <div className="mb-1 font-medium">Node Status</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full border-2 border-green-600 bg-gray-400" />
            <span>Satisfied</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full border-2 border-yellow-600 bg-gray-400" />
            <span>Partial</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full border-2 border-red-600 bg-gray-400" />
            <span>Isolated</span>
          </div>
        </div>
      </div>

      {/* Confidence */}
      <div>
        <div className="mb-1 font-medium">Edge Confidence</div>
        <div className="space-y-1 text-xs">
          {CONFIDENCE_LEVELS.map((level) => (
            <div key={level.label} className="flex items-center gap-2">
              <div className="bg-primary h-0.5 w-8" style={{ opacity: level.opacity }} />
              <span>{level.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Grade Colors */}
      <div>
        <div className="text-muted-foreground mb-1 text-xs font-medium">Grade Colors</div>
        <div className="grid grid-cols-3 gap-1 text-xs">
          {Object.entries(gradeColors)
            .slice(0, 12)
            .map(([grade, color]) => (
              <div key={grade} className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                <span>{formatGradeOrdinal(parseInt(grade))}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
