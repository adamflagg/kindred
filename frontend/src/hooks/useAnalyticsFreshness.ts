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
  | { kind: 'synced'; at: string; running: boolean }
  /** A run is live and no finished time has been seen this session: "Enrollments syncing now". */
  | { kind: 'syncing' }

/**
 * The last finished attendees run seen per season, this session. A live (running or queued) run
 * arrives WITHOUT end_time: the backend returns that entry in place of the last finished one
 * (orchestrator.go statusLocked). Remembering the finished time keeps "Enrollments synced 7h
 * ago · syncing now" true through a run. Module-level, so it survives navigation.
 */
const lastFinished = new Map<number, string>()

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
  if (attendees.end_time && !live) {
    lastFinished.set(year, attendees.end_time)
    return { kind: 'synced', at: attendees.end_time, running: false }
  }
  const at = attendees.end_time ?? lastFinished.get(year)
  if (at) return { kind: 'synced', at, running: live }
  return live ? { kind: 'syncing' } : { kind: 'never' }
}
