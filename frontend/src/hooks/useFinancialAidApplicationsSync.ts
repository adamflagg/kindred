import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import toast from 'react-hot-toast';

/**
 * Hook for running the financial aid applications computation sync.
 * The financial_aid_applications endpoint requires a year parameter (unlike most syncs).
 */
export function useFinancialAidApplicationsSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (year: number) => {
      const response = await pb.send(`/api/custom/sync/financial-aid-applications?year=${year}`, {
        method: 'POST',
      });
      return response;
    },
    onSuccess: (data) => {
      if (data?.status === 'started') {
        toast('FA Applications sync started', {
          icon: '\u2713',
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
    onError: (error) => {
      let errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('already in progress')) {
        errorMessage = 'FA Applications sync is already running.';
      }
      toast.error(errorMessage);
    },
  });
}
