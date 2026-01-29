import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import toast from 'react-hot-toast';

/**
 * Hook for canceling a queued sync by its ID.
 */
export function useCancelQueuedSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (queueId: string) => {
      return await pb.send(`/api/custom/sync/queue/${queueId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync-status-api'] });
      toast.success('Queued sync cancelled', { duration: 3000 });
    },
    onError: (error) => {
      // Extract error message
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      const pbError = error as { response?: { data?: { error?: string }; message?: string } };
      if (pbError?.response?.data?.error) {
        errorMessage = pbError.response.data.error;
      }

      toast.error(`Failed to cancel queued sync: ${errorMessage}`, { duration: 5000 });
    },
  });
}
