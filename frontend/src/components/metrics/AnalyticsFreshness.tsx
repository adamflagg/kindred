import { RefreshCw } from 'lucide-react'
import { FreshnessChip } from '../FreshnessChip'
import { useAnalyticsFreshness } from '../../hooks/useAnalyticsFreshness'
import { useCurrentYear } from '../../hooks/useCurrentYear'

/**
 * "Enrollments synced 7h ago" on Analytics' season bar (PR 4, pick 3A), beside Season. It reads
 * the viewed season's own enrollment (attendees) run, never the hourly bunk-assignment run, so it
 * never claims hour-old freshness for night-old numbers. " · syncing now" while that run is going.
 *
 * Nothing for a season the scheduled runs don't cover (older seasons are not re-synced), and
 * nothing for one never synced: the empty state says "hasn't synced from CampMinder yet" instead.
 * Summer's grammar: grey always, relative inline, the absolute time in the tooltip (#1706).
 */
export function AnalyticsFreshness() {
  const { currentYear } = useCurrentYear()
  const freshness = useAnalyticsFreshness(currentYear)
  if (freshness.kind === 'syncing') {
    // A live run with no finished time known this session: the payload carries none to show.
    return (
      <div className="text-muted-foreground flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <RefreshCw className="h-3 w-3" />
          Enrollments syncing now
        </span>
      </div>
    )
  }
  if (freshness.kind !== 'synced') return null
  return (
    <div className="text-muted-foreground flex items-center gap-3 text-xs">
      <FreshnessChip
        noun="Enrollments"
        verb="synced"
        at={freshness.at}
        title={`Last enrollment sync • ${new Date(freshness.at).toISOString()}`}
        {...(freshness.running ? { suffix: ' · syncing now' } : {})}
      />
    </div>
  )
}
