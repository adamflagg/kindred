/**
 * GraphLegend component
 * Extracted from SocialNetworkGraph.tsx - displays legend for graph elements
 */

import { formatGradeOrdinal } from '../../utils/gradeUtils'
import { EDGE_COLORS, GRADE_COLORS } from './constants'

export interface GraphLegendProps {
  /** Optional custom edge colors (defaults to EDGE_COLORS) */
  edgeColors?: Record<string, string>
  /** Optional custom grade colors (defaults to GRADE_COLORS) */
  gradeColors?: Record<number, string>
  /** Set of grades present in graph data. When provided, only these grades are shown. */
  existingGrades?: Set<number>
}

export default function GraphLegend({
  edgeColors = EDGE_COLORS,
  gradeColors = GRADE_COLORS,
  existingGrades,
}: GraphLegendProps) {
  return (
    <div className="bg-card/95 border-border shadow-lodge-sm absolute right-4 bottom-4 z-10 space-y-2 rounded-xl border p-3 text-xs backdrop-blur-sm">
      {/* Edge Types */}
      <div>
        <div className="mb-1 font-medium">Edge Types</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <svg width="20" height="6" className="flex-shrink-0">
              <line
                x1="0"
                y1="3"
                x2="20"
                y2="3"
                stroke={edgeColors['request']}
                strokeWidth="2"
                strokeDasharray="4 2"
              />
            </svg>
            <span>Bunk Request</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="20" height="6" className="flex-shrink-0">
              <line
                x1="0"
                y1="3"
                x2="20"
                y2="3"
                stroke={edgeColors['not_bunk_with']}
                strokeWidth="2"
                strokeDasharray="4 2"
              />
            </svg>
            <span>Don't Bunk With</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="20" height="8" className="flex-shrink-0">
              <line x1="0" y1="4" x2="20" y2="4" stroke={edgeColors['request']} strokeWidth="3" />
            </svg>
            <span>Mutual request</span>
          </div>
        </div>
      </div>

      {/* Camper request status */}
      <div>
        <div className="mb-1 font-medium">Camper request status</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full border-2 border-green-600 bg-gray-400" />
            <span>1+ satisfied requests</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full border-2 border-red-600 bg-gray-400" />
            <span>0 satisfied requests</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full border-2 border-slate-400 bg-gray-400" />
            <span>No requests</span>
          </div>
        </div>
      </div>

      {/* Grade Colors */}
      <div>
        <div className="text-muted-foreground mb-1 text-xs font-medium">Grade Colors</div>
        <div className="grid grid-cols-3 gap-1 text-xs">
          {Object.entries(gradeColors)
            .filter(([grade]) => !existingGrades || existingGrades.has(parseInt(grade)))
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
