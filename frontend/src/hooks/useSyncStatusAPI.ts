import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { pb } from '../lib/pocketbase';

// Sub-entity stats for combined syncs (e.g., persons includes households)
export interface SubStats {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

// Queued sync item from the sync queue
export interface QueuedSyncItem {
  id: string;
  year: number;
  type: 'unified' | 'phase' | 'individual'; // Type of queued sync
  service: string;
  include_custom_values?: boolean;
  position: number;
  queued_at: string;
}

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
    sub_stats?: Record<string, SubStats>; // For combined syncs (e.g., persons includes households)
  };
  year?: number; // Year being synced (0 or undefined = current year)
}

// Note: "persons" is a combined sync that populates persons and households tables
// from a single API call (tags are stored as multi-select relation on persons)
export interface SyncStatusResponse {
  session_groups: SyncStatus;
  sessions: SyncStatus;
  attendees: SyncStatus;
  person_tag_defs: SyncStatus;
  custom_field_defs: SyncStatus;
  persons: SyncStatus; // Combined sync: persons + households
  bunks: SyncStatus;
  bunk_plans: SyncStatus;
  bunk_assignments: SyncStatus;
  bunk_requests: SyncStatus;
  process_requests: SyncStatus;
  divisions: SyncStatus;
  staff: SyncStatus;
  financial_transactions: SyncStatus;
  staff_lookups: SyncStatus;
  financial_lookups: SyncStatus;
  google_sheets_export: SyncStatus;
  // On-demand custom value syncs (expensive, 1 API call per entity)
  person_custom_values: SyncStatus;
  household_custom_values: SyncStatus;
  // Special flags
  _daily_sync_running?: boolean;
  _historical_sync_running?: boolean;
  _historical_sync_year?: number;
  _weekly_sync_running?: boolean;
  // Configured year from backend (CAMPMINDER_SEASON_ID)
  _configured_year?: number;
  // Sync queue
  _queue?: QueuedSyncItem[];
  _queue_length?: number;
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
    // Poll every 3 seconds if running or queue has items, stop polling otherwise
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false; // Don't poll if no data yet

      // Check if daily sync is running
      const dailySyncRunning = data._daily_sync_running || false;

      // Check if historical sync is running
      const historicalSyncRunning = data._historical_sync_running || false;

      // Check if queue has items
      const hasQueuedItems = (data._queue_length || 0) > 0;

      // Check if any individual sync is running or pending
      const hasActiveSync = Object.entries(data).some(
        ([key, value]) => {
          // Skip the special fields
          if (key.startsWith('_')) return false;
          const status = (value as SyncStatus).status;
          return status === 'running' || status === 'pending';
        }
      );

      // 3 seconds while any sync is running, queued, or queue has items
      return (hasActiveSync || dailySyncRunning || historicalSyncRunning || hasQueuedItems) ? 3000 : false;
    },
    // Always refetch on window focus to get latest status
    refetchOnWindowFocus: true,
    enabled: !!user,
  });
}