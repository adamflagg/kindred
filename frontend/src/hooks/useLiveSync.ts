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

export function useLiveSync(year: number): { sync: LiveSync; now: number } {
  const season = useViewedSeasonSyncStatus(year)
  const freshness = useAnalyticsFreshness(year)
  const now = useMinuteClock()
  const scoped = season.kind === 'synced' ? (season.scoped as Partial<SyncStatusResponse>) : null
  const attendees = freshnessRun(scoped?.attendees)
  return {
    sync: {
      at: freshness.kind === 'synced' ? freshness.at : null,
      failed: attendees?.status === 'failed',
      nightly: scoped?._daily_sync_running === true,
    },
    now,
  }
}
