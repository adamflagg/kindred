import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { pb } from '../lib/pocketbase';

export interface SyncStatus {
  status: 'idle' | 'running' | 'success' | 'failed' | 'pending';
  start_time?: string;
  end_time?: string;
  error?: string;
  summary?: {
    created: number;
    updated: number;
    skipped: number;
    errors: number;
    already_processed?: number; // For process_requests: records already processed
    duration?: number;
  };
  year?: number; // Year being synced (0 or undefined = current year)
}

export interface SyncStatusResponse {
  session_groups: SyncStatus;
  sessions: SyncStatus;
  attendees: SyncStatus;
  person_tag_definitions: SyncStatus;
  custom_field_definitions: SyncStatus;
  persons: SyncStatus;
  households: SyncStatus;
  person_tags: SyncStatus;
  bunks: SyncStatus;
  bunk_plans: SyncStatus;
  bunk_assignments: SyncStatus;
  bunk_requests: SyncStatus;
  process_requests: SyncStatus;
  _daily_sync_running?: boolean;
  _historical_sync_running?: boolean;
  _historical_sync_year?: number;
}

export function useSyncStatusAPI() {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['sync-status-api'],
    queryFn: async (): Promise<SyncStatusResponse> => {
      const response = await pb.send('/api/custom/sync/status', {
        method: 'GET',
      });
      
      return response as SyncStatusResponse;
    },
    // Poll every 3 seconds if running, stop polling otherwise
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false; // Don't poll if no data yet
      
      // Check if daily sync is running
      const dailySyncRunning = data._daily_sync_running || false;
      
      // Check if historical sync is running
      const historicalSyncRunning = data._historical_sync_running || false;
      
      // Check if any individual sync is running or pending
      const hasActiveSync = Object.entries(data).some(
        ([key, value]) => {
          // Skip the special fields
          if (key.startsWith('_')) return false;
          const status = (value as SyncStatus).status;
          return status === 'running' || status === 'pending';
        }
      );
      
      // 3 seconds while any sync is running (individual, daily, or historical sequence)
      return (hasActiveSync || dailySyncRunning || historicalSyncRunning) ? 3000 : false;
    },
    // Always refetch on window focus to get latest status
    refetchOnWindowFocus: true,
    enabled: !!user,
  });
}