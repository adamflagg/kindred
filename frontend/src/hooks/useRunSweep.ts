import { useMutation, useQueryClient } from '@tanstack/react-query'

import { postCancelSweep, postRunSweep, type SweepRequest } from '../services/solver'
import { solverRunsKey } from '../utils/queryKeys'

export function useRunSweep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: SweepRequest) => postRunSweep(req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['solverRuns'] })
    },
  })
}

export function useCancelSweep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sweepId: string) => postCancelSweep(sweepId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['solverRuns'] })
    },
  })
}

// Re-export to keep import sites happy if they want a single entry point
export { solverRunsKey }
