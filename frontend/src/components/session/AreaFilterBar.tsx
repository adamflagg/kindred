/**
 * AreaFilterBar component
 * Extracted from SessionView.tsx - handles area filtering for bunks tab
 */

import type { Bunk, Camper } from '../../types/app-types';
import SessionStatsCompact from '../SessionStatsCompact';

export type BunkArea = 'all' | 'boys' | 'girls' | 'all-gender';

export interface AreaFilterBarProps {
  /** Currently selected area filter */
  selectedArea: BunkArea;
  /** Callback when area is changed */
  onAreaChange: (area: BunkArea) => void;
  /** Whether to show All-Gender option */
  showAgArea: boolean;
  /** Bunks for stats display */
  bunks: Bunk[];
  /** Campers for stats display */
  campers: Camper[];
  /** Default bunk capacity for stats */
  defaultCapacity: number;
  /** AG session CampMinder IDs for stats filtering */
  agSessionCmIds: number[];
}

/**
 * Get available areas based on whether AG is available
 */
// eslint-disable-next-line react-refresh/only-export-components -- Utility function for area options
export function getAvailableAreas(showAgArea: boolean): Record<string, string> {
  const baseAreas: Record<string, string> = {
    all: 'All',
    boys: 'Boys',
    girls: 'Girls',
  };

  return showAgArea ? { ...baseAreas, 'all-gender': 'All-Gender' } : baseAreas;
}

export default function AreaFilterBar({
  selectedArea,
  onAreaChange,
  showAgArea,
  bunks,
  campers,
  defaultCapacity,
  agSessionCmIds,
}: AreaFilterBarProps) {
  const availableAreas = getAvailableAreas(showAgArea);

  return (
    <div className="py-2.5 border-b border-border/50">
      <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Area selector as segmented buttons */}
          <div className="flex items-center gap-1 bg-muted/50 dark:bg-muted/30 rounded-xl p-1 border border-border/50">
            {Object.entries(availableAreas).map(([key, label]) => (
              <button
                key={key}
                onClick={() => onAreaChange(key as BunkArea)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200
                  ${
                    selectedArea === key
                      ? 'bg-primary text-primary-foreground shadow-lodge-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-muted/80'
                  }`}
              >
                {label}
              </button>
            ))}
          </div>

        {/* Stats */}
        <SessionStatsCompact
          bunks={bunks}
          campers={campers}
          defaultCapacity={defaultCapacity}
          selectedArea={selectedArea}
          agSessionCmIds={agSessionCmIds}
        />
      </div>
    </div>
  );
}
