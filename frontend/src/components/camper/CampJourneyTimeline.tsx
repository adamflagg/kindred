/**
 * Sidebar timeline showing camper's historical camp records
 * Compact left-aligned layout
 */
import { TreePine, Home } from 'lucide-react'
import { getSessionDisplayNameFromString } from '../../utils/sessionDisplay'
import { getStatusIndicator } from '../../utils/enrollmentFilter'
import type { HistoricalRecord } from '../../hooks/camper/types'
import { getCampTagline } from '../../config/branding'

interface CampJourneyTimelineProps {
  history: HistoricalRecord[]
  yearsAtCamp: number
  currentYear: number
}

export function CampJourneyTimeline({
  history,
  yearsAtCamp,
  currentYear,
}: CampJourneyTimelineProps) {
  return (
    <div className="bg-card border-border overflow-hidden rounded-2xl border shadow-sm">
      {/* Header - original styling */}
      <div className="from-forest-600 to-forest-700 bg-gradient-to-r px-5 py-4">
        <h2 className="font-display flex items-center gap-2 text-lg font-bold text-white">
          <TreePine className="h-5 w-5" />
          Camp Journey
        </h2>
        <p className="text-forest-200 mt-1 text-sm">
          {yearsAtCamp} {getCampTagline()}
        </p>
      </div>

      <div className="p-5">
        {history.length > 0 ? (
          <div className="relative">
            {/* Left-aligned timeline line */}
            <div className="from-forest-300 via-forest-400 to-forest-300 dark:from-forest-700 dark:via-forest-600 dark:to-forest-700 absolute top-1 bottom-1 left-[5px] w-0.5 bg-gradient-to-b" />

            {/* Timeline items */}
            <div className="space-y-2">
              {history.map((record, idx) => {
                const isCurrentYear = record.year === currentYear
                // Hide year label if same year as previous record (multi-session)
                const prevRecord = idx > 0 ? history[idx - 1] : null
                const showYear = prevRecord?.year !== record.year
                const statusIndicator = getStatusIndicator(record.attendeeStatus)

                return (
                  <div
                    key={`${record.year}-${record.sessionName}-${idx}`}
                    className={`relative flex items-center gap-3 ${isCurrentYear ? '' : 'opacity-75'}`}
                  >
                    {/* Left dot */}
                    <div
                      className={`relative z-10 flex-shrink-0 rounded-full ${
                        isCurrentYear
                          ? statusIndicator
                            ? 'h-3 w-3 bg-amber-400 ring-2 ring-amber-100 dark:bg-amber-600 dark:ring-amber-900'
                            : 'bg-forest-600 ring-forest-100 dark:ring-forest-900 h-3 w-3 ring-2'
                          : 'bg-forest-400 dark:bg-forest-600 h-3 w-3'
                      }`}
                    />

                    {/* Year - hidden for subsequent same-year records */}
                    <span
                      className={`font-display w-12 font-bold ${
                        isCurrentYear
                          ? 'text-forest-700 dark:text-forest-300 text-base'
                          : 'text-foreground/80'
                      }`}
                    >
                      {showYear ? record.year : ''}
                    </span>

                    {/* Session */}
                    <span className="text-muted-foreground truncate text-sm">
                      {getSessionDisplayNameFromString(record.sessionName, record.sessionType)}
                    </span>

                    {/* Status indicator for non-enrolled */}
                    {statusIndicator && (
                      <span
                        className={`flex-shrink-0 rounded px-1 py-0.5 text-[10px] leading-none font-bold ${statusIndicator.colorClass}`}
                        title={record.attendeeStatus}
                      >
                        {statusIndicator.letter}
                      </span>
                    )}

                    {/* Bunk — only for enrolled records that actually have a label.
                        No-bunk prior years (teen / 2022 gap / family) show no segment. */}
                    {!statusIndicator && record.bunkName !== undefined && (
                      <>
                        <span className="text-muted-foreground">·</span>

                        {/* Bunk */}
                        <span
                          className={`flex items-center gap-1 truncate text-sm ${
                            record.bunkName === 'Unassigned'
                              ? 'text-amber-600 italic dark:text-amber-400'
                              : 'text-foreground font-medium'
                          }`}
                        >
                          <Home className="h-3.5 w-3.5 flex-shrink-0 opacity-60" />
                          {record.bunkName}
                        </span>
                      </>
                    )}

                    {/* Current badge - only on first current-year enrolled record */}
                    {isCurrentYear && showYear && !statusIndicator && (
                      <span className="bg-forest-600 ml-auto flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white">
                        Now
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="py-4 text-center">
            <TreePine className="text-muted-foreground/50 mx-auto mb-2 h-8 w-8" />
            <p className="text-muted-foreground text-sm">First summer at camp!</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default CampJourneyTimeline
