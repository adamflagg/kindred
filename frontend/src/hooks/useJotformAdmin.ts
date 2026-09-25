/**
 * The Jotform admin's reads and writes (kindred#2759). Queries inherit the app
 * cache defaults; freshness after a write comes from explicit invalidation —
 * the admin queue AND the weekend roster, whose bunking_request a staff link
 * moves (the server clears its own year cache on the same write).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
