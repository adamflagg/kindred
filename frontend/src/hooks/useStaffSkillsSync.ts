import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import toast from 'react-hot-toast';

/**
 * Hook for running the staff skills extraction sync.
 * The staff_skills endpoint requires a year parameter (unlike most syncs).
 */
export function useStaffSkillsSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (year: number) => {
      const response = await pb.send(`/api/custom/sync/staff-skills?year=${year}`, {
        method: 'POST',
      });
      return response;
    },
    onSuccess: (data) => {
      if (data?.status === 'started') {
        toast('Staff Skills sync started', {
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
        errorMessage = 'Staff Skills sync is already running.';
      }
      toast.error(errorMessage);
    },
  });
}
