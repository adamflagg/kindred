import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import toast from 'react-hot-toast';
import type { SyncPhase } from '../components/admin/syncTypes';

interface PhaseSyncParams {
  year: number;
  phase: SyncPhase;
}

interface PhaseSyncResponse {
  message?: string;
  status?: string;
  phase?: string;
  year?: number;
  jobs?: string[];
  error?: string;
}

// Human-readable names for phases
const PHASE_NAMES: Record<SyncPhase, string> = {
  source: 'CampMinder',
  expensive: 'Custom Values',
  transform: 'Transform',
  process: 'Process',
  export: 'Export',
};

/**
 * Hook to run a specific sync phase for a given year.
 * Runs all jobs in the phase sequentially.
 */
export function useRunPhaseSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ year, phase }: PhaseSyncParams): Promise<PhaseSyncResponse> => {
      const params = new URLSearchParams();
      params.set('year', year.toString());
      params.set('phase', phase);

      return await pb.send(`/api/custom/sync/run-phase?${params}`, { method: 'POST' });
    },
    onMutate: (variables) => {
      const phaseName = PHASE_NAMES[variables.phase] || variables.phase;
      toast(`Starting ${phaseName} phase for ${variables.year}...`, {
        icon: '🔄',
        duration: 3000
      });
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sync-status-api'] });

      const phaseName = PHASE_NAMES[variables.phase] || variables.phase;
      const jobCount = data.jobs?.length || 0;
      toast.success(
        `${phaseName} phase started (${jobCount} jobs)`,
        { duration: 4000 }
      );

      // Invalidate again after a delay for quick syncs
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['sync-status-api'] }), 2000);
    },
    onError: (error, variables) => {
      const phaseName = PHASE_NAMES[variables.phase] || variables.phase;

      // Extract error message from PocketBase error structure
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      const pbError = error as { response?: { data?: { message?: string; error?: string }; message?: string }; message?: string };
      if (pbError?.response?.data?.error) {
        errorMessage = pbError.response.data.error;
      } else if (pbError?.response?.data?.message) {
        errorMessage = pbError.response.data.message;
      } else if (pbError?.response?.message) {
        errorMessage = pbError.response.message;
      }

      toast.error(`Failed to start ${phaseName} phase: ${errorMessage}`, {
        duration: 8000,
      });
    },
  });
}
