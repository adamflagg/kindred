import { useSyncStatusAPI, type SyncStatusResponse } from './useSyncStatusAPI'

export type ViewedSeasonSyncStatus =
  | { kind: 'loading' }
  /** The viewed season is not one the scheduled runs cover. */
  | { kind: 'unsynced' }
  | { kind: 'synced'; scoped: SyncStatusResponse }

/**
 * The viewed season's own sync status (`?year=`), for the Analytics chip and its refetch.
 *
 * Without `?year=` the status payload holds each job's latest run of ANY season, so 2026's
 * nightly pass would vouch for an empty 2027. Only the two synced seasons can be asked for (the
 * backend 400s any other year), so for any other the answer is `unsynced` and nothing is read.
 */
export function useViewedSeasonSyncStatus(year: number): ViewedSeasonSyncStatus {
  const { data: status } = useSyncStatusAPI()
  // An older backend omits _synced_years; the scheduled runs cover the primary and the one before.
  const configured = status?._configured_year
  const syncedYears =
    status?._synced_years ?? (configured !== undefined ? [configured, configured - 1] : undefined)
  const inSynced = syncedYears?.includes(year) ?? false

  const { data: scoped, isPlaceholderData } = useSyncStatusAPI({
    enabled: inSynced,
    year: inSynced ? year : undefined,
  })

  if (!status || !syncedYears) return { kind: 'loading' }
  if (!inSynced) return { kind: 'unsynced' }
  // keepPreviousData hands back the last year's payload while this year's loads: not its status.
  if (!scoped || isPlaceholderData) return { kind: 'loading' }
  return { kind: 'synced', scoped }
}
