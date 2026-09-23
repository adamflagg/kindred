/**
 * Sidebar timeline showing camper's historical camp records
 * Compact left-aligned layout
 */
import { TreePine } from 'lucide-react'
import { journeyCountLabel } from '../../utils/journeyCountLabel'
import { JourneyRows, type JourneyVariant } from './JourneyRows'
import { journeyRowsFromHistory } from './journeyRowModel'
import type { HistoricalRecord, JourneyCounts } from '../../hooks/camper/types'

interface CampJourneyTimelineProps {
  history: HistoricalRecord[]
  counts: JourneyCounts
  currentYear: number
  /**
   * The journey is still loading. An empty history then means "not here
   * yet", not "first year" — showing the empty state would make every
   * returning guest read as a first-timer.
   */
  isLoading?: boolean
  /**
   * The feed failed. Same reasoning as `isLoading`: an empty history here
   * means "couldn't tell", not "first year" (CR #1, kindred#2753) — a failed
   * fetch used to read as indistinguishable from an actual first-timer.
   */
  error?: Error | null
  /**
   * `full` on the camper record page; `compact` in a sidebar (the
   * Women's/Men's Weekend guest sidebar) — see `JourneyRows`.
   */
  variant?: JourneyVariant
}

export function CampJourneyTimeline({
  history,
  counts,
  currentYear,
  isLoading = false,
  error = null,
  variant = 'full',
}: CampJourneyTimelineProps) {
  const countLabel = journeyCountLabel(counts)
  return (
    <div className="bg-card border-border overflow-hidden rounded-2xl border shadow-sm">
      {/* Header - original styling */}
      <div className="from-forest-600 to-forest-700 bg-gradient-to-r px-5 py-4">
        <h2 className="font-display flex items-center gap-2 text-lg font-bold text-white">
          <TreePine className="h-5 w-5" />
          Camp Journey
        </h2>
        {/* The shared count line, the same on every journey surface: summers are
            CampMinder's own years_at_camp (summer + teen); family and adult
            weekends are counted from enrollments. Zero parts are hidden, and
            so is the whole line when nothing counts. */}
        {countLabel.length > 0 && <p className="text-forest-200 mt-1 text-sm">{countLabel}</p>}
      </div>

      <div className="p-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <div className="border-muted border-t-primary h-5 w-5 animate-spin rounded-full border-2" />
            <span className="text-muted-foreground ml-2 text-sm">Loading...</span>
          </div>
        ) : error ? (
          <div className="py-4 text-center">
            <p className="text-sm text-red-500">Couldn't load past years</p>
          </div>
        ) : history.length > 0 ? (
          // The rows are shared with the board modal (`JourneyRows`, owner
          // ruling 2026-09-22 G2: one grid, so every cabin lines up).
          <JourneyRows rows={journeyRowsFromHistory(history, currentYear)} variant={variant} />
        ) : (
          <div className="py-4 text-center">
            <TreePine className="text-muted-foreground/50 mx-auto mb-2 h-8 w-8" />
            {/* Program-agnostic (#2113): a family-camp-only or teen-only
                first year should not read as "summer" */}
            <p className="text-muted-foreground text-sm">First year at camp!</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default CampJourneyTimeline
