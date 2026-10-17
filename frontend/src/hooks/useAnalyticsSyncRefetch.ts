import { queryKeys } from '../utils/queryKeys'
import { useSyncFinishInvalidation } from './useSyncFinishInvalidation'
import { useViewedSeasonSyncStatus } from './useViewedSeasonSyncStatus'

/**
 * The jobs whose writes Analytics counts: the three the hourly run keeps fresh (epic #3207 PR 5),
 * and the nightly's stored enrollment point that Velocity draws. Not bunk_assignments, which also
 * runs hourly: Analytics reads nothing it writes.
 */
const ANALYTICS_JOBS = ['sessions', 'attendees', 'persons', 'enrollment_snapshots'] as const

/**
 * Analytics refetches after a sync (PR 5). The server clears its metrics cache after every job,
 * but an open Analytics page kept what it had fetched. This watches the viewed season's own runs
 * of the jobs above and refetches every 'metrics' query once one finishes again. A season the
 * scheduled runs don't cover is watched not at all. Mounted once, by the season bar's chip.
 */
export function useAnalyticsSyncRefetch(year: number): void {
  const season = useViewedSeasonSyncStatus(year)
  useSyncFinishInvalidation(
    season.kind === 'synced' ? season.scoped : null,
    ANALYTICS_JOBS,
    queryKeys.metricsRoot(),
    year
  )
}
