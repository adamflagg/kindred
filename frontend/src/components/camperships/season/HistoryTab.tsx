import { SEASON_CARD } from './seasonStyles'

/**
 * Season › History (spec §7.6; D49; history.html B) needs a server read of the season's log,
 * `aid_change_log` grouped by operation and paged, that main doesn't have yet (slice 2 plan, "Back-end
 * reads missing on main"). Until it lands the tab says so, and points at the logs that exist.
 */
export function HistoryTab({ canSeeScenarios }: { canSeeScenarios: boolean }) {
  return (
    <div className={`${SEASON_CARD} text-muted-foreground space-y-1 p-4`}>
      <p className="text-foreground font-medium">The season&apos;s log isn&apos;t built yet.</p>
      <p>
        It needs a server read of every operation this season, which comes with a later back-end
        change. Meanwhile each family&apos;s own history is on its household page
        {canSeeScenarios ? ', and every scenario change is in Scenarios › Trail' : ''}.
      </p>
    </div>
  )
}
