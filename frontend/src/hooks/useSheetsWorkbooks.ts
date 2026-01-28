/**
 * Hook to fetch Google Sheets workbooks metadata
 * Used by the SheetsPage to display workbook links and status
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import toast from 'react-hot-toast';

/**
 * Workbook record from sheets_workbooks collection
 */
export interface SheetsWorkbook {
  id: string;
  spreadsheet_id: string;
  workbook_type: 'globals' | 'year';
  year: number;
  title: string;
  url: string;
  tab_count: number;
  total_records: number;
  status: 'ok' | 'error' | 'syncing';
  error_message: string;
  created: string;
  last_sync: string;
}

/**
 * Fetch all sheets workbooks ordered by year descending
 */
export function useSheetsWorkbooks() {
  return useQuery({
    queryKey: ['sheets-workbooks'],
    queryFn: async (): Promise<SheetsWorkbook[]> => {
      try {
        const records = await pb.collection('sheets_workbooks').getFullList<SheetsWorkbook>({
          sort: '-year,workbook_type',
        });
        return records;
      } catch (error) {
        console.error('Failed to load sheets workbooks:', error);
        return [];
      }
    },
    // Refetch every 30 seconds to catch status updates
    refetchInterval: 30000,
  });
}

/**
 * Hook for triggering multi-workbook export
 */
export function useMultiWorkbookExport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params?: { years?: number[]; includeGlobals?: boolean }) => {
      let url = '/api/custom/sync/multi-workbook-export';
      const queryParams = new URLSearchParams();

      if (params?.years && params.years.length > 0) {
        queryParams.set('years', params.years.join(','));
      }
      if (params?.includeGlobals !== undefined) {
        queryParams.set('includeGlobals', params.includeGlobals ? 'true' : 'false');
      }

      if (queryParams.toString()) {
        url += '?' + queryParams.toString();
      }

      const response = await pb.send(url, {
        method: 'POST',
      });
      return response;
    },
    onSuccess: (data) => {
      if (data?.status === 'started') {
        toast('Multi-workbook export started', {
          icon: '\u2713',
          duration: 5000,
          className: 'toast-lodge toast-lodge-success',
          style: {
            borderLeft: '4px solid hsl(160, 100%, 21%)',
          },
        });
      }
      // Invalidate workbooks to show status change
      queryClient.invalidateQueries({ queryKey: ['sheets-workbooks'] });
      queryClient.invalidateQueries({ queryKey: ['sync-status-api'] });
    },
    onError: (error) => {
      let errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('already in progress')) {
        errorMessage = 'Multi-workbook export is already running.';
      }
      toast.error(errorMessage);
    },
  });
}

/**
 * Hook for refreshing the master index
 */
export function useRefreshMasterIndex() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await pb.send('/api/custom/sync/multi-workbook-export?includeGlobals=true', {
        method: 'POST',
      });
      return response;
    },
    onSuccess: () => {
      toast('Master index refresh started', {
        icon: '\u2713',
        duration: 3000,
        className: 'toast-lodge toast-lodge-success',
        style: {
          borderLeft: '4px solid hsl(160, 100%, 21%)',
        },
      });
      queryClient.invalidateQueries({ queryKey: ['sheets-workbooks'] });
    },
    onError: (error) => {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(errorMessage);
    },
  });
}
