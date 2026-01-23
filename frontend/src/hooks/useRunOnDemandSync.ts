import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import toast from 'react-hot-toast';
import { SYNC_TYPE_NAMES } from './useRunIndividualSync';

// Convert sync type ID to API endpoint (snake_case -> kebab-case)
const toEndpoint = (syncType: string): string => syncType.replace(/_/g, '-');

export interface OnDemandSyncOptions {
  syncType: string;
  session?: string; // "all", "1", "2", "2a", etc.
  debug?: boolean;  // Enable debug logging
}

/**
 * Hook for running on-demand syncs that require N API calls (one per entity)
 * These syncs support a session filter and debug mode
 */
export function useRunOnDemandSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ syncType, session = 'all', debug = false }: OnDemandSyncOptions) => {
      // Validate sync type exists
      if (!SYNC_TYPE_NAMES[syncType]) {
        throw new Error(`Unknown sync type: ${syncType}`);
      }

      // Build URL with session and debug query parameters
      const endpoint = `/api/custom/sync/${toEndpoint(syncType)}`;
      const params = new URLSearchParams();
      if (session && session !== 'all') {
        params.set('session', session);
      }
      if (debug) {
        params.set('debug', 'true');
      }

      const url = params.toString() ? `${endpoint}?${params.toString()}` : endpoint;

      const response = await pb.send(url, {
        method: 'POST',
      });

      return response;
    },
    onSuccess: (data, { syncType, session }) => {
      const displayName = SYNC_TYPE_NAMES[syncType] || syncType;
      const sessionText = session && session !== 'all'
        ? ` (Session ${session})`
        : ' (All sessions)';

      if (data?.status === 'started') {
        toast(`${displayName}${sessionText} sync started`, {
          icon: '✓',
          duration: 3000,
          className: 'toast-lodge toast-lodge-success',
          style: {
            borderLeft: '4px solid hsl(160, 100%, 21%)',
          },
        });
      }

      // Invalidate sync status to show it's running
      queryClient.invalidateQueries({ queryKey: ['sync-status-api'] });
    },
    onError: (error, { syncType }) => {
      const displayName = SYNC_TYPE_NAMES[syncType] || syncType;
      let errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Handle specific error cases
      if (errorMessage.includes('already in progress')) {
        errorMessage = `${displayName} sync is already running.`;
      } else if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
        errorMessage = `API rate limit reached. Please wait before trying ${displayName} sync again.`;
      }

      toast.error(errorMessage);
    },
  });
}
