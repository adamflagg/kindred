/**
 * Sidebar timeline showing camper's historical camp records
 * Compact left-aligned layout
 */
import { TreePine, Home } from 'lucide-react';
import { getSessionDisplayNameFromString } from '../../utils/sessionDisplay';
import type { HistoricalRecord } from '../../hooks/camper/types';
import { getCampTagline } from '../../config/branding';

interface CampJourneyTimelineProps {
  history: HistoricalRecord[];
  yearsAtCamp: number;
  currentYear: number;
}

export function CampJourneyTimeline({
  history,
  yearsAtCamp,
  currentYear,
}: CampJourneyTimelineProps) {
  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
      {/* Header - original styling */}
      <div className="bg-gradient-to-r from-forest-600 to-forest-700 px-5 py-4">
        <h2 className="text-lg font-display font-bold text-white flex items-center gap-2">
          <TreePine className="w-5 h-5" />
          Camp Journey
        </h2>
        <p className="text-forest-200 text-sm mt-1">
          {yearsAtCamp} {getCampTagline()}
        </p>
      </div>

      <div className="p-5">
        {history.length > 0 ? (
          <div className="relative">
            {/* Left-aligned timeline line */}
            <div className="absolute left-[5px] top-1 bottom-1 w-0.5 bg-gradient-to-b from-forest-300 via-forest-400 to-forest-300 dark:from-forest-700 dark:via-forest-600 dark:to-forest-700" />

            {/* Timeline items */}
            <div className="space-y-2">
              {history.map((record, idx) => {
                const isCurrentYear = record.year === currentYear;

                return (
                  <div
                    key={`${record.year}-${record.sessionName}-${idx}`}
                    className={`relative flex items-center gap-3 ${isCurrentYear ? '' : 'opacity-75'}`}
                  >
                    {/* Left dot */}
                    <div
                      className={`relative z-10 flex-shrink-0 rounded-full ${
                        isCurrentYear
                          ? 'w-3 h-3 bg-forest-600 ring-2 ring-forest-100 dark:ring-forest-900'
                          : 'w-3 h-3 bg-forest-400 dark:bg-forest-600'
                      }`}
                    />

                    {/* Year */}
                    <span
                      className={`font-display font-bold w-12 ${
                        isCurrentYear
                          ? 'text-forest-700 dark:text-forest-300 text-base'
                          : 'text-foreground/80'
                      }`}
                    >
                      {record.year}
                    </span>

                    {/* Session */}
                    <span className="text-sm text-muted-foreground truncate">
                      {getSessionDisplayNameFromString(
                        record.sessionName,
                        record.sessionType
                      )}
                    </span>

                    <span className="text-muted-foreground">·</span>

                    {/* Bunk */}
                    <span
                      className={`text-sm truncate flex items-center gap-1 ${
                        record.bunkName === 'Unassigned'
                          ? 'text-amber-600 dark:text-amber-400 italic'
                          : 'text-foreground font-medium'
                      }`}
                    >
                      <Home className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />
                      {record.bunkName}
                    </span>

                    {/* Current badge */}
                    {isCurrentYear && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-forest-600 text-white rounded ml-auto flex-shrink-0">
                        Now
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="text-center py-4">
            <TreePine className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">
              First summer at camp!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default CampJourneyTimeline;
