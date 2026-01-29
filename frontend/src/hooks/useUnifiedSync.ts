import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import toast from 'react-hot-toast';

interface UnifiedSyncParams {
  year: number;
  service: string;
  includeCustomValues?: boolean;
  debug?: boolean;
}

interface SyncResponse {
  status?: string;
  queue_id?: string;
  position?: number;
  message?: string;
  year?: number;
  service?: string;
}

/**
 * Unified sync hook for both current year and historical syncs.
 * Replaces the separate useRunAllSyncs and useHistoricalSync hooks.
 * Supports queuing: returns 202 Accepted when sync is enqueued.
 */
export function useUnifiedSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ year, service, includeCustomValues, debug }: UnifiedSyncParams): Promise<SyncResponse> => {
      const params = new URLSearchParams();
      params.set('year', year.toString());
      params.set('service', service);
      if (includeCustomValues) params.set('includeCustomValues', 'true');
      if (debug) params.set('debug', 'true');

      return await pb.send(`/api/custom/sync/run?${params}`, { method: 'POST' });
    },
    onMutate: (variables) => {
      const serviceDisplay = variables.service === 'all' ? 'all services' : variables.service;
      toast(`Starting sync for ${variables.year} - ${serviceDisplay}...`, {
        icon: '🚀',
        duration: 3000
      });
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sync-status-api'] });

      // Check if sync was queued (202 response)
      if (data?.status === 'queued') {
        const serviceDisplay = variables.service === 'all' ? 'all services' : variables.service;
        toast.success(
          `Sync for ${variables.year} - ${serviceDisplay} queued (position ${data.position})`,
          { duration: 5000 }
        );
      }

      // Also invalidate after delay for quick syncs
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['sync-status-api'] }), 2000);
    },
    onError: (error, variables) => {
      const serviceDisplay = variables.service === 'all' ? 'all services' : variables.service;

      // Extract error message from PocketBase error structure
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      // PocketBase errors have response.data or response.message
      const pbError = error as { response?: { data?: { message?: string; error?: string }; message?: string }; message?: string };
      if (pbError?.response?.data?.error) {
        errorMessage = pbError.response.data.error;
      } else if (pbError?.response?.data?.message) {
        errorMessage = pbError.response.data.message;
      } else if (pbError?.response?.message) {
        errorMessage = pbError.response.message;
      }

      // Handle queue full error
      if (errorMessage.includes('full')) {
        errorMessage = 'Sync queue is full (max 5 items). Please wait for a sync to complete.';
      }

      toast.error(`Failed to start sync for ${variables.year} - ${serviceDisplay}: ${errorMessage}`, {
        duration: 8000,
      });
    },
  });
}
