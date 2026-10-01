import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { queryKeys } from '../../utils/queryKeys'
import type { SyncStatusResponse } from '../useSyncStatusAPI'

/**
 * A completed ledger or FA-applications sync refreshes every Camperships read (spec §10). Manage ›
 * Sync's completion toasts invalidate SYNC_DEPENDENT_PREFIXES (which include 'financial-aid'), but
 * registrar and finance staff don't sit on that tab. This watches the two jobs' end times on the
 * status the secondary bar already reads, and invalidates when either moves. The first status
 * seen only sets the baseline.
 *
 * Known lag, accepted (Ruling 2026-10-01 (plan review)): the status query inherits the app's
 * 30-minute staleTime and polls only while a job runs, so a tab left open overnight notices the
 * nightly ledger sync only when the status is next fetched (a page load, or 30 minutes after the
 * last fetch on the next mount). Don't shorten the staleTime to buy this back
 * (frontend/CLAUDE.md "Caching").
 */
export function useAidSyncInvalidation(status: SyncStatusResponse | null | undefined): void {
  const queryClient = useQueryClient()
  const seen = useRef<string | null>(null)
  // The server leaves out a job that has never run, whatever the type says; Partial makes the
  // optional chain honest (Ruling 2026-10-01 (plan review): no unnecessary `?.`).
  const jobs: Partial<SyncStatusResponse> | null = status ?? null
  const stamp = jobs
    ? `${jobs.aid_postings?.end_time ?? ''}|${jobs.financial_aid_applications?.end_time ?? ''}`
    : null

  useEffect(() => {
    if (stamp === null) return
    if (seen.current !== null && seen.current !== stamp) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.aidPrefix() })
    }
    seen.current = stamp
  }, [stamp, queryClient])
}
