/**
 * The Jotform admin's reads and writes (kindred#2759). Queries inherit the app
 * cache defaults; freshness after a write comes from explicit invalidation —
 * the admin queue AND the weekend roster, whose bunking_request a staff link
 * moves (the server clears its own year cache on the same write).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'

import {
  fetchJotformForms,
  fetchJotformQueue,
  fetchJotformWeekendQueue,
  ignoreJotformSubmission,
  linkJotformSubmission,
  linkJotformWriteIn,
  saveJotformForm,
  unlinkJotformSubmission,
} from '../services/jotformApi'
import type { JotformActionOutcome, JotformFormWriteBody } from '../types/jotform'
import { invalidateJotformQueries, queryKeys } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'
import { useRunIndividualSync } from './useRunIndividualSync'
import { useSyncStatusAPI } from './useSyncStatusAPI'

/** The Go sync job that pulls every enabled Jotform form. */
export const JOTFORM_SYNC_ID = 'jotform_submissions'

/** Stop watching a pull that never reports finishing (queued behind a long run, say). */
const PULL_WATCH_LIMIT_MS = 10 * 60 * 1000

export type JotformAction =
  | { kind: 'link'; submissionId: string; personCmId: number }
  | { kind: 'ignore' | 'unlink'; submissionId: string }
  | { kind: 'write_in'; submissionId: string; unitId: string; occupantName: string }

// Shared with the board's write-in picker (`useUnitAvailability`), so it
// lives beside `invalidateLodgingRegistryQueries`.
export { invalidateJotformQueries }

export function useJotformForms(year: number) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.jotformForms(year),
    enabled: year > 0,
    queryFn: () => fetchJotformForms(fetchWithAuth, year),
  })
}

/**
 * `enabled` lets a surface that only sometimes needs the queue -- the board's
 * write-in picker, for a `bunking.manage` caller on an adult weekend -- skip
 * the read entirely otherwise.
 */
export function useJotformQueue(year: number, enabled = true) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.jotformQueue(year),
    enabled: enabled && year > 0,
    queryFn: () => fetchJotformQueue(fetchWithAuth, year),
  })
}

/**
 * One adult weekend's queue for its Requests tab (kindred#2828 ruling
 * 2026-09-25), read in the scenario being viewed. The page reads it for the
 * tab's count and the tab for its lists: one cache entry serves both. Inherits
 * the app cache defaults; every Jotform write and write-in writer invalidates
 * it by the Jotform prefix.
 */
export function useJotformWeekendQueue(
  year: number,
  sessionCmId: number,
  scenario: string,
  enabled = true
) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.jotformWeekendQueue(year, sessionCmId, scenario),
    enabled: enabled && year > 0 && sessionCmId > 0,
    queryFn: () => fetchJotformWeekendQueue(fetchWithAuth, year, sessionCmId, scenario),
  })
}

export function useSaveJotformForm(year: number) {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ sessionCmId, body }: { sessionCmId: number; body: JotformFormWriteBody }) =>
      saveJotformForm(fetchWithAuth, year, sessionCmId, body),
    onSuccess: (row) => {
      invalidateJotformQueries(queryClient)
      toast.success(`${row.session_name} form saved`)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save the Jotform form')
    },
  })
}

export type { JotformActionOutcome }

/**
 * `onDone` hears what each action did -- the same filer's other filings it
 * also moved, or null (kindred#2839 follow-up) -- so the tab can say so. It is
 * the hook's own callback, not `mutate`'s: the row that was clicked leaves
 * the list as the queue refetches, and a per-call callback would go with it.
 */
export function useJotformSubmissionAction(onDone?: (outcome: JotformActionOutcome) => void) {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (action: JotformAction) => {
      if (action.kind === 'link')
        return linkJotformSubmission(fetchWithAuth, action.submissionId, action.personCmId)
      if (action.kind === 'ignore')
        return ignoreJotformSubmission(fetchWithAuth, action.submissionId)
      if (action.kind === 'write_in')
        return linkJotformWriteIn(
          fetchWithAuth,
          action.submissionId,
          action.unitId,
          action.occupantName
        )
      return unlinkJotformSubmission(fetchWithAuth, action.submissionId)
    },
    onSuccess: (outcome) => {
      invalidateJotformQueries(queryClient)
      onDone?.(outcome)
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update the Jotform submission'
      )
    },
  })
}

/**
 * Start the Jotform pull the way the Sync tab starts a job (the individual-sync
 * route), then watch the job's status and refresh the Jotform tab when THAT
 * run finishes (kindred#2828). The job runs in the background, so a refresh on
 * the POST's return would show nothing new, and the Sync tab's own completion
 * watcher is not mounted here.
 *
 * "That run" is told apart by its end time: the pull is over once the job is
 * not running and reports an end other than the one it had when staff pressed.
 */
export function useJotformPull() {
  const runSync = useRunIndividualSync()
  const queryClient = useQueryClient()
  // The job's end_time when this pull started; null when no pull is being
  // watched (before any, once one finished, or once a watch timed out).
  const [since, setSince] = useState<string | null>(null)
  const { data: status } = useSyncStatusAPI({ forcePolling: since !== null })
  const job = status?.jotform_submissions
  const finished =
    since !== null &&
    job !== undefined &&
    job.status !== 'running' &&
    job.status !== 'pending' &&
    (job.end_time ?? '') !== since
  const watching = since !== null && !finished

  useEffect(() => {
    if (!finished) return
    invalidateJotformQueries(queryClient)
    // Drop the watch, and with it forcePolling: useSyncStatusAPI leaves turning
    // it off to the caller, and left on it polls every 3 s while the tab is open.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ending the watch the fetched status just reported finished; forcePolling reads it on the next render.
    setSince(null)
  }, [finished, queryClient])

  useEffect(() => {
    if (!watching) return
    const timer = setTimeout(() => {
      setSince(null)
    }, PULL_WATCH_LIMIT_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [watching])

  const { mutateAsync } = runSync
  const baseline = job?.end_time ?? ''
  const pull = useCallback(async () => {
    try {
      await mutateAsync(JOTFORM_SYNC_ID)
    } catch {
      // Refused (already running, say): useRunIndividualSync has toasted why.
      return
    }
    setSince(baseline)
  }, [mutateAsync, baseline])

  return { pull, isPulling: runSync.isPending || watching }
}
