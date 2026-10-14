import type { QueryClient } from '@tanstack/react-query'
import type { SyncStatusResponse } from '../hooks/useSyncStatusAPI'
import { queryKeys } from './queryKeys'

/**
 * The `year` a staff-triggered sync sends: the season on screen, or undefined
 * when that is the primary (the status payload's `_configured_year`), so a
 * primary run's request stays exactly what it always was.
 *
 * Plan Review Focus 1: after the Oct 15 rollover staff keep working the prior
 * season (the October adult weekends, Jotform, Refresh Housing), and a sync
 * started from there must sync that season, never silently the primary. The
 * server refuses a season it does not sync rather than falling back.
 *
 * Read from the status cache rather than a hook so a mutation can decide at
 * call time. Before the status has loaded the primary is unknown and the
 * viewed season is sent; the server treats `year=<primary>` as the primary.
 */
export function seasonToSync(
  queryClient: QueryClient,
  viewedYear: number | undefined
): number | undefined {
  if (!viewedYear) return undefined
  const status = queryClient.getQueryData<SyncStatusResponse | null>(queryKeys.syncStatus())
  return viewedYear === status?._configured_year ? undefined : viewedYear
}
