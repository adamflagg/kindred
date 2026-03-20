import { useMutation, useQueryClient } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { queryKeys } from '../utils/queryKeys'
import toast from 'react-hot-toast'
import { extractErrorMessage } from './createSyncMutation'
import type { SyncPhase } from '../components/admin/syncTypes'

interface PhaseSyncParams {
  year: number
  phase: SyncPhase
  debug?: boolean
}

interface PhaseSyncResponse {
  message?: string
  status?: string
  phase?: string
  year?: number
  jobs?: string[]
  error?: string
  // Queue fields (for 202 Accepted)
  queue_id?: string
  position?: number
}

// Human-readable names for phases
const PHASE_NAMES: Record<SyncPhase, string> = {
  source: 'CampMinder',
  expensive: 'Custom Values',
  transform: 'Transform',
  process: 'Process',
  export: 'Export',
}

/**
 * Hook to run a specific sync phase for a given year.
 * Runs all jobs in the phase sequentially.
 */
export function useRunPhaseSync() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ year, phase, debug }: PhaseSyncParams): Promise<PhaseSyncResponse> => {
      const params = new URLSearchParams()
      params.set('year', year.toString())
      params.set('phase', phase)
      if (debug) {
        params.set('debug', 'true')
      }

      return await pb.send(`/api/custom/sync/run-phase?${params}`, {
        method: 'POST',
      })
    },
    onMutate: (variables) => {
      const phaseName = PHASE_NAMES[variables.phase]
      toast(`Starting ${phaseName} phase for ${variables.year}...`, {
        icon: '🔄',
        duration: 3000,
      })
    },
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus() })

      const phaseName = PHASE_NAMES[variables.phase]
      const jobCount = data.jobs?.length ?? 0

      // Handle queued vs started
      if (data.status === 'queued') {
        toast(`${phaseName} phase queued (position ${data.position})`, {
          icon: '📋',
          duration: 4000,
        })
      } else {
        toast.success(`${phaseName} phase started (${jobCount} jobs)`, {
          duration: 4000,
        })
      }

      // Invalidate again after a delay for quick syncs
      setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus() }),
        2000
      )
    },
    onError: (error, variables) => {
      const phaseName = PHASE_NAMES[variables.phase]

      const errorMessage = extractErrorMessage(error)

      toast.error(`Failed to start ${phaseName} phase: ${errorMessage}`, {
        duration: 8000,
      })
    },
  })
}
