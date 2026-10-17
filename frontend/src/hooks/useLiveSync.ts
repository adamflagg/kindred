/**
 * What the sync status says about drawing PR 5b's live point (components/velocity/velocityLive.ts).
 *
 * It reads the same run the "Enrollments synced …" chip reads (useAnalyticsFreshness: the viewed season's
 * own attendees run), so the point and the chip always agree, plus `_daily_sync_running`: from 3:00 to the
 * end of the nightly only the stored count shows (#111). `now` ticks each minute so a point that passes
 * the 2 hours goes away while the page sits open.
 */
import { useEffect, useState } from 'react'
import { freshnessRun } from '../utils/syncFreshness'
import type { LiveSync } from '../components/velocity/velocityLive'
import { useAnalyticsFreshness } from './useAnalyticsFreshness'
import type { SyncStatusResponse } from './useSyncStatusAPI'
import { useViewedSeasonSyncStatus } from './useViewedSeasonSyncStatus'

const MINUTE_MS = 60_000

/** The time, re-read every minute. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
    }, MINUTE_MS)
    return () => {
      clearInterval(id)
    }
  }, [])
  return now
}

/** Past this age a known sync is old enough that the status in the cache may simply have missed one. */
const STALE_REFETCH_AFTER_MS = 65 * MINUTE_MS

/** The sync time already re-read for, per season: one refetch per stale sync time, however many callers. */
const refetchedFor = new Map<number, string>()

/** Tests only. */
export function forgetStaleRefetches(): void {
  refetchedFor.clear()
}

/**
 * Row 1 of the #3283 scan: a tab left open reads amber off a status the cache never refreshed (the
 * staleTime stays as the owner ruled on 10-01). On the minute tick, when the known sync is more than 65
 * minutes old, re-read the viewed season's status ONCE for that sync time. If the sync is truly behind
 * the time does not change, so the amber stands and nothing polls.
 */
export function useStaleSyncRefetch(year: number, at: string | null, now: number): void {
  const season = useViewedSeasonSyncStatus(year)
  const refetch = season.kind === 'synced' ? season.refetch : null
  useEffect(() => {
    if (at == null || refetch == null || refetchedFor.get(year) === at) return
    if (now - Date.parse(at.includes('T') ? at : at.replace(' ', 'T')) <= STALE_REFETCH_AFTER_MS) {
      return
    }
    refetchedFor.set(year, at)
    refetch()
  }, [year, at, now, refetch])
}

export function useLiveSync(year: number): { sync: LiveSync; now: number } {
  const season = useViewedSeasonSyncStatus(year)
  const freshness = useAnalyticsFreshness(year)
  const now = useMinuteClock()
  useStaleSyncRefetch(year, freshness.kind === 'synced' ? freshness.at : null, now)
  const scoped = season.kind === 'synced' ? (season.scoped as Partial<SyncStatusResponse>) : null
  const attendees = freshnessRun(scoped?.attendees)
  return {
    sync: {
      at: freshness.kind === 'synced' ? freshness.at : null,
      failed: freshness.kind === 'synced' ? freshness.failed : attendees?.status === 'failed',
      nightly: scoped?._daily_sync_running === true,
    },
    now,
  }
}
