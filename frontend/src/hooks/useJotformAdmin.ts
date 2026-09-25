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
  ignoreJotformSubmission,
  linkJotformSubmission,
  saveJotformForm,
  unlinkJotformSubmission,
} from '../services/jotformApi'
import type { JotformFormWriteBody } from '../types/jotform'
import { queryKeys } from '../utils/queryKeys'
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

export function invalidateJotformQueries(queryClient: {
  invalidateQueries: (args: { queryKey: readonly unknown[] }) => unknown
}): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.jotformPrefix() })
  void queryClient.invalidateQueries({ queryKey: queryKeys.weekendRosterPrefix() })
}

export function useJotformForms(year: number) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.jotformForms(year),
    enabled: year > 0,
    queryFn: () => fetchJotformForms(fetchWithAuth, year),
  })
}

export function useJotformQueue(year: number) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.jotformQueue(year),
    enabled: year > 0,
    queryFn: () => fetchJotformQueue(fetchWithAuth, year),
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

export function useJotformSubmissionAction() {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (action: JotformAction) => {
      if (action.kind === 'link')
        return linkJotformSubmission(fetchWithAuth, action.submissionId, action.personCmId)
      if (action.kind === 'ignore')
        return ignoreJotformSubmission(fetchWithAuth, action.submissionId)
      return unlinkJotformSubmission(fetchWithAuth, action.submissionId)
    },
    onSuccess: () => {
      invalidateJotformQueries(queryClient)
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
