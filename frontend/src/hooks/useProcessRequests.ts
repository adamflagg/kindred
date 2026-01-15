import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import toast from 'react-hot-toast';
import type { ProcessRequestOptionsState } from '../components/admin/ProcessRequestOptions';

interface ProcessRequestsResponse {
  status: string;
  message: string;
  session: string;
  limit: number;
  force: boolean;
  debug: boolean;
}

/**
 * Hook for processing bunk requests with enhanced options.
 * Supports session filtering, record limits, and force reprocessing.
 */
export function useProcessRequests() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (options: ProcessRequestOptionsState): Promise<ProcessRequestsResponse> => {
      // Build query params
      const params = new URLSearchParams();

      // Session is now a string (e.g., 'all', '1', '2', '2a', 'toc')
      if (options.session !== 'all') {
        params.set('session', options.session);
      }

      // Source fields (comma-separated)
      if (options.sourceFields.length > 0) {
        params.set('source_field', options.sourceFields.join(','));
      }

      if (options.limit !== undefined && options.limit > 0) {
        params.set('limit', String(options.limit));
      }

      if (options.forceReprocess) {
        params.set('force', 'true');
      }

      if (options.debug) {
        params.set('debug', 'true');
      }

      const queryString = params.toString();
      const url = `/api/custom/sync/process-requests${queryString ? `?${queryString}` : ''}`;

      const response = await pb.send<ProcessRequestsResponse>(url, {
        method: 'POST',
      });

      return response;
    },
    onSuccess: (_data, options) => {
      // Build description of what was started
      const parts: string[] = [];

      // Session description (string-based)
      if (options.session === 'all') {
        parts.push('all sessions');
      } else if (options.session === '1' || options.session === 'toc') {
        parts.push('Taste of Camp');
      } else {
        parts.push(`Session ${options.session}`);
      }

      // Add source fields if specified
      if (options.sourceFields.length > 0) {
        const fieldLabels: Record<string, string> = {
          bunk_with: 'Bunk With',
          not_bunk_with: 'Not Bunk With',
          bunking_notes: 'Bunking Notes',
          internal_notes: 'Internal Notes',
          socialize_with: 'Socialize With',
        };
        const fieldNames = options.sourceFields.map((f) => fieldLabels[f] ?? f);
        parts.push(`fields: ${fieldNames.join(', ')}`);
      }

      // Add limit if specified
      if (options.limit !== undefined && options.limit > 0) {
        parts.push(`limit ${options.limit}`);
      }

      // Add force indicator
      if (options.forceReprocess) {
        parts.push('force reprocess');
      }

      // Add debug indicator
      if (options.debug) {
        parts.push('debug mode');
      }

      const description = parts.join(', ');

      toast(`Processing requests: ${description}`, {
        icon: '🧠',
        duration: 4000,
        className: 'toast-lodge toast-lodge-success',
        style: {
          borderLeft: '4px solid hsl(174, 100%, 30%)',
        },
      });

      // Invalidate sync status to show it's running
      queryClient.invalidateQueries({ queryKey: ['sync-status-api'] });
    },
    onError: (error) => {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('already in progress')) {
        toast.error('Request processing is already running');
      } else {
        toast.error(`Failed to start processing: ${errorMessage}`);
      }
    },
  });
}
