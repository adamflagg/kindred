/**
 * How fresh are the enrollments Analytics is showing? (PR 4, pick 3A: "Enrollments synced 40m ago")
 *
 * Reads the ENROLLMENT (attendees) sync's own last run. It runs every hour (PR 5) outside the
 * nightly's window, and in the 3 am nightly. Never the bunk-assignment run, which also runs
 * hourly but is not what Analytics counts.
 *
 * Scoped to the season being viewed (useViewedSeasonSyncStatus). An older season re-syncs weekly
 * (Saturday 05:00), while N and N−1 run on the regular schedule, so for it the chip shows
 * nothing rather than overstate.
 */

import { freshnessRun } from '../utils/syncFreshness'
import type { SyncStatusResponse } from './useSyncStatusAPI'
import { useViewedSeasonSyncStatus } from './useViewedSeasonSyncStatus'

export type AnalyticsFreshness =
  | { kind: 'loading' }
  /** The viewed season is not one the scheduled runs cover: show no chip. */
  | { kind: 'none' }
  /** A synced season whose attendees job has never run for it. */
  | { kind: 'never' }
  /**
   * `at` is the last SUCCESSFUL run (row 2 of the #3283 scan: #111 says "last good sync"), and `failed` is
   * whether the run after it failed, kept through the run that follows so the live point stays hidden.
   */
  | { kind: 'synced'; at: string; running: boolean; failed: boolean }
  /** A run is live and no finished time has been seen this session: "Enrollments syncing now". */
  | { kind: 'syncing' }

/**
 * The last finished attendees run seen per season, this session. A live (running or queued) run
 * arrives WITHOUT end_time: the backend returns that entry in place of the last finished one
 * (orchestrator.go statusLocked). Remembering the finished time keeps "Enrollments synced 7h
 * ago · syncing now" true through a run. Module-level, so it survives navigation.
 */
const lastFinished = new Map<number, { at: string | undefined; failed: boolean }>()

/** Tests only: start each case with nothing remembered. */
export function forgetFinishedRuns(): void {
  lastFinished.clear()
}

export function useAnalyticsFreshness(year: number): AnalyticsFreshness {
  const season = useViewedSeasonSyncStatus(year)
  if (season.kind === 'loading') return { kind: 'loading' }
  if (season.kind === 'unsynced') return { kind: 'none' }
  const { scoped } = season

  // A job that has never run for this season is absent from the payload. A dry run dates
  // nothing: freshnessRun answers it with the last real run, or nothing.
  const attendees = freshnessRun((scoped as Partial<SyncStatusResponse>).attendees)
  if (!attendees) return { kind: 'never' }
  const live = attendees.status === 'running' || attendees.status === 'pending'
  // The last success: the backend's last_success_at, or, from an older backend, a success dating itself.
  const successAt =
    attendees.last_success_at ?? (attendees.status === 'success' ? attendees.end_time : undefined)
  const prev = lastFinished.get(year)
  if (attendees.end_time && !live) {
    const failed = attendees.status === 'failed'
    const at = successAt ?? (failed ? prev?.at : undefined)
    lastFinished.set(year, { at, failed })
    return at ? { kind: 'synced', at, running: false, failed } : { kind: 'never' }
  }
  const at = successAt ?? prev?.at
  if (at) return { kind: 'synced', at, running: live, failed: prev?.failed ?? false }
  return live ? { kind: 'syncing' } : { kind: 'never' }
}
