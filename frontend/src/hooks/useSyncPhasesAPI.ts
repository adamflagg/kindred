import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { pb } from '../lib/pocketbase'
import { queryKeys } from '../utils/queryKeys'

// One phase's metadata as published by GET /api/custom/sync/phases (handleGetPhases,
// pocketbase/sync/api.go).
export interface SyncPhaseInfo {
  id: string
  name: string
  description: string
  // What the phase CONTAINS -- GetJobsForPhase's classification list. Matches the frontend's
  // own SYNC_PHASES/getSyncTypesByPhase card grid, which is what the Sync tab's header count
  // already renders from ({types.length} jobs) -- this list is not currently consumed, kept
  // only to mirror the backend payload shape.
  jobs: string[]
  // What Run Phase actually STARTS -- phaseExecutionJobs, a subset of `jobs`. The two bounded
  // family-camp custom-values jobs are members of the Expensive phase but are never started by
  // an admin phase run (kindred#2489), so a count beside the Run Phase button must come from
  // this list, not `jobs.length` (kindred#2600).
  run_jobs: string[]
}

export interface SyncPhasesResponse {
  phases: SyncPhaseInfo[]
}

/**
 * Fetches phase metadata from GET /api/custom/sync/phases -- in particular each phase's
 * `run_jobs`, the count the Sync tab's Run Phase button shows (kindred#2600).
 *
 * Inherits `utils/queryClient.ts`'s defaults (30 min staleTime) rather than opting down: the
 * payload is derived from `syncJobMeta`, which changes only when someone edits the registry in
 * code and redeploys, so there is nothing here to be fresh about (root CLAUDE.md's "Family
 * Camp Models Summer" -- opting down needs a stated reason, and there isn't one).
 */
export function useSyncPhasesAPI() {
  const { isLoading } = useAuth()

  return useQuery<SyncPhasesResponse | null>({
    queryKey: queryKeys.syncPhases(),
    queryFn: async (): Promise<SyncPhasesResponse | null> => {
      try {
        const response = await pb.send('/api/custom/sync/phases', {
          method: 'GET',
        })
        return response as SyncPhasesResponse
      } catch (err) {
        // Swallow 401 silently, matching useSyncStatusAPI -- pb.afterSend already clears auth
        // and redirects to /login.
        const status = (err as { status?: number } | null)?.status
        if (status === 401) {
          return null
        }
        throw err
      }
    },
    enabled: !isLoading,
  })
}
