import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import toast from 'react-hot-toast';

interface HistoricalSyncParams {
  year: number;
  service: string; // 'all' or specific service name
}

export function useHistoricalSync() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ year, service }: HistoricalSyncParams) => {
      const response = await pb.send(`/api/custom/sync/historical/${year}/${service}`, {
        method: 'POST',
      });
      
      return response;
    },
    onSuccess: (_, variables) => {
      const serviceDisplay = variables.service === 'all' ? 'all services' : variables.service;
      toast.success(`Historical sync started for ${variables.year} - ${serviceDisplay}`, {
        duration: 5000,
      });
      
      // Invalidate sync status to show it's running
      queryClient.invalidateQueries({ queryKey: ['sync-status-api'] });
      
      // Also invalidate after a delay to catch quick syncs
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['sync-status-api'] });
      }, 2000);
    },
    onError: (error, variables) => {
      const serviceDisplay = variables.service === 'all' ? 'all services' : variables.service;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to start historical sync for ${variables.year} - ${serviceDisplay}: ${errorMessage}`, {
        duration: 8000,
      });
    },
  });
}