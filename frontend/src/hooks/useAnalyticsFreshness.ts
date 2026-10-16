/**
 * How fresh are the enrollments Analytics is showing? (PR 4, pick 3A: "Enrollments synced 7h ago")
 *
 * Reads the ENROLLMENT (attendees) sync's own last run, which runs nightly at 3 am. Never the
 * hourly bunk-assignment run: that would claim an hour-old freshness for numbers that are a
 * night old.
 *
 * Scoped to the season being viewed. Without `?year=` the status payload holds each job's latest
 * run of ANY season, so 2026's nightly pass would vouch for an empty 2027. Only the two synced
 * seasons can be asked for (the backend 400s any other year). An older season re-syncs weekly
 * (Saturday 05:00), while N and N−1 run on the regular schedule, so for it the chip shows
 * nothing rather than overstate.
 */

import { freshnessRun } from '../utils/syncFreshness'
import { useSyncStatusAPI, type SyncStatusResponse } from './useSyncStatusAPI'

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
 * ago · syncing now" true through the nightly pass. Module-level, so it survives navigation.
 */
const lastFinished = new Map<number, string>()

/** Tests only: start each case with nothing remembered. */
export function forgetFinishedRuns(): void {
  lastFinished.clear()
}

export function useAnalyticsFreshness(year: number): AnalyticsFreshness {
  const { data: status } = useSyncStatusAPI()
  // An older backend omits _synced_years; the scheduled runs cover the primary and the one before.
  const configured = status?._configured_year
  const syncedYears =
    status?._synced_years ?? (configured !== undefined ? [configured, configured - 1] : undefined)
  const inSynced = syncedYears?.includes(year) ?? false

  const { data: scoped } = useSyncStatusAPI({
    enabled: inSynced,
    year: inSynced ? year : undefined,
  })

  if (!status || !syncedYears) return { kind: 'loading' }
  if (!inSynced) return { kind: 'none' }
  if (!scoped) return { kind: 'loading' }

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
