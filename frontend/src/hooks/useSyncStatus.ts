import { useQuery } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import type { RecordModel } from 'pocketbase';

export interface SyncStatus extends RecordModel {
  sync_type: 'daily' | 'historical' | 'refresh-bunking' | 'import-requests';
  session_id?: number;
  year?: number;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  current_step: string;
  total_items: number;
  processed_items: number;
  error_message?: string;
  started_at: string;
  completed_at?: string;
  result_summary?: {
    created: number;
    updated: number;
    skipped: number;
    errors: number;
    locked?: number;
    orphaned?: number;
  };
}

export function useSyncStatus(syncType?: string) {
  return useQuery({
    queryKey: ['sync-status', syncType],
    queryFn: async () => {
      // Build filter based on sync type
      let filter = 'status = "running"';
      if (syncType) {
        filter = `${filter} && sync_type = "${syncType}"`;
      }
      
      // Get active sync operations
      const statuses = await pb.collection('sync_status').getFullList<SyncStatus>({
        filter,
        sort: '-started_at',
      });
      
      return statuses;
    },
    // Poll every 2 seconds if there are running syncs
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.length === 0) return false;
      
      const hasRunning = data.some(status => status.status === 'running');
      return hasRunning ? 2000 : false;
    },
  });
}

export function useSyncHistory(syncType?: string, limit = 10) {
  return useQuery({
    queryKey: ['sync-history', syncType, limit],
    queryFn: async () => {
      // Build filter based on sync type
      const filter = syncType ? `sync_type = "${syncType}"` : '';
      
      // Get sync history
      const history = await pb.collection('sync_status').getList<SyncStatus>(1, limit, {
        filter,
        sort: '-started_at',
      });
      
      return history.items;
    },
  });
}