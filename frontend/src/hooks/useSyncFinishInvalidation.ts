import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import type { SyncStatus, SyncStatusResponse } from './useSyncStatusAPI'

/**
 * A job's finished end time, or null while it has none to give. The server sends `end_time` only
 * for a run that is over (success, or a failure that may have written part of its rows). A queued
 * (`pending`) or `running` job has none, and in a daily run `pending` lasts from the run's start
 * until that job's turn, so reading its absence as a change refreshed every read when a sync
 * started, again when each job started, and once more when it finished.
 */
function finishedAt(job: SyncStatus | undefined): string | null {
  if (job === undefined || (job.status !== 'success' && job.status !== 'failed')) return null
  return job.end_time ?? null
}

/**
 * Invalidate `queryKey` when any of `jobs` finishes a new run, as seen on a sync status payload a
 * surface already reads: once per completed job, never while a job is queued or running
 * (`finishedAt`). The first status seen only sets the baseline; a job with no finished run yet
 * (never run, or mid-run when the page opened) refreshes on the first finish it shows.
 *
 * Known lag, accepted (Ruling 2026-10-01 (plan review)): the status query inherits the app's
 * 30-minute staleTime and polls only while a job runs (or on window focus), so a tab left open
 * notices a sync only when the status is next fetched. Don't shorten the staleTime to buy this
 * back (frontend/CLAUDE.md "Caching").
 *
 * `scope` names what the status is about (the viewed year). When it changes the baseline is
 * dropped, so the first status of the new scope only sets a baseline instead of reading the
 * difference between two scopes' finish times as a sync.
 */
export function useSyncFinishInvalidation(
  status: SyncStatusResponse | null | undefined,
  jobs: readonly string[],
  queryKey: QueryKey,
  scope?: string | number
): void {
  const queryClient = useQueryClient()
  // Each job's last finished end time; undefined until the first status sets the baseline.
  const seen = useRef<Record<string, string | null> | undefined>(undefined)
  const seenScope = useRef(scope)
  // The server leaves out a job that has never run, whatever the type says; Partial makes the
  // optional chain honest (Ruling 2026-10-01 (plan review): no unnecessary `?.`).
  const payload: Partial<Record<string, SyncStatus>> | null =
    (status as Partial<Record<string, SyncStatus>> | null | undefined) ?? null
  const finished = payload ? jobs.map((key) => finishedAt(payload[key])) : null
  // Strings, so the effect runs only when a finished end time (or the job list or key) differs.
  const stamp = finished ? JSON.stringify(finished) : null
  const jobsKey = JSON.stringify(jobs)
  const keyStamp = JSON.stringify(queryKey)

  useEffect(() => {
    if (seenScope.current !== scope) {
      seenScope.current = scope
      seen.current = undefined
    }
    if (stamp === null) return
    const names = JSON.parse(jobsKey) as string[]
    const now = JSON.parse(stamp) as Array<string | null>
    const before = seen.current
    if (before === undefined) {
      seen.current = Object.fromEntries(names.map((key, i) => [key, now[i] ?? null]))
      return
    }
    let completed = false
    for (const [i, key] of names.entries()) {
      const at = now[i] ?? null
      // Pending or running: nothing new has finished, so keep what this job last finished at.
      if (at === null || at === before[key]) continue
      before[key] = at
      completed = true
    }
    if (completed)
      void queryClient.invalidateQueries({ queryKey: JSON.parse(keyStamp) as QueryKey })
  }, [stamp, jobsKey, keyStamp, scope, queryClient])
}
