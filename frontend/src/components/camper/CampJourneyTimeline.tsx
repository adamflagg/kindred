/**
 * Sidebar timeline showing camper's historical camp records
 * Compact left-aligned layout
 */
import { TreePine, Home } from 'lucide-react'
import { getSessionDisplayNameFromString } from '../../utils/sessionDisplay'
import { weekendSubtitle } from '../weekend/weekendNames'
import { getStatusIndicator } from '../../utils/enrollmentFilter'
import { isFamilySessionType } from '../../utils/sessionTypePredicates'
import { journeyCountLabel } from '../../utils/journeyCountLabel'
import { Tooltip } from '../ui/Tooltip'
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
}

export function CampJourneyTimeline({
  history,
  counts,
  currentYear,
  isLoading = false,
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
        ) : history.length > 0 ? (
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

                    {/* Year - hidden for subsequent same-year records. Fixed
                        width AND flex-shrink-0: it must not shrink when the
                        session/cabin spans below it are fighting for room. */}
                    <span
                      className={`font-display w-12 flex-shrink-0 font-bold ${
                        isCurrentYear
                          ? 'text-forest-700 dark:text-forest-300 text-base'
                          : 'text-foreground/80'
                      }`}
                    >
                      {showYear ? record.year : ''}
                    </span>

                    {/* Session. `min-w-0` is what lets a flex child shrink
                        below its `truncate`d content's intrinsic width —
                        without it `truncate`'s own white-space: nowrap sets
                        the item's minimum to the full un-wrapped text, and a
                        long session name pushes the cabin segment off the
                        card instead of ellipsizing. */}
                    <span className="text-muted-foreground min-w-0 truncate text-sm">
                      {getSessionDisplayNameFromString(record.sessionName, record.sessionType)}
                    </span>

                    {/* Which family weekend it was — Keshet, JFAM, JFoC, the
                        holiday. The title beside it is "Family Camp 3", so
                        this is the half that tells two numbered weekends
                        apart, and it is the half CampMinder buries in a
                        54-character name. Muted and one size down: it
                        qualifies the session, it is not a second session. */}
                    {isFamilySessionType(record.sessionType) &&
                      weekendSubtitle(record.sessionName).length > 0 && (
                        <span className="text-muted-foreground/70 flex-shrink-0 text-xs">
                          {weekendSubtitle(record.sessionName)}
                        </span>
                      )}

                    {/* NO "Family" TAG. #2113 added one when family rows first
                        entered this timeline, so a reader could visually skip a
                        run of them. The mid-form session name now begins
                        "Family Camp", which says the same thing in the place a
                        reader is already looking — owner, 2026-08-18: "we also
                        dont need the 'family' tag in the journey, staff
                        knows." */}

                    {/* Status indicator for non-enrolled */}
                    {statusIndicator && (
                      <span
                        className={`flex-shrink-0 rounded px-1 py-0.5 text-[10px] leading-none font-bold ${statusIndicator.colorClass}`}
                        title={record.attendeeStatus}
                      >
                        {statusIndicator.letter}
                      </span>
                    )}

                    {/* Housing — only for enrolled records that actually have a label.
                        A bunk name for summer/teen; the household's resolved
                        family-camp cabin for family (kindred#2466), or the
                        server-attributed adult-weekend cabin for adult
                        (both TODAY's registry name, kindred#2332 pattern) —
                        never the CampMinder day group, which
                        `fetchCamperJourney` drops before this component ever
                        sees it. No-label prior years (teen / 2022 gap /
                        unresolved housing) show no segment. */}
                    {!statusIndicator && record.bunkName !== undefined && (
                      <>
                        <span className="text-muted-foreground flex-shrink-0">·</span>

                        {/* Bunk/cabin. `min-w-0` lets this shrink below its
                            content's intrinsic width — see the session span
                            above for why. The Home icon stays fixed
                            (flex-shrink-0). `truncate` (text-overflow) does
                            NOTHING on this span itself: it's `display:flex`,
                            and text-overflow only applies to a block
                            container. It has to sit on the element that
                            actually holds the TEXT, below — a plain `<span>`
                            for the no-tooltip case, or a `<span>` WRAPPING
                            the Tooltip's children for the tooltip case.
                            `truncate`/`overflow:hidden` never goes on the
                            Tooltip trigger BUTTON itself (its `className`
                            prop) — that would clip the 24px hit area the
                            button draws with its `after:` pseudo-element
                            (`HIT_TARGET` in ui/Tooltip.tsx). */}
                        <span
                          className={`flex min-w-0 items-center gap-1 text-sm ${
                            record.bunkName === 'Unassigned'
                              ? 'text-amber-600 italic dark:text-amber-400'
                              : 'text-foreground font-medium'
                          }`}
                        >
                          <Home className="h-3.5 w-3.5 flex-shrink-0 opacity-60" />
                          {/* The as-typed string, offered in a hover tooltip,
                              ONLY where it disagrees with the label —
                              `HouseholdJourneyCard`'s `showsProvenance`
                              affordance (kindred#2177 real Tooltip, not
                              `title`), owner ruling 2026-09-22 evening. */}
                          {record.bunkNameRecorded !== undefined ? (
                            <Tooltip
                              content={`Recorded as "${record.bunkNameRecorded}" that season`}
                              data-testid="camp-journey-cabin-provenance"
                              pinOnClick={false}
                              className="decoration-muted-foreground/60 min-w-0 text-left underline decoration-dotted underline-offset-2"
                            >
                              <span className="block truncate">{record.bunkName}</span>
                            </Tooltip>
                          ) : (
                            <span className="min-w-0 truncate">{record.bunkName}</span>
                          )}
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
