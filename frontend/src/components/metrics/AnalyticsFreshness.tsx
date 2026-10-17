import { RefreshCw } from 'lucide-react'
import { FreshnessChip } from '../FreshnessChip'
import { useAnalyticsFreshness } from '../../hooks/useAnalyticsFreshness'
import { useAnalyticsSyncRefetch } from '../../hooks/useAnalyticsSyncRefetch'
import { useCurrentYear } from '../../hooks/useCurrentYear'
import { useMinuteClock, useStaleSyncRefetch } from '../../hooks/useLiveSync'
import { syncBehind } from '../velocity/velocityLive'

/**
 * "Enrollments synced 40m ago" on Analytics' season bar (PR 4, pick 3A), beside Season. It reads
 * the viewed season's own enrollment (attendees) run, which is hourly since PR 5, never the
 * bunk-assignment run. " · syncing now" while that run is going. When the run finishes, every
 * Analytics query refetches (useAnalyticsSyncRefetch): the chip is on every Analytics page, once.
 *
 * Nothing for a season the regular schedule doesn't cover (older seasons re-sync weekly, Saturday
 * 05:00; N and N−1 run on the regular schedule), and
 * nothing for one never synced: the empty state says "hasn't synced from CampMinder yet" instead.
 * Summer's grammar: grey, relative inline, the absolute time in the tooltip (#1706). Amber once the
 * last SUCCESSFUL sync is more than 2 hours old (PR 5b ruling #111: the hourly sync is behind, and Velocity's and
 * Pace's live point is hidden for the same reason).
 */
export function AnalyticsFreshness() {
  const { currentYear } = useCurrentYear()
  const freshness = useAnalyticsFreshness(currentYear)
  useAnalyticsSyncRefetch(currentYear)
  const now = useMinuteClock()
  useStaleSyncRefetch(currentYear, freshness.kind === 'synced' ? freshness.at : null, now)
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
        warn={syncBehind(freshness.at, now)}
        {...(freshness.running ? { suffix: ' · syncing now' } : {})}
      />
    </div>
  )
}
