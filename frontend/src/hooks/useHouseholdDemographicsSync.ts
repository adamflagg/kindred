import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import toast from 'react-hot-toast';

/**
 * Hook for running the household demographics computation sync.
 * The household_demographics endpoint requires a year parameter (unlike most syncs).
 */
export function useHouseholdDemographicsSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (year: number) => {
      const response = await pb.send(`/api/custom/sync/household-demographics?year=${year}`, {
        method: 'POST',
      });
      return response;
    },
    onSuccess: (data) => {
      if (data?.status === 'started') {
        toast('Household Demographics sync started', {
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
        errorMessage = 'Household Demographics sync is already running.';
      }
      toast.error(errorMessage);
    },
  });
}
