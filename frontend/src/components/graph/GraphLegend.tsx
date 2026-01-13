/**
 * GraphLegend component
 * Extracted from SocialNetworkGraph.tsx - displays legend for graph elements
 */

import { formatGradeOrdinal } from '../../utils/gradeUtils';
import { EDGE_COLORS, GRADE_COLORS, CONFIDENCE_LEVELS } from './constants';

export interface GraphLegendProps {
  /** Optional custom edge colors (defaults to EDGE_COLORS) */
  edgeColors?: Record<string, string>;
  /** Optional custom grade colors (defaults to GRADE_COLORS) */
  gradeColors?: Record<number, string>;
}

export default function GraphLegend({
  edgeColors = EDGE_COLORS,
  gradeColors = GRADE_COLORS,
}: GraphLegendProps) {
  return (
    <div className="absolute bottom-4 right-4 bg-card/95 backdrop-blur-sm border border-border rounded-xl p-3 text-xs space-y-2 shadow-lodge-sm">
      {/* Edge Types */}
      <div>
        <div className="font-medium mb-1">Edge Types</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-0.5"
              style={{ backgroundColor: edgeColors['request'] }}
            />
            <span>Bunk Request</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-0.5"
              style={{ backgroundColor: edgeColors['historical'] }}
            />
            <span>Historical</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-0.5"
              style={{ backgroundColor: edgeColors['sibling'] }}
            />
            <span>Sibling</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-0.5"
              style={{ backgroundColor: edgeColors['school'] }}
            />
            <span>Classmates</span>
          </div>
        </div>
      </div>

      {/* Node Status */}
      <div>
        <div className="font-medium mb-1">Node Status</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gray-400 border-2 border-green-600" />
            <span>Satisfied</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gray-400 border-2 border-yellow-600" />
            <span>Partial</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gray-400 border-2 border-red-600" />
            <span>Isolated</span>
          </div>
        </div>
      </div>

      {/* Confidence */}
      <div>
        <div className="font-medium mb-1">Edge Confidence</div>
        <div className="space-y-1 text-xs">
          {CONFIDENCE_LEVELS.map((level) => (
            <div key={level.label} className="flex items-center gap-2">
              <div
                className="w-8 h-0.5 bg-primary"
                style={{ opacity: level.opacity }}
              />
              <span>{level.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Grade Colors */}
      <div>
        <div className="text-xs font-medium mb-1 text-muted-foreground">
          Grade Colors
        </div>
        <div className="grid grid-cols-3 gap-1 text-xs">
          {Object.entries(gradeColors)
            .slice(0, 12)
            .map(([grade, color]) => (
              <div key={grade} className="flex items-center gap-1">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span>{formatGradeOrdinal(parseInt(grade))}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
