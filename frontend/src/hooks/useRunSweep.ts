import { useMutation, useQueryClient } from '@tanstack/react-query'

import { postCancelSweep, postRunSweep, type SweepRequest } from '../services/solver'
import { queryKeys } from '../utils/queryKeys'

export function useRunSweep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: SweepRequest) => postRunSweep(req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.solverRunsPrefix() })
    },
  })
}

export function useCancelSweep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sweepId: string) => postCancelSweep(sweepId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.solverRunsPrefix() })
    },
  })
}
