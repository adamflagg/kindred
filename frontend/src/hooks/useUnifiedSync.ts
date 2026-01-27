import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import toast from 'react-hot-toast';

interface UnifiedSyncParams {
  year: number;
  service: string;
  includeCustomValues?: boolean;
  debug?: boolean;
}

/**
 * Unified sync hook for both current year and historical syncs.
 * Replaces the separate useRunAllSyncs and useHistoricalSync hooks.
 */
export function useUnifiedSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ year, service, includeCustomValues, debug }: UnifiedSyncParams) => {
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync-status-api'] });
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

      // Handle specific error cases
      if (errorMessage.includes('already') || errorMessage.includes('in progress')) {
        errorMessage = 'Another sync is already running. Please wait for it to complete.';
      }

      toast.error(`Failed to start sync for ${variables.year} - ${serviceDisplay}: ${errorMessage}`, {
        duration: 8000,
      });
    },
  });
}
