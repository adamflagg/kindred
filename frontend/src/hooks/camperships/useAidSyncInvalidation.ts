import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { queryKeys } from '../../utils/queryKeys'
import type { SyncStatus, SyncStatusResponse } from '../useSyncStatusAPI'

/** The jobs whose writes every Camperships read depends on. */
const AID_JOBS = ['aid_postings', 'financial_aid_applications'] as const

/**
 * A job's finished end time, or null while it has none to give. The server sends `end_time` only
 * for a run that is over (success, or a failure that may have written part of its rows). A queued
 * (`pending`) or `running` job has none, and in a daily run `pending` lasts from the run's start
 * until that job's turn, so reading its absence as a change refreshed every aid read when a sync
 * started, again when each job started, and once more when it finished.
 */
function finishedAt(job: SyncStatus | undefined): string | null {
  if (job === undefined || (job.status !== 'success' && job.status !== 'failed')) return null
  return job.end_time ?? null
}

/**
 * A completed ledger or FA-applications sync refreshes every Camperships read (spec §10). Manage ›
 * Sync's completion toasts invalidate SYNC_DEPENDENT_PREFIXES (which include 'financial-aid'), but
 * registrar and finance staff don't sit on that tab. This watches the two jobs' finished end times
 * on the status the secondary bar already reads, and invalidates when either moves to a new one: once
 * per completed job, never while a job is queued or running (`finishedAt`). The first status seen
 * only sets the baseline; a job with no finished run yet (never run, or mid-run when the page
 * opened) refreshes on the first finish it shows.
 *
 * Known lag, accepted (Ruling 2026-10-01 (plan review)): the status query inherits the app's
 * 30-minute staleTime and polls only while a job runs, so a tab left open overnight notices the
 * nightly ledger sync only when the status is next fetched (a page load, or 30 minutes after the
 * last fetch on the next mount). Don't shorten the staleTime to buy this back
 * (frontend/CLAUDE.md "Caching").
 */
export function useAidSyncInvalidation(status: SyncStatusResponse | null | undefined): void {
  const queryClient = useQueryClient()
  // Each job's last finished end time; undefined until the first status sets the baseline.
  const seen = useRef<Record<string, string | null> | undefined>(undefined)
  // The server leaves out a job that has never run, whatever the type says; Partial makes the
  // optional chain honest (Ruling 2026-10-01 (plan review): no unnecessary `?.`).
  const jobs: Partial<SyncStatusResponse> | null = status ?? null
  const finished = jobs ? AID_JOBS.map((key) => finishedAt(jobs[key])) : null
  // A string, so the effect runs only when a finished end time actually differs.
  const stamp = finished ? JSON.stringify(finished) : null

  useEffect(() => {
    if (stamp === null) return
    const now = JSON.parse(stamp) as Array<string | null>
    const before = seen.current
    if (before === undefined) {
      seen.current = Object.fromEntries(AID_JOBS.map((key, i) => [key, now[i] ?? null]))
      return
    }
    let completed = false
    AID_JOBS.forEach((key, i) => {
      const at = now[i] ?? null
      // Pending or running: nothing new has finished, so keep what this job last finished at.
      if (at === null || at === before[key]) return
      before[key] = at
      completed = true
    })
    if (completed) void queryClient.invalidateQueries({ queryKey: queryKeys.aidPrefix() })
  }, [stamp, queryClient])
}
