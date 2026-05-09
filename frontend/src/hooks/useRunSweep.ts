import { useMutation, useQueryClient } from '@tanstack/react-query'

import { postCancelSweep, postRunSweep, type SweepRequest } from '../services/solver'
import { queryKeys } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'

export function useRunSweep() {
  const qc = useQueryClient()
  const { fetchWithAuth } = useApiWithAuth()
  return useMutation({
    mutationFn: (req: SweepRequest) => postRunSweep(fetchWithAuth, req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.solverRunsPrefix() })
    },
  })
}

export function useCancelSweep() {
  const qc = useQueryClient()
  const { fetchWithAuth } = useApiWithAuth()
  return useMutation({
    mutationFn: (sweepId: string) => postCancelSweep(fetchWithAuth, sweepId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.solverRunsPrefix() })
    },
  })
}
